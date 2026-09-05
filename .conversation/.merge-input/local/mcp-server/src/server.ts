import express from "express";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { enforceHttps, rateLimit, requireActor, requireMcpBearer, validateOrigin, withLoopback } from "./auth.js";
import { hashBearerToken, hashPassword, verifyPassword } from "./security.js";
import { connectorStatuses } from "./connectors/index.js";
import { createLnkzConnector } from "./connectors/lnkz.js";
import { importConversations } from "./import/index.js";
import { analyzeConversation } from "./intel/analyze.js";
import { detectConflicts, detectDuplicates } from "./intel/conflict.js";
import { buildContextPacket } from "./intel/packet.js";
import { createLnkzMcpServer, LNKZ_VERSION } from "./mcp.js";
import {
  appendMessagesSchema,
  authCredentialsSchema,
  auditSchema,
  conflictSchema,
  contextPacketSchema,
  contextSearchSchema,
  conversationInputSchema,
  createHandoffSchema,
  duplicateSchema,
  importSchema,
  inviteSchema,
  listConversationsSchema,
  memberRoleSchema,
  searchConversationsSchema,
  tokenSchema,
  workspaceSwitchSchema,
} from "./schemas.js";
import { aggregateSearch } from "./search.js";
import { createRuntime } from "./runtime.js";
import type { Actor, Conversation } from "./types.js";

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? 3100);
const publicBaseUrl = process.env.LNKZ_PUBLIC_BASE_URL || `http://${host}:${port}`;
const allowedHosts = withLoopback(splitList(process.env.ALLOWED_HOSTS), port);
const shareActor = { id: "handoff", workspaceId: "public", role: "owner" as const, auth: "share" as const };
const secureCookies = process.env.LNKZ_COOKIE_SECURE !== "false";


const app = createMcpExpressApp({ host, allowedHosts: allowedHosts.length ? allowedHosts : undefined });
const { store, core, connectors } = createRuntime();

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';");
  if (request.secure) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(express.json({ limit: process.env.LNKZ_MAX_BODY || "24mb" }));
app.use(enforceHttps);
app.use(validateOrigin);

/** Share links are unauthenticated by design, so they get their own budget. */
const shareLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.LNKZ_SHARE_RATE_LIMIT ?? 60) });
const shareTokenLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.LNKZ_SHARE_TOKEN_RATE_LIMIT ?? 12),
  key: (request) => `handoff:${request.params.token ?? "missing"}`,
});
const apiLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.LNKZ_API_RATE_LIMIT ?? 600) });
const signupLimiter = rateLimit({ windowMs: 15 * 60_000, max: 5 });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 12 });

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "lnkz",
    version: LNKZ_VERSION,
    protocol: "MCP Streamable HTTP",
    connectors: connectorStatuses(core).map(({ id, configured }) => ({ id, configured })),
  });
});

// Kept deliberately early so the console can establish its auth state before
// loading any data. Session-backed authentication can enrich this response
// without changing the client contract.
app.get("/api/session", (_request, response) => {
  response.setHeader("cache-control", "no-store");
  const token = cookie(_request.header("cookie"), "lnkz_session");
  void (token ? store.findSession(hashBearerToken(token)) : Promise.resolve(null)).then((session) => {
    response.json(session ? { authenticated: true, actor: session.actor, expiresAt: session.expiresAt } : { authenticated: false });
  });
});

app.post("/api/auth/signup", signupLimiter, async (request, response) => {
  try {
    const { email, password, website } = authCredentialsSchema.parse(request.body);
    if (website) throw new Error("Invalid signup.");
    const existing = await store.findAccount(email);
    const passwordHash = await hashPassword(password);
    if (!existing) await store.createAccount(email, passwordHash);
    response.status(202).json({ ok: true, message: "If the account can be created, you may now sign in." });
  } catch {
    response.status(202).json({ ok: true, message: "If the account can be created, you may now sign in." });
  }
});

app.post("/api/auth/login", loginLimiter, async (request, response) => {
  const { email, password, website } = authCredentialsSchema.parse(request.body);
  if (website || await store.loginBlocked(email)) {
    response.status(401).json({ error: "Invalid email or password." });
    return;
  }
  const account = await store.findAccount(email);
  const valid = account
    ? await verifyPassword(password, account.passwordHash).catch(() => false)
    : (await hashPassword(password), false);
  await store.recordLoginAttempt(email, valid);
  if (!account || !valid) {
    response.status(401).json({ error: "Invalid email or password." });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await store.createSession(account, hashBearerToken(token), new Date(now + 7 * 86400000).toISOString(), new Date(now + 30 * 60000).toISOString());
  setSessionCookie(response, token);
  response.json({ ok: true });
});

app.post("/api/auth/logout", async (request, response) => {
  const token = cookie(request.header("cookie"), "lnkz_session");
  if (token) await store.deleteSession(hashBearerToken(token));
  response.setHeader("Set-Cookie", `lnkz_session=; HttpOnly; ${secureCookies ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=0`);
  response.status(204).end();
});

app.post("/api/auth/workspace", requireActor(store), async (request, response) => {
  try {
    const input = workspaceSwitchSchema.parse(request.body);
    const actor = await store.switchWorkspace(request.actor!, input.workspaceId);
    if (!actor) {
      response.status(404).json({ error: "Workspace not found." });
      return;
    }
    const oldToken = cookie(request.header("cookie"), "lnkz_session");
    if (oldToken) await store.deleteSession(hashBearerToken(oldToken));
    const token = randomBytes(32).toString("base64url");
    const account = await store.findAccountById(actor.id);
    if (!account) {
      response.status(404).json({ error: "Account not found." });
      return;
    }
    const now = Date.now();
    await store.createSession(
      { ...account, workspaceId: actor.workspaceId, role: actor.role },
      hashBearerToken(token),
      new Date(now + 7 * 86_400_000).toISOString(),
      new Date(now + 1_800_000).toISOString(),
    );
    setSessionCookie(response, token);
    response.json({ authenticated: true, actor, expiresAt: new Date(now + 7 * 86_400_000).toISOString() });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/workspaces", requireActor(store), async (request, response) => {
  response.json({ workspaces: await store.listWorkspaces(request.actor!) });
});

app.post("/api/auth/accept-invite", requireActor(store), async (request, response) => {
  try {
    const token = typeof request.body?.token === "string" ? request.body.token.trim() : "";
    if (token.length < 20 || token.length > 500) throw new Error("Invalid invite.");
    const accepted = await store.acceptInvite(token, request.actor!);
    response.status(accepted ? 200 : 404).json(accepted ? { ok: true } : { error: "Invite not found." });
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/workspaces/invites", requireActor(store), async (request, response) => {
  try {
    const input = inviteSchema.parse(request.body);
    const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000).toISOString();
    response.status(201).json(await store.createInvite(request.actor!, input.email, input.role, expiresAt));
  } catch (error) {
    handleStoreError(response, error);
  }
});

app.get("/api/workspaces/members", requireActor(store), async (request, response) => {
  try {
    response.json({ members: await store.listMembers(request.actor!) });
  } catch (error) {
    handleStoreError(response, error);
  }
});

app.patch("/api/workspaces/members/:userId", requireActor(store), async (request, response) => {
  try {
    const input = memberRoleSchema.parse(request.body);
    const changed = await store.changeMemberRole(request.actor!, pathParam(request.params.userId), input.role);
    response.status(changed ? 200 : 404).json(changed ? { ok: true } : { error: "Member not found." });
  } catch (error) {
    handleStoreError(response, error);
  }
});

app.delete("/api/workspaces/members/:userId", requireActor(store), async (request, response) => {
  try {
    const removed = await store.removeMember(request.actor!, pathParam(request.params.userId));
    response.status(removed ? 204 : 404).end();
  } catch (error) {
    handleStoreError(response, error);
  }
});

app.post("/api/tokens", requireActor(store), async (request, response) => {
  try {
    const input = tokenSchema.parse(request.body);
    response.status(201).json(await store.createApiToken(request.actor!, input.scope, input.expiresAt));
  } catch (error) {
    handleStoreError(response, error);
  }
});

app.get("/api/tokens", requireActor(store), async (request, response) => {
  try {
    response.json({ tokens: await store.listApiTokens(request.actor!) });
  } catch (error) {
    handleStoreError(response, error);
  }
});

app.delete("/api/tokens/:id", requireActor(store), async (request, response) => {
  try {
    const revoked = await store.revokeApiToken(request.actor!, pathParam(request.params.id));
    response.status(revoked ? 204 : 404).end();
  } catch (error) {
    handleStoreError(response, error);
  }
});

app.get("/api/connectors", requireActor(store), (_request, response) => {
  response.json({ connectors: connectorStatuses(core) });
});

app.get("/api/stats", requireActor(store), async (_request, response) => {
  response.json({ stats: await store.stats(_request.actor!) });
});

app.get("/api/events", requireActor(store), async (request, response) => {
  const { limit } = auditSchema.parse({ limit: numberParam(request.query.limit, 50) });
  response.json({ events: await store.listEvents(limit, request.actor!) });
});

// ------------------------------------------------------------------ conversations

app.post("/api/conversations", requireActor(store), apiLimiter, async (request, response) => {
  try {
    const conversation = await store.save(conversationInputSchema.parse(request.body), request.actor!);
    response.status(201).json({ conversation });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/conversations", requireActor(store), async (request, response) => {
  try {
    const options = listConversationsSchema.parse({
      limit: numberParam(request.query.limit, 25),
      offset: numberParam(request.query.offset, 0),
      provider: stringParam(request.query.provider),
      tag: stringParam(request.query.tag),
      participant: stringParam(request.query.participant),
    });
    response.json({ conversations: await store.list(options, request.actor!) });
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/conversations/search", requireActor(store), apiLimiter, async (request, response) => {
  try {
    const input = searchConversationsSchema.parse(request.body);
    response.json({ matches: await store.search(input.query, input.limit, request.actor!) });
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/conversations/import", requireActor(store), apiLimiter, async (request, response) => {
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
      }, request.actor!));
    }
    response.status(201).json({ format: result.format, warnings: result.warnings, conversations });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/conversations/:id", requireActor(store), async (request, response) => {
  const conversation = await store.get(pathParam(request.params.id), request.actor!);
  if (!conversation) {
    response.status(404).json({ error: "Conversation not found." });
    return;
  }
  response.json({ conversation, analysis: analyzeConversation(conversation) });
});

app.delete("/api/conversations/:id", requireActor(store), async (request, response) => {
  const removed = await store.remove(pathParam(request.params.id), request.actor!);
  if (!removed) {
    response.status(404).json({ error: "Conversation not found." });
    return;
  }
  response.status(204).end();
});

app.post("/api/conversations/:id/messages", requireActor(store), apiLimiter, async (request, response) => {
  try {
    const input = appendMessagesSchema.parse({
      conversationId: pathParam(request.params.id),
      messages: request.body?.messages,
    });
    const conversation = await store.appendMessages(input.conversationId, input.messages, request.actor!);
    if (!conversation) {
      response.status(404).json({ error: "Conversation not found." });
      return;
    }
    response.json({ conversation });
  } catch (error) {
    badRequest(response, error);
  }
});

// ----------------------------------------------------------------------- handoffs

app.post("/api/conversations/:id/handoffs", requireActor(store), apiLimiter, async (request, response) => {
  try {
    const options = createHandoffSchema.parse({ ...request.body, conversationId: pathParam(request.params.id) });
    const handoff = await store.createHandoff(options, request.actor!);
    response.status(201).json({ ...handoff, shareUrl: `${publicBaseUrl.replace(/\/$/, "")}/share/${handoff.token}` });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/handoffs", requireActor(store), async (request, response) => {
  const conversationId = stringParam(request.query.conversationId);
  if (conversationId && !await store.get(conversationId, request.actor!)) {
    response.status(404).json({ error: "Conversation not found." });
    return;
  }
  response.json({ handoffs: await store.listHandoffs(conversationId, request.actor!) });
});

app.delete("/api/handoffs/:id", requireActor(store), async (request, response) => {
  const revoked = await store.revokeHandoff(pathParam(request.params.id), request.actor!);
  if (!revoked) {
    response.status(404).json({ error: "Handoff not found or already revoked." });
    return;
  }
  response.status(204).end();
});

app.get("/share/:token", shareLimiter, shareTokenLimiter, async (request, response) => {
  const packet = await store.redeemHandoff(pathParam(request.params.token), shareActor);
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

app.post("/api/context/search", requireActor(store), apiLimiter, async (request, response) => {
  try {
    const scopedConnectors = connectors.map((connector) =>
      connector.id === "lnkz" ? createLnkzConnector(store, request.actor!) : connector);
    response.json(await aggregateSearch(scopedConnectors, contextSearchSchema.parse(request.body)));
  } catch (error) {
    badRequest(response, error);
  }
});

app.post("/api/context/packet", requireActor(store), apiLimiter, async (request, response) => {
  try {
    const input = contextPacketSchema.parse(request.body);
    if (!input.query && !input.conversationIds?.length) {
      response.status(400).json({ error: "Provide a query, conversationIds, or both." });
      return;
    }
    response.json({ packet: await buildContextPacket(store, connectors, input, request.actor!) });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/context/conflicts", requireActor(store), async (request, response) => {
  try {
    const input = conflictSchema.parse({
      limit: numberParam(request.query.limit, 30),
      threshold: numberParam(request.query.threshold, 0.45),
    });
    const conversations = await loadRecent(input.limit, request.actor!);
    response.json({ conflicts: detectConflicts(conversations, input.threshold), scanned: conversations.length });
  } catch (error) {
    badRequest(response, error);
  }
});

app.get("/api/context/duplicates", requireActor(store), async (request, response) => {
  try {
    const input = duplicateSchema.parse({
      limit: numberParam(request.query.limit, 30),
      threshold: numberParam(request.query.threshold, 0.6),
    });
    const conversations = await loadRecent(input.limit, request.actor!);
    response.json({ duplicates: detectDuplicates(conversations, input.threshold), scanned: conversations.length });
  } catch (error) {
    badRequest(response, error);
  }
});

// ---------------------------------------------------------------------------- MCP

app.post("/mcp", requireMcpBearer(store), apiLimiter, async (request, response) => {
  const server = createLnkzMcpServer(store, connectors, publicBaseUrl, request.actor!);
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
  app[method]("/mcp", requireMcpBearer(store), (_request, response) => {
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
    console.log("[server] legacy LNKZ_API_KEY is not set; account/session or scoped-token authentication is required.");
  } else {
    console.warn("[server] legacy LNKZ_API_KEY is enabled for migration compatibility; prefer scoped account tokens.");
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

async function loadRecent(limit: number, actor: Actor): Promise<Conversation[]> {
  const summaries = await store.list({ limit }, actor);
  const conversations: Conversation[] = [];
  for (const summary of summaries) {
    const conversation = await store.get(summary.id, actor);
    if (conversation) conversations.push(conversation);
  }
  return conversations;
}

function badRequest(response: express.Response, error: unknown): void {
  response.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." });
}

function handleStoreError(response: express.Response, error: unknown): void {
  if (error instanceof Error && error.message === "Forbidden.") {
    response.status(403).json({ error: "Forbidden." });
    return;
  }
  badRequest(response, error);
}

function setSessionCookie(response: express.Response, token: string): void {
  response.setHeader("Set-Cookie", `lnkz_session=${encodeURIComponent(token)}; HttpOnly; ${secureCookies ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=604800`);
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

function cookie(header: string | undefined, name: string): string | undefined {
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
}
