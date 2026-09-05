import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  createApiKeyMiddleware,
  rateLimit,
  requireScope,
  requestClientKey,
} from "../src/lnkz/auth.js";
import type { ApiPrincipal } from "../src/lnkz/config.js";
import {
  currentRequestContext,
  runWithRequestContext,
  type RequestContext,
} from "../src/lnkz/context.js";
import {
  callbackGrantOptions,
  ManagedAuthService,
  safeReturnTo,
} from "../src/lnkz/managed-auth.js";
import { insertAuditEvent } from "../src/lnkz/store/postgres.js";
import { SqliteConversationStore } from "../src/lnkz/store/sqlite.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";

test("safe return URLs stay inside the application origin", () => {
  assert.equal(safeReturnTo("/console?tab=team#members"), "/console?tab=team#members");
  assert.equal(safeReturnTo("http://lnkz.local/console"), "/console");
  assert.equal(safeReturnTo("https://evil.example/steal"), "/");
  assert.equal(safeReturnTo("//evil.example/steal"), "/");
  assert.equal(safeReturnTo("javascript:alert(1)"), "/");
  assert.equal(safeReturnTo(undefined), "/");
});

test("OIDC callback options require PKCE verifier, state, and nonce", () => {
  assert.equal(callbackGrantOptions(undefined, "nonce", "verifier"), null);
  assert.equal(callbackGrantOptions("state", undefined, "verifier"), null);
  assert.equal(callbackGrantOptions("state", "nonce", undefined), null);
  assert.deepEqual(callbackGrantOptions("state", "nonce", "verifier"), {
    pkceCodeVerifier: "verifier",
    expectedNonce: "nonce",
    expectedState: "state",
    idTokenExpected: true,
  });
});

test("managed callback validates and forwards state, nonce, and PKCE values", async () => {
  const grantCalls: unknown[] = [];
  const queries: { text: string; values?: unknown[] }[] = [];
  const fakePool = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rows: [] };
    },
    connect: async () => {
      throw new Error("connect should not be needed for callback completion");
    },
    end: async () => undefined,
  };
  const fakeOidc = {
    discovery: async () => ({ issuer: "https://issuer.example" }),
    randomState: () => "state",
    randomNonce: () => "nonce",
    randomPKCECodeVerifier: () => "verifier",
    calculatePKCECodeChallenge: async () => "challenge",
    buildAuthorizationUrl: (_config: unknown, options: Record<string, string>) =>
      new URL(`https://issuer.example/authorize?state=${options.state}&nonce=${options.nonce}&challenge=${options.code_challenge}`),
    authorizationCodeGrant: async (_config: unknown, callback: URL, options: unknown) => {
      grantCalls.push({ callback: callback.href, options });
      return {
        claims: () => ({ iss: "https://issuer.example", sub: "subject-1" }),
      };
    },
  };
  const service = new ManagedAuthService(
    {
      enabled: true,
      issuerUrl: "https://issuer.example",
      clientId: "client",
      sessionTtlMs: 60_000,
      workspaceId,
    },
    undefined,
    { pool: fakePool as never, oidc: fakeOidc as never },
  );

  const beginResponse = responseDouble();
  await service.beginLogin(requestDouble({ query: { returnTo: "/console" } }), beginResponse as never);
  assert.match(beginResponse.redirected ?? "", /state=state/);
  assert.match(beginResponse.redirected ?? "", /nonce=nonce/);
  assert.match(beginResponse.redirected ?? "", /challenge=challenge/);

  const callbackResponse = responseDouble();
  await service.completeLogin(
    requestDouble({
      originalUrl: "/api/callback?code=authorization-code",
      headers: {
        cookie: beginResponse.cookies.join("; "),
      },
    }),
    callbackResponse as never,
  );
  assert.deepEqual(grantCalls, [{
    callback: "http://localhost/api/callback?code=authorization-code",
    options: {
      pkceCodeVerifier: "verifier",
      expectedNonce: "nonce",
      expectedState: "state",
      idTokenExpected: true,
    },
  }]);
  assert.equal(callbackResponse.redirected, "/console");
  assert.equal(queries.length, 1);
  service.close();
});

test("managed authentication denies a valid session without active workspace membership", async () => {
  const fakePool = {
    query: async () => ({ rows: [{
      sid_hash: "hashed",
      issuer: "https://issuer.example",
      subject: "subject-1",
      user_json: {},
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }] }),
    connect: async () => ({
      query: async (text: string) => text === "select set_config('app.workspace_id', $1, true)"
        ? { rows: [] }
        : { rows: [] },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  const service = new ManagedAuthService(
    {
      enabled: true,
      issuerUrl: "https://issuer.example",
      clientId: "client",
      sessionTtlMs: 60_000,
      workspaceId,
    },
    undefined,
    { pool: fakePool as never },
  );
  const request = requestDouble({ headers: { authorization: "Bearer session-token" } });
  await assert.rejects(service.authenticate(request), (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, 403);
    assert.match(String((error as Error).message), /not a member/);
    return true;
  });
  service.close();
});

test("static API keys preserve the principal workspace, actor, and scopes", async () => {
  const principal: ApiPrincipal = {
    key: "static-secret",
    workspaceId,
    actorId: "actor-static",
    scopes: ["read"],
  };
  const middleware = createApiKeyMiddleware([principal], true, "fallback");
  const request = requestDouble({ headers: { authorization: "Bearer static-secret" } });
  const response = responseDouble();
  let seen: RequestContext | undefined;
  middleware(request, response as never, () => {
    seen = currentRequestContext();
  });
  await flush();
  assert.deepEqual(seen && {
    workspaceId: seen.workspaceId,
    actorId: seen.actorId,
    scopes: [...seen.scopes],
    authMethod: seen.authMethod,
  }, {
    workspaceId,
    actorId: "actor-static",
    scopes: ["read"],
    authMethod: "api-key",
  });
});

test("unknown credentials and denied managed users cannot enter a request context", async () => {
  const denied = createApiKeyMiddleware([], true, workspaceId, {
    authenticate: async () => null,
  });
  const response = responseDouble();
  let called = false;
  denied(requestDouble({ headers: { authorization: "Bearer unknown" } }), response as never, () => {
    called = true;
  });
  await flush();
  assert.equal(called, false);
  assert.equal(response.statusCode, 401);

  const managedDenied = createApiKeyMiddleware([], true, workspaceId, {
    authenticate: async () => {
      const error = new Error("not a member") as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    },
  });
  const managedResponse = responseDouble();
  managedDenied(requestDouble({ headers: { cookie: "lnkz_sid=session" } }), managedResponse as never, () => {
    called = true;
  });
  await flush();
  assert.equal(called, false);
  assert.equal(managedResponse.statusCode, 403);
  assert.equal(managedResponse.body.error, "not a member");
});

test("scope enforcement denies missing scopes and lets admins through", () => {
  const deniedResponse = responseDouble();
  runWithRequestContext({
    workspaceId,
    actorId: "reader",
    scopes: new Set(["read"]),
    authMethod: "managed",
  }, () => requireScope("write")(requestDouble(), deniedResponse as never, () => {
    throw new Error("write scope should be denied");
  }));
  assert.equal(deniedResponse.statusCode, 403);
  assert.match(String(deniedResponse.body.error), /write scope/);

  let called = false;
  runWithRequestContext({
    workspaceId,
    actorId: "admin",
    scopes: new Set(["admin"]),
    authMethod: "managed",
  }, () => requireScope("write")(requestDouble(), responseDouble() as never, () => {
    called = true;
  }));
  assert.equal(called, true);
});

test("rate limits authenticated actors independently, not by shared client IP", () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1 });
  const request = requestDouble({ ip: "203.0.113.10" });
  const actorA: RequestContext = {
    workspaceId,
    actorId: "actor-a",
    scopes: new Set(["read"]),
    authMethod: "managed",
  };
  const actorB: RequestContext = { ...actorA, actorId: "actor-b" };
  let nextCount = 0;
  runWithRequestContext(actorA, () => limiter(request, responseDouble() as never, () => { nextCount += 1; }));
  const secondA = responseDouble();
  runWithRequestContext(actorA, () => limiter(request, secondA as never, () => { nextCount += 1; }));
  runWithRequestContext(actorB, () => limiter(request, responseDouble() as never, () => { nextCount += 1; }));
  assert.equal(nextCount, 2);
  assert.equal(secondA.statusCode, 429);
  assert.equal(requestClientKey(request), "203.0.113.10");
  runWithRequestContext(actorA, () => assert.equal(requestClientKey(request), `actor:${workspaceId}:actor-a`));
});

test("SQLite audit events carry the signed-in actor", async () => {
  const store = new SqliteConversationStore(":memory:");
  await runWithRequestContext({
    workspaceId,
    actorId: "sqlite-actor",
    scopes: new Set(["admin"]),
    authMethod: "managed",
  }, () => store.recordEvent({ kind: "test.audit" }));
  const events = await store.listEvents(10);
  assert.equal(events[0]?.actorId, "sqlite-actor");
  store.close();
});

test("Postgres audit inserts carry the signed-in actor", async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  await runWithRequestContext({
    workspaceId,
    actorId: "postgres-actor",
    scopes: new Set(["admin"]),
    authMethod: "managed",
  }, () => insertAuditEvent({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  }, workspaceId, { kind: "test.audit" }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.values?.[1], workspaceId);
  assert.equal(calls[0]?.values?.[2], "postgres-actor");
});

function requestDouble(overrides: Record<string, unknown> = {}): Request {
  const headers = Object.fromEntries(Object.entries((overrides.headers ?? {}) as Record<string, string>)
    .map(([key, value]) => [key.toLowerCase(), value]));
  return {
    protocol: "http",
    originalUrl: overrides.originalUrl ?? "/",
    query: overrides.query ?? {},
    ip: overrides.ip ?? "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    get(name: string) {
      return name.toLowerCase() === "host" ? "localhost" : headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function responseDouble(): ResponseDouble {
  return {
    statusCode: 200,
    body: {},
    headers: {},
    cookies: [],
    redirected: undefined,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string | number) {
      this.headers[name.toLowerCase()] = String(value);
      return this;
    },
    append(name: string, value: string) {
      if (name.toLowerCase() === "set-cookie") this.cookies.push(value);
      return this;
    },
    redirect(url: string) {
      this.redirected = url;
      return this;
    },
  };
}

interface ResponseDouble {
  statusCode: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  cookies: string[];
  redirected: string | undefined;
  headersSent: boolean;
  status(code: number): this;
  json(body: Record<string, unknown>): this;
  setHeader(name: string, value: string | number): this;
  append(name: string, value: string): this;
  redirect(url: string): this;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}