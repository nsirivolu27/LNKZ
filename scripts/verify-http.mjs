import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const workDir = await mkdtemp(join(tmpdir(), "lnkz-http-verify-"));
const contextSecret = randomBytes(48).toString("base64url");
const upstreamKey = randomBytes(32).toString("base64url");
const downstreamKey = randomBytes(32).toString("base64url");
const services = [];

try {
  const [upstreamPort, downstreamPort] = await Promise.all([freePort(), freePort()]);
  const downstream = startService("downstream", downstreamPort, downstreamKey, {
    LNKZ_DB_FILE: join(workDir, "downstream.db"),
  });
  services.push(downstream);
  await waitForHealth(downstream);

  const upstream = startService("upstream", upstreamPort, upstreamKey, {
    LNKZ_DB_FILE: join(workDir, "upstream.db"),
    LNKZ_MCP_TARGETS: `downstream=http://127.0.0.1:${downstreamPort}/mcp`,
  });
  services.push(upstream);
  const health = await waitForHealth(upstream);
  assert.equal(health.mcp?.contextForwarding?.enabled, true);
  assert.equal(JSON.stringify(health).includes(contextSecret), false, "health exposed the context secret");

  const upstreamClient = await connectHttp(upstreamPort, { authorization: `Bearer ${upstreamKey}` });
  try {
    const tools = await upstreamClient.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "save_conversation"));
    const resources = await upstreamClient.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === "lnkz://conversations"));

    const discovery = await upstreamClient.callTool({ name: "list_publish_targets", arguments: {} });
    const targets = discovery.structuredContent?.targets;
    assert.ok(Array.isArray(targets));
    const reached = targets.find((target) => target.target === "downstream");
    assert.ok(reached && !reached.error && reached.tools.length > 0, "forwarded context did not reach downstream");
  } finally {
    await upstreamClient.close();
  }

  const invalid = await fetch(`http://127.0.0.1:${downstreamPort}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "x-lnkz-context": "malformed.invalid",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "verify", version: "1" } },
    }),
  });
  assert.equal(invalid.status, 401);

  const precedenceClient = await connectHttp(downstreamPort, {
    authorization: `Bearer ${downstreamKey}`,
    "x-lnkz-context": "malformed.invalid",
  });
  try {
    assert.ok((await precedenceClient.listTools()).tools.length > 0);
  } finally {
    await precedenceClient.close();
  }

  const stdioClient = new Client({ name: "lnkz-stdio-verify", version: "1.0.0" });
  const stdioTransport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/lnkz/stdio.mjs"],
    cwd: process.cwd(),
    env: cleanEnvironment({
      NODE_ENV: "development",
      LNKZ_ALLOW_UNAUTHENTICATED: "true",
      LNKZ_DB_FILE: join(workDir, "stdio.db"),
    }),
    stderr: "pipe",
  });
  try {
    await stdioClient.connect(stdioTransport);
    assert.ok((await stdioClient.listTools()).tools.some((tool) => tool.name === "save_conversation"));
  } finally {
    await stdioClient.close();
  }

  console.log("HTTP forwarding, auth rejection/precedence, health redaction, tools/resources, and stdio verified.");
} finally {
  await Promise.all(services.map(stopService));
  await rm(workDir, { recursive: true, force: true });
}

function startService(name, port, apiKey, extra) {
  const child = spawn(process.execPath, ["dist/index.mjs"], {
    cwd: process.cwd(),
    env: cleanEnvironment({
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      LNKZ_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      LNKZ_API_KEY: apiKey,
      LNKZ_MCP_API_KEY_REQUIRED: "true",
      LNKZ_MCP_CONTEXT_SECRET: contextSecret,
      ...extra,
    }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const service = { name, port, child, stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => { service.stdout = `${service.stdout}${chunk}`.slice(-8_000); });
  child.stderr.on("data", (chunk) => { service.stderr = `${service.stderr}${chunk}`.slice(-8_000); });
  return service;
}

function cleanEnvironment(overrides) {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
  for (const name of [
    "DATABASE_URL",
    "FANTASY_MCP_URL",
    "FANTASY_MCP_API_KEY",
    "LNKZ_ALLOW_UNAUTHENTICATED",
    "LNKZ_API_KEY",
    "LNKZ_API_KEYS_JSON",
    "LNKZ_AUTH_MODE",
    "LNKZ_DB_FILE",
    "LNKZ_MCP_API_KEY_REQUIRED",
    "LNKZ_MCP_CONTEXT_SECRET",
    "LNKZ_MCP_TARGETS",
    "LNKZ_POSTGRES_WORKSPACE_ID",
  ]) delete env[name];
  return { ...env, ...overrides };
}

async function waitForHealth(service) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (service.child.exitCode != null) throw serviceError(service, "exited before becoming healthy");
    try {
      const response = await fetch(`http://127.0.0.1:${service.port}/health`);
      if (response.ok) return await response.json();
    } catch {
      // The listener may not be ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw serviceError(service, "did not become healthy");
}

async function connectHttp(port, headers) {
  const client = new Client({ name: "lnkz-http-verify", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers },
  });
  await client.connect(transport);
  return client;
}

async function stopService(service) {
  if (service.child.exitCode != null) return;
  const exited = new Promise((resolve) => service.child.once("exit", resolve));
  service.child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (service.child.exitCode == null) service.child.kill("SIGKILL");
}

function serviceError(service, message) {
  return new Error(`${service.name} ${message}\n${service.stdout}\n${service.stderr}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
