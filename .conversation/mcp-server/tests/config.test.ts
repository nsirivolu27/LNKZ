import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loads Docker-friendly HTTP and MCP settings", () => {
  const config = loadConfig({
    HOST: "0.0.0.0",
    PORT: "8080",
    LNKZ_PUBLIC_BASE_URL: "https://lnkz.example.com",
    LNKZ_MCP_PATH: "/gateway/mcp/",
    LNKZ_MCP_API_KEY_REQUIRED: "true",
    LNKZ_API_KEY: "secret",
    LNKZ_TRUST_PROXY: "1",
    LNKZ_RATE_LIMIT_WINDOW_MS: "120000",
    LNKZ_SHARE_RATE_LIMIT: "12",
    LNKZ_API_RATE_LIMIT: "120",
  });

  assert.deepEqual(config.mcp, {
    enabled: true,
    path: "/gateway/mcp",
    authRequired: true,
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(config.trustProxy, 1);
  assert.equal(config.rateLimitWindowMs, 120_000);
  assert.equal(config.shareRateLimit, 12);
  assert.equal(config.apiRateLimit, 120);
});

test("uses safe defaults and can disable MCP", () => {
  const config = loadConfig({ LNKZ_MCP_ENABLED: "false" });
  assert.equal(config.mcp.enabled, false);
  assert.equal(config.mcp.path, "/mcp");
  assert.equal(config.mcp.authRequired, false);
  assert.equal(config.port, 3100);
});

test("rejects required MCP authentication without a key", () => {
  assert.throws(
    () => loadConfig({ LNKZ_MCP_API_KEY_REQUIRED: "true" }),
    /requires LNKZ_API_KEY/,
  );
});

test("rejects invalid deployment settings", () => {
  assert.throws(() => loadConfig({ PORT: "not-a-port" }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ LNKZ_MCP_PATH: "/mcp?x=1" }), /LNKZ_MCP_PATH/);
  assert.throws(() => loadConfig({ LNKZ_PUBLIC_BASE_URL: "ftp://example.com" }), /http or https/);
});

test("parses multi-workspace API principals without exposing their keys", () => {
  const config = loadConfig({
    LNKZ_AUTH_MODE: "multi-key",
    LNKZ_MCP_API_KEY_REQUIRED: "true",
    LNKZ_API_KEYS_JSON: JSON.stringify([{
      key: "workspace-secret",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      actorId: "alice",
      scopes: ["mcp", "read"],
    }]),
  });

  assert.equal(config.auth.mode, "multi-key");
  assert.deepEqual(config.auth.principals[0], {
    key: "workspace-secret",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    actorId: "alice",
    scopes: ["mcp", "read"],
  });
});