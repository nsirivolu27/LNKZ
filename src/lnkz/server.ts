import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  createApiKeyMiddleware,
  createOriginValidator,
  rateLimit,
  requireScope,
  requestClientKey,
  securityHeaders,
  withLoopback,
} from "./auth.js";
import { loadConfig } from "./config.js";
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
import { resolveDatabaseUrl } from "./store/postgres.js";
import type { PostgresRateLimiter } from "./store/rate-limit.js";
import type { Conversation } from "./types.js";
import { ZodError } from "zod";

const config = loadConfig();
const { host, port, publicBaseUrl } = config;
if (config.auth.mode === "multi-key" && !resolveDatabaseUrl()) {
  throw new Error("LNKZ_AUTH_MODE=multi-key requires Postgres; SQLite is intentionally single-tenant.");
}
const allowedHosts = withLoopback(config.allowedHosts, port);

const app = createMcpExpressApp({ host, allowedHosts: allowedHosts.length ? allowedHosts : undefined });
app.set("trust proxy", config.trustProxy);
const { store, core, connectors, sharedRateLimiter } = createRuntime();
const authenticate = createApiKeyMiddleware(
  config.auth.principals,
  config.auth.apiKeyRequired,
  config.auth.defaultWorkspaceId,
);
const authenticateMcp = createApiKeyMiddleware(
  config.auth.principals,
  config.auth.apiKeyRequired,
  config.auth.defaultWorkspaceId,
  {
    allowForwardedContext: true,
    forwardedContextSecret: config.mcp.contextSecret,
    requiredForwardedScope: "mcp",
  },
);
const requireApiKey = (request: express.Request, response: express.Response, next: express.NextFunction): void => {
  authenticate(request, response, () => {
    requireScope(request.method === "GET" ? "read" : "write")(request, response, next);
  });
};
const requireMcpAuth = (request: express.Request, response: express.Response, next: express.NextFunction): void => {
  authenticateMcp(request, response, () => {
    requireScope("mcp")(request, response, next);
  });
};

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json({ limit: config.maxBody }));
app.use(createOriginValidator(config.allowedOrigins));
app.use((request, response, next) => {
  if (request.path === "/health" || request.path === config.mcp.path || request.path.startsWith("/api/")) {
    response.setHeader("cache-control", "no-store");
  }
  next();
});

/** Share links are unauthenticated by design, so they get their own budget. */
const shareLimiter = rateLimit({ windowMs: config.rateLimitWindowMs, max: config.shareRateLimit });
const apiLimiter = rateLimit({ windowMs: config.rateLimitWindowMs, max: config.apiRateLimit });
const sharedShareLimiter = sharedRateLimitMiddleware(sharedRateLimiter, {
  bucket: "share",
  windowMs: config.rateLimitWindowMs,
  max: config.shareRateLimit,
});
const sharedApiLimiter = sharedRateLimitMiddleware(sharedRateLimiter, {
  bucket: "api",
  windowMs: config.rateLimitWindowMs,
  max: config.apiRateLimit,
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "lnkz",
    version: LNKZ_VERSION,
    protocol: "MCP Streamable HTTP",
    mcp: {
      enabled: config.mcp.enabled,
      path: config.mcp.path,
      authRequired: config.mcp.authRequired,
      contextForwarding: { enabled: Boolean(config.mcp.contextSecret) },
    },
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

app.post("/api/conversations", requireApiKey, apiLimiter, sharedApiLimiter, async (request, response) => {
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

app.post("/api/conversations/search", requireApiKey, apiLimiter, sharedApiLimiter, async (request, response) => {
  try {
    const input = searchConversationsSchema.parse(request.body);
    response.json({ matches: await store.search(input.query, input.limit) });
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/conversations/import", requireApiKey, apiLimiter, sharedApiLimiter, async (request, response) => {
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

app.post("/api/conversations/:id/messages", requireApiKey, apiLimiter, sharedApiLimiter, async (request, response) => {
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

app.post("/api/conversations/:id/handoffs", requireApiKey, apiLimiter, sharedApiLimiter, async (request, response) => {
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

app.get("/share/:token", shareLimiter, sharedShareLimiter, async (request, response) => {
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

app.post("/api/context/search", requireApiKey, apiLimiter, sharedApiLimiter, async (request, response) => {
  try {
    response.json(await aggregateSearch(connectors, contextSearchSchema.parse(request.body)));
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/context/packet", requireApiKey, apiLimiter, sharedApiLimiter, async (request, response) => {
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

if (config.mcp.enabled) {
  app.post(config.mcp.path, requireMcpAuth, apiLimiter, sharedApiLimiter, async (request, response) => {
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
    app[method](config.mcp.path, requireMcpAuth, (_request, response) => {
      response.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed for this stateless MCP server." },
        id: null,
      });
    });
  }
}

app.use((request, response, next) => {
  if (request.path.startsWith("/api/") || request.path === config.mcp.path) {
    response.status(404).json({ error: "Not found." });
    return;
  }
  response.status(404).json({ error: "Not found." });
});

app.use((error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: "Malformed JSON request." });
    return;
  }
  if (isPayloadTooLarge(error)) {
    response.status(413).json({ error: "Request body is too large." });
    return;
  }
  console.error("[server] request failed", {
    method: request.method,
    path: request.path,
    error: error instanceof Error ? error.message : "unknown error",
  });
  response.status(500).json({ error: "Internal server error." });
});

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
    const timeout = setTimeout(() => {
      console.error("[server] graceful shutdown timed out");
      process.exit(1);
    }, config.shutdownTimeoutMs);
    timeout.unref();
    httpServer.close(() => {
      clearTimeout(timeout);
      store.close();
      sharedRateLimiter?.close();
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
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Invalid request.",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  response.status(400).json({ error: "Invalid request." });
}

function isPayloadTooLarge(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "type" in error &&
      (error as { type?: unknown }).type === "entity.too.large",
  );
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

function sharedRateLimitMiddleware(
  limiter: PostgresRateLimiter | undefined,
  options: { bucket: string; windowMs: number; max: number },
): express.RequestHandler {
  return async (request, response, next) => {
    if (!limiter) {
      next();
      return;
    }
    try {
      const result = await limiter.allow(`${options.bucket}:${requestClientKey(request)}`, options);
      if (result.allowed) {
        next();
        return;
      }
      response.setHeader("retry-after", result.retryAfter);
      response.status(429).json({ error: "Too many requests." });
    } catch (error) {
      console.error("[rate-limit] shared limiter failed", error);
      response.status(503).json({ error: "Rate limiting is temporarily unavailable." });
    }
  };
}
