import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, parseWorkspaces } from "../src/lnkz/config.js";

const one = "10000000-0000-4000-8000-000000000001";
const two = "20000000-0000-4000-8000-000000000002";
const workspace = (id = one) => JSON.stringify([{ id, name: "Personal", mode: "personal", useCase: "Context", datasets: { enabled: true, approvalTag: "approved" } }]);

test("validates workspace configuration and maps principals to it", () => {
  const config = loadConfig({
    NODE_ENV: "production", LNKZ_AUTH_MODE: "multi-key",
    LNKZ_API_KEYS_JSON: JSON.stringify([{ key: "secret", workspaceId: one, actorId: "actor", scopes: ["read", "admin"] }]),
    LNKZ_WORKSPACES_JSON: workspace(),
  });
  assert.equal(config.workspaces[0]?.id, one);
  assert.equal(config.auth.principals[0]?.actorId, "actor");
});

test("rejects malformed, duplicate, and unmapped workspace/key configuration", () => {
  assert.throws(() => parseWorkspaces("{", one), /valid JSON/);
  assert.throws(() => parseWorkspaces(JSON.stringify([
    { id: one, name: "a", mode: "personal", useCase: "x", datasets: { enabled: true, approvalTag: "a" } },
    { id: one, name: "b", mode: "team", useCase: "x", datasets: { enabled: false, approvalTag: "b" } },
  ]), one), /duplicate workspace/);
  assert.throws(() => loadConfig({
    NODE_ENV: "production", LNKZ_AUTH_MODE: "multi-key",
    LNKZ_API_KEYS_JSON: JSON.stringify([{ key: "secret", workspaceId: two, scopes: ["admin"] }]),
    LNKZ_WORKSPACES_JSON: workspace(),
  }), /unconfigured workspace/);
});

test("rejects duplicate API keys", () => {
  assert.throws(() => loadConfig({
    NODE_ENV: "production", LNKZ_API_KEYS_JSON: JSON.stringify([
      { key: "same", workspaceId: one }, { key: "same", workspaceId: one },
    ]), LNKZ_WORKSPACES_JSON: workspace(),
  }), /duplicate key/);
});