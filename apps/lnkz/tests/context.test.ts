import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { createApiKeyMiddleware } from "../src/lnkz/auth.js";
import { loadConfig } from "../src/lnkz/config.js";
import {
  currentRequestContext,
  MCP_CONTEXT_HEADER,
  mcpContextHeaders,
  runWithRequestContext,
  signMcpContext,
  verifyMcpContext,
  type RequestContext,
} from "../src/lnkz/context.js";

const SECRET = "test-only-context-secret-with-32-bytes-minimum";
const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "20000000-0000-4000-8000-000000000002";
const NOW = 1_800_000_000_000;

function context(authMethod: RequestContext["authMethod"] = "api-key"): RequestContext {
  return {
    workspaceId: WORKSPACE_ID,
    actorId: "actor-123",
    scopes: new Set(["mcp", "read"]),
    authMethod,
    trace: { id: "trace-123" },
  };
}

function invoke(
  middleware: ReturnType<typeof createApiKeyMiddleware>,
  headers: Record<string, string> = {},
): { status?: number; body?: unknown; reached?: RequestContext } {
  const result: { status?: number; body?: unknown; reached?: RequestContext } = {};
  const request = {
    header(name: string) { return headers[name.toLowerCase()]; },
  } as Request;
  const response = {
    status(code: number) { result.status = code; return this; },
    json(body: unknown) { result.body = body; return this; },
  } as unknown as Response;
  middleware(request, response, (() => { result.reached = currentRequestContext(); }) as NextFunction);
  return result;
}

function forwardingMiddleware() {
  return createApiKeyMiddleware([], true, OTHER_WORKSPACE_ID, {
    allowForwardedContext: true,
    forwardedContextSecret: SECRET,
    requiredForwardedScope: "mcp",
    now: () => NOW,
  });
}

test("a signed MCP context reaches a downstream node with actor, scopes, and trace", () => {
  let headers: Record<string, string> = {};
  runWithRequestContext(context(), () => {
    headers = mcpContextHeaders(SECRET, undefined, { now: NOW });
  });

  const result = invoke(forwardingMiddleware(), headers);
  assert.equal(result.status, undefined);
  assert.equal(result.reached?.workspaceId, WORKSPACE_ID);
  assert.equal(result.reached?.actorId, "actor-123");
  assert.equal(result.reached?.authMethod, "forwarded");
  assert.deepEqual([...result.reached!.scopes].sort(), ["mcp", "read"]);
  assert.equal(result.reached?.trace?.id, "trace-123");
});

test("invalid signatures and malformed envelopes fail closed", () => {
  const signed = signMcpContext(context(), SECRET, { now: NOW });
  const last = signed.at(-1) === "a" ? "b" : "a";
  const tampered = `${signed.slice(0, -1)}${last}`;
  assert.equal(verifyMcpContext(tampered, SECRET, { now: NOW }), null);
  assert.equal(invoke(forwardingMiddleware(), { [MCP_CONTEXT_HEADER]: tampered }).status, 401);
  assert.equal(invoke(forwardingMiddleware(), { [MCP_CONTEXT_HEADER]: "not-an-envelope" }).status, 401);
});

test("expired and incorrectly scoped envelopes are rejected", () => {
  const expired = signMcpContext(context(), SECRET, { now: NOW - 2_000, ttlMs: 1_000 });
  assert.equal(invoke(forwardingMiddleware(), { [MCP_CONTEXT_HEADER]: expired }).status, 401);

  const readOnly = signMcpContext({ ...context(), scopes: new Set(["read"]) }, SECRET, { now: NOW });
  assert.equal(invoke(forwardingMiddleware(), { [MCP_CONTEXT_HEADER]: readOnly }).status, 401);
});

test("a valid API key takes precedence over an invalid forwarded envelope", () => {
  const middleware = createApiKeyMiddleware([{
    key: "valid-api-key",
    workspaceId: OTHER_WORKSPACE_ID,
    actorId: "api-actor",
    scopes: ["mcp"],
  }], true, WORKSPACE_ID, {
    allowForwardedContext: true,
    forwardedContextSecret: SECRET,
    requiredForwardedScope: "mcp",
    now: () => NOW,
  });
  const result = invoke(middleware, {
    authorization: "Bearer valid-api-key",
    [MCP_CONTEXT_HEADER]: "malformed",
  });
  assert.equal(result.status, undefined);
  assert.equal(result.reached?.workspaceId, OTHER_WORKSPACE_ID);
  assert.equal(result.reached?.authMethod, "api-key");
});

test("a managed context takes precedence over forwarded headers", () => {
  let result: ReturnType<typeof invoke> | undefined;
  runWithRequestContext(context("managed"), () => {
    result = invoke(forwardingMiddleware(), { [MCP_CONTEXT_HEADER]: "malformed" });
  });
  assert.equal(result?.status, undefined);
  assert.equal(result?.reached?.authMethod, "managed");
  assert.equal(result?.reached?.workspaceId, WORKSPACE_ID);
});

test("plain workspace headers never establish request context", () => {
  const result = invoke(forwardingMiddleware(), {
    "x-lnkz-workspace": WORKSPACE_ID,
    "x-workspace-id": WORKSPACE_ID,
  });
  assert.equal(result.status, 401);
  assert.equal(result.reached, undefined);
});

test("production auth fails closed and context secrets must be strong", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv), /Authentication is required/);
  assert.throws(
    () => loadConfig({ NODE_ENV: "development", LNKZ_MCP_CONTEXT_SECRET: "short" } as NodeJS.ProcessEnv),
    /at least 32 bytes/,
  );
});
