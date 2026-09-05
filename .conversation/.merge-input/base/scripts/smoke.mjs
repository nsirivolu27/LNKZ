#!/usr/bin/env node
/**
 * End-to-end smoke test against a real LNKZ process.
 *
 * The unit tests exercise the store and the MCP server in memory. This one
 * boots the built server, then drives it the way a client actually would:
 * REST import, MCP over Streamable HTTP, an unauthenticated share redemption,
 * and a revocation. It is the check that catches wiring mistakes the unit
 * tests cannot see - middleware order, auth, transport framing, static serving.
 *
 * Usage:
 *   node scripts/smoke.mjs                 # boots mcp-server/dist/server.js
 *   node scripts/smoke.mjs http://host:port  # tests an already-running server
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const external = process.argv[2];
const apiKey = process.env.LNKZ_API_KEY ?? randomBytes(12).toString("hex");
const port = Number(process.env.SMOKE_PORT ?? 3199);
const baseUrl = external ?? `http://127.0.0.1:${port}`;

let child;
let dataDir;
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function request(path, init = {}) {
  const headers = { authorization: `Bearer ${apiKey}`, ...init.headers };
  if (init.body) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

/** Minimal Streamable HTTP client: initialize, then call one tool. */
async function mcp(method, params, id) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  const payload = text.includes("data:")
    ? JSON.parse(text.split("\n").filter((line) => line.startsWith("data:")).pop().slice(5).trim())
    : JSON.parse(text);
  return payload;
}

async function boot() {
  dataDir = await mkdtemp(join(tmpdir(), "lnkz-smoke-"));
  child = spawn(process.execPath, ["dist/server.js"], {
    cwd: new URL("../mcp-server/", import.meta.url).pathname,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      LNKZ_API_KEY: apiKey,
      LNKZ_DB_FILE: join(dataDir, "lnkz.db"),
      LNKZ_DATA_FILE: join(dataDir, "absent.json"),
      LNKZ_PUBLIC_BASE_URL: baseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`  [server] ${chunk}`));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Server did not become healthy in 20s.");
}

async function main() {
  if (!external) {
    console.log("Booting the built server...");
    await boot();
  }
  console.log(`Smoke testing ${baseUrl}\n`);

  const health = await request("/health");
  check("health reports the service and its connectors", health.status === 200 && health.body?.service === "lnkz");

  const unauthorized = await fetch(`${baseUrl}/api/stats`);
  check("the API refuses an unauthenticated request", unauthorized.status === 401, `got ${unauthorized.status}`);

  const imported = await request("/api/conversations/import", {
    method: "POST",
    body: JSON.stringify({
      payload: "User: which store did we pick?\nAssistant: We decided to use SQLite for the relay.",
      tags: ["smoke"],
    }),
  });
  const conversation = imported.body?.conversations?.[0];
  check("a plain paste imports over REST", imported.status === 201 && Boolean(conversation), JSON.stringify(imported.body).slice(0, 160));

  const search = await request("/api/conversations/search", {
    method: "POST",
    body: JSON.stringify({ query: "sqlite relay" }),
  });
  check("full-text search finds the imported chat", search.body?.matches?.length === 1);

  const packet = await request("/api/context/packet", {
    method: "POST",
    body: JSON.stringify({ query: "sqlite", budgetTokens: 1_000, includeExternal: false }),
  });
  check(
    "a context packet is built within budget",
    packet.body?.packet?.usedTokens <= packet.body?.packet?.budgetTokens
      && packet.body.packet.markdown.includes("LNKZ context packet"),
  );

  const handoff = await request(`/api/conversations/${conversation.id}/handoffs`, {
    method: "POST",
    body: JSON.stringify({ ttlMinutes: 10, maxUses: 2, redact: true, audience: "smoke test" }),
  });
  check("a handoff is minted with a share URL", handoff.status === 201 && handoff.body.shareUrl.includes("/share/"));

  const redeemed = await fetch(`${baseUrl}/share/${handoff.body.token}`);
  const packetBody = await redeemed.json();
  check("the share link redeems without a key", redeemed.status === 200 && packetBody.conversation.id === conversation.id);
  check("redeemed packets are not cacheable", redeemed.headers.get("cache-control") === "no-store");

  const markdown = await fetch(`${baseUrl}/share/${handoff.body.token}`, { headers: { accept: "text/markdown" } });
  check("the share link also serves Markdown", markdown.status === 200 && (await markdown.text()).startsWith("#"));

  const spent = await fetch(`${baseUrl}/share/${handoff.body.token}`);
  check("a spent handoff stops working", spent.status === 404, `got ${spent.status}`);

  const initialize = await mcp("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "lnkz-smoke", version: "1.0.0" },
  }, 1);
  check("MCP initialize succeeds over Streamable HTTP", initialize.result?.serverInfo?.name === "lnkz");

  const tools = await mcp("tools/list", {}, 2);
  check("the MCP tool surface is advertised", (tools.result?.tools?.length ?? 0) >= 20, `saw ${tools.result?.tools?.length}`);

  const called = await mcp("tools/call", { name: "workspace_stats", arguments: {} }, 3);
  check("an MCP tool call returns structured content", called.result?.structuredContent?.stats?.conversations === 1);

  const events = await request("/api/events?limit=50");
  const kinds = new Set((events.body?.events ?? []).map((event) => event.kind));
  check("the audit trail recorded the handoff lifecycle", kinds.has("handoff.created") && kinds.has("handoff.redeemed"));

  console.log(`\n${failures === 0 ? "All smoke checks passed." : `${failures} smoke check(s) failed.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(`\nSmoke test crashed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  child?.kill("SIGTERM");
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}
