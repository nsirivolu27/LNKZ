import assert from "node:assert/strict";
import test from "node:test";
import { outboundContextHeader, signContext, verifyContext } from "../src/context.js";

const secret = "context-test-secret";
const base = {
  workspaceId: "workspace-1",
  actorId: "actor-1",
  scopes: ["conversations:read"],
  traceId: "trace-1",
};

test("signed context carries identity, scopes, expiry, and trace information", () => {
  const header = signContext({ ...base, exp: 1_000_060 }, secret, 1_000_000);
  assert.deepEqual(verifyContext(header, secret, "conversations:read", 1_000_010), { ...base, exp: 1_000_060 });
  assert.equal(verifyContext(header, secret, "conversations:write", 1_000_010), null);
  assert.equal(verifyContext(header, "wrong", undefined, 1_000_010), null);
});

test("malformed and expired context is rejected", () => {
  const header = signContext({ ...base, exp: 1_000_001 }, secret, 1_000_000);
  assert.equal(verifyContext(header, secret, undefined, 1_000_001), null);
  assert.equal(verifyContext("v1.not-json.bad", secret), null);
  assert.equal(verifyContext(undefined, secret), null);
});

test("partial outbound context configuration fails closed", () => {
  assert.throws(() => outboundContextHeader({ LNKZ_MCP_CONTEXT_SECRET: secret } as NodeJS.ProcessEnv), /requires secret, workspace, actor, scopes, and trace ID/);
  const header = outboundContextHeader({
    LNKZ_MCP_CONTEXT_SECRET: secret,
    LNKZ_CONTEXT_WORKSPACE_ID: base.workspaceId,
    LNKZ_CONTEXT_ACTOR_ID: base.actorId,
    LNKZ_CONTEXT_SCOPES: base.scopes.join(","),
    LNKZ_CONTEXT_TRACE_ID: base.traceId,
  } as NodeJS.ProcessEnv);
  assert.ok(header);
});