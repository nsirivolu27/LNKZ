import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { rateLimit, requireApiKey, validateOrigin, withLoopback } from "./auth.js";
import { connectorStatuses } from "./connectors/index.js";
import { importConversations } from "./import/index.js";
import { analyzeConversation } from "./intel/analyze.js";
import { detectConflicts, detectDuplicates } from "./intel/conflict.js";
import { buildContextPacket } from "./intel/packet.js";
import { mountSurfaceRoutes } from "./surfaces.js";
import { createLnkzMcpServer, LNKZ_VERSION } from "./mcp.js";
import {
  appendMessagesSchema,
  auditSchema,
  conflictSchema,
  contextPacketSchema,
  contextSearchSchema,
  conversationInputSchema,
  createHandoffSchema,
  duplicateSchema,
  importSchema,
  listConversationsSchema,
  searchConversationsSchema,
} from "./schemas.js";
import { aggregateSearch } from "./search.js";
import { createRuntime } from "./runtime.js";
import type { Conversation } from "./types.js";

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? 3100);
const publicBaseUrl = process.env.LNKZ_PUBLIC_BASE_URL || `http://${host}:${port}`;
const allowedHosts = withLoopback(splitList(process.env.ALLOWED_HOSTS), port);

const app = createMcpExpressApp({ host, allowedHosts: allowedHosts.length ? allowedHosts : undefined });
const { store, core, connectors } = createRuntime();

app.disable("x-powered-by");
app.use(express.json({ limit: process.env.LNKZ_MAX_BODY || "24mb" }));
app.use(validateOrigin);

/** Share links are unauthenticated by design, so they get their own budget. */
const shareLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.LNKZ_SHARE_RATE_LIMIT ?? 60) });
const apiLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.LNKZ_API_RATE_LIMIT ?? 600) });

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "lnkz",
    version: LNKZ_VERSION,
    protocol: "MCP Streamable HTTP",
    connectors: connectorStatuses(core).map(({ id, configured }) => ({ id, configured })),
  });
});

app.get("/api/connectors", requireApiKey, (_request, response) => {
  response.json({ connectors: connectorStatuses(core) });
});

app.get("/api/stats", requireApiKey, async (_request, response) => {
  response.json({ stats: await store.stats() });
});

app.get("/api/events", requireApiKey, async (request, response) => {
  const { limit } = auditSchema.parse({ limit: numberParam(request.query.limit, 50) });
  response.json({ events: await store.listEvents(limit) });
});

// ------------------------------------------------------------------ conversations

app.post("/api/conversations", requireApiKey, apiLimiter, async (request, response) => {
  try {
    const conversation = await store.save(conversationInputSchema.parse(request.body));
    response.status(201).json({ conversation });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/conversations", requireApiKey, async (request, response) => {
  try {
    const options = listConversationsSchema.parse({
      limit: numberParam(request.query.limit, 25),
      offset: numberParam(request.query.offset, 0),
      provider: stringParam(request.query.provider),
      tag: stringParam(request.query.tag),
      participant: stringParam(request.query.participant),
    });
    response.json({ conversations: await store.list(options) });
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/conversations/search", requireApiKey, apiLimiter, async (request, response) => {
  try {
    const input = searchConversationsSchema.parse(request.body);
    response.json({ matches: await store.search(input.query, input.limit) });
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/conversations/import", requireApiKey, apiLimiter, async (request, response) => {
  try {
    const input = importSchema.parse(request.body);
    const result = importConversations(input.payload, input.format);
    if (input.dryRun) {
      response.json({
        format: result.format,
        warnings: result.warnings,
        preview: result.conversations.map((conversation) => ({
          title: conversation.title,
          provider: conversation.source.provider,
          messages: conversation.messages.length,
        })),
      });
      return;
    }
    const conversations: Conversation[] = [];
    for (const candidate of result.conversations) {
      conversations.push(await store.save({
        ...candidate,
        tags: [...new Set([...(candidate.tags ?? []), ...(input.tags ?? [])])],
      }));
    }
    response.status(201).json({ format: result.format, warnings: result.warnings, conversations });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/conversations/:id", requireApiKey, async (request, response) => {
  const conversation = await store.get(pathParam(request.params.id));
  if (!conversation) {
    response.status(404).json({ error: "Conversation not found." });
    return;
  }
  response.json({ conversation, analysis: analyzeConversation(conversation) });
});

app.delete("/api/conversations/:id", requireApiKey, async (request, response) => {
  const removed = await store.remove(pathParam(request.params.id));
  if (!removed) {
    response.status(404).json({ error: "Conversation not found." });
    return;
  }
  response.status(204).end();
});

app.post("/api/conversations/:id/messages", requireApiKey, apiLimiter, async (request, response) => {
  try {
    const input = appendMessagesSchema.parse({
      conversationId: pathParam(request.params.id),
      messages: request.body?.messages,
    });
    const conversation = await store.appendMessages(input.conversationId, input.messages);
    if (!conversation) {
      response.status(404).json({ error: "Conversation not found." });
      return;
    }
    response.json({ conversation });
  } catch (error) {
    badRequest(response, error);
  }
});

mountSurfaceRoutes(app, store, requireApiKey);

// ----------------------------------------------------------------------- handoffs

app.post("/api/conversations/:id/handoffs", requireApiKey, apiLimiter, async (request, response) => {
  try {
    const options = createHandoffSchema.parse({ ...request.body, conversationId: pathParam(request.params.id) });
    const handoff = await store.createHandoff(options);
    response.status(201).json({ ...handoff, shareUrl: `${publicBaseUrl.replace(/\/$/, "")}/share/${handoff.token}` });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/handoffs", requireApiKey, async (request, response) => {
  response.json({ handoffs: await store.listHandoffs(stringParam(request.query.conversationId)) });
});

app.delete("/api/handoffs/:id", requireApiKey, async (request, response) => {
  const revoked = await store.revokeHandoff(pathParam(request.params.id));
  if (!revoked) {
    response.status(404).json({ error: "Handoff not found or already revoked." });
    return;
  }
  response.status(204).end();
});

app.get("/share/:token", shareLimiter, async (request, response) => {
  const packet = await store.redeemHandoff(pathParam(request.params.token));
  if (!packet) {
    response.status(404).json({ error: "Handoff is invalid, revoked, exhausted, or expired." });
    return;
  }
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-robots-tag", "noindex, nofollow");
  if ((request.header("accept") ?? "").includes("text/markdown")) {
    response.type("text/markdown").send(packet.transcriptMarkdown);
    return;
  }
  response.json(packet);
});

// ------------------------------------------------------------------------ context

app.post("/api/context/search", requireApiKey, apiLimiter, async (request, response) => {
  try {
    response.json(await aggregateSearch(connectors, contextSearchSchema.parse(request.body)));
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/context/packet", requireApiKey, apiLimiter, async (request, response) => {
  try {
    const input = contextPacketSchema.parse(request.body);
    if (!input.query && !input.conversationIds?.length) {
      response.status(400).json({ error: "Provide a query, conversationIds, or both." });
      return;
    }
    response.json({ packet: await buildContextPacket(store, connectors, input) });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/context/conflicts", requireApiKey, async (request, response) => {
  try {
    const input = conflictSchema.parse({
      limit: numberParam(request.query.limit, 30),
      threshold: numberParam(request.query.threshold, 0.45),
    });
    const conversations = await loadRecent(input.limit);
    response.json({ conflicts: detectConflicts(conversations, input.threshold), scanned: conversations.length });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/context/duplicates", requireApiKey, async (request, response) => {
  try {
    const input = duplicateSchema.parse({
      limit: numberParam(request.query.limit, 30),
      threshold: numberParam(request.query.threshold, 0.6),
    });
    const conversations = await loadRecent(input.limit);
    response.json({ duplicates: detectDuplicates(conversations, input.threshold), scanned: conversations.length });
  } catch (error) {
    badRequest(response, error);
  }
});

// ---------------------------------------------------------------------------- MCP

app.post("/mcp", requireApiKey, apiLimiter, async (request, response) => {
  const server = createLnkzMcpServer(store, connectors, publicBaseUrl);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  response.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error("[mcp] request failed", error);
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

for (const method of ["get", "delete"] as const) {
  app[method]("/mcp", requireApiKey, (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed for this stateless MCP server." },
      id: null,
    });
  });
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(process.env.WEB_DIST_DIR || resolve(moduleDirectory, "..", "..", "dist"));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|mcp|share|health).*/, (_request, response) => {
    response.sendFile(resolve(webDist, "index.html"));
  });
}

const httpServer = app.listen(port, host, (error?: Error) => {
  if (error) {
    console.error("[server] failed to start", error);
    process.exitCode = 1;
    return;
  }
  console.log(`[server] LNKZ ${LNKZ_VERSION} listening on ${publicBaseUrl}`);
  if (!process.env.LNKZ_API_KEY?.trim()) {
    console.warn("[server] LNKZ_API_KEY is not set: the API and MCP endpoint are unauthenticated.");
  }
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    httpServer.close(() => {
      store.close();
      process.exit(0);
    });
  });
}

async function loadRecent(limit: number): Promise<Conversation[]> {
  const summaries = await store.list({ limit });
  const conversations: Conversation[] = [];
  for (const summary of summaries) {
    const conversation = await store.get(summary.id);
    if (conversation) conversations.push(conversation);
  }
  return conversations;
}

function badRequest(response: express.Response, error: unknown): void {
  response.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." });
}

function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberParam(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}
