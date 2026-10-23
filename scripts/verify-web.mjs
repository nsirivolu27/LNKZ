import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "lnkz-web-verify-"));
const key = randomBytes(32).toString("base64url");
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (/^(LNKZ_|DATABASE_|SLACK_|JIRA_|FIGMA_|DOCUMENT_FEED_|FANTASY_)/.test(name)) delete env[name];
}
delete env.WEB_DIST_DIR;
const child = spawn(process.execPath, ["dist/index.mjs"], {
  env: { ...env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
    LNKZ_API_KEY: key, LNKZ_DB_FILE: join(directory, "lnkz.db"),
    LNKZ_PUBLIC_BASE_URL: base, ALLOWED_HOSTS: "localhost,127.0.0.1", ALLOWED_ORIGINS: base },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let logs = "";
child.stdout.on("data", (data) => { logs += data; });
child.stderr.on("data", (data) => { logs += data; });
const exited = new Promise((resolve) => child.once("exit", resolve));
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error("Built server exited before readiness.");
    try { ready = (await fetch(`${base}/ready`)).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "built server should become ready");
  for (const [path, title] of [["/", "LNKZ | Carry the conversation forward"], ["/console.html", "LNKZ Console"]]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const html = await response.text();
    assert.ok(html.includes(`<title>${title}</title>`));
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)];
    assert.ok(assets.length > 0, "entry page should reference built assets");
    for (const [, asset] of assets) {
      const file = await fetch(base + asset);
      assert.equal(file.status, 200);
      assert.ok((await file.text()).length > 0);
    }
  }
  for (const path of ["/.env", "/src/index.ts", "/package.json", "/api/missing", "/assets/missing.js"]) {
    assert.equal((await fetch(base + path)).status, 404, "unpublished paths must stay inaccessible");
  }
  assert.equal((await fetch(`${base}/api/stats`)).status, 401);
  const rejectedOrigin = await fetch(`${base}/api/stats`, { headers: { authorization: `Bearer ${key}`, origin: "https://untrusted.invalid" } });
  assert.equal(rejectedOrigin.status, 403);
  const imported = await api("/api/conversations/import", { payload: "User: How do we ship this?\nAssistant: We decided to keep the console and relay in one repository." });
  const id = imported.conversations[0].id;
  const library = await api("/api/conversations");
  assert.ok(library.conversations.some((conversation) => conversation.id === id));
  const read = await api(`/api/conversations/${id}`);
  assert.ok(read.analysis.decisions.length > 0);
  const packet = await api("/api/context/packet", { conversationIds: [id], budgetTokens: 1000, includeExternal: false });
  assert.ok(packet.packet.markdown.includes("one repository"));
  const handoff = await api(`/api/conversations/${id}/handoffs`, { ttlMinutes: 5, maxUses: 1 });
  const redeemed = await fetch(`${base}/share/${handoff.token}`);
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.headers.get("cache-control"), "no-store");
  assert.equal((await redeemed.json()).conversation.id, id);
  assert.equal((await fetch(`${base}/share/${handoff.token}`)).status, 404);
  assert.equal(logs.includes(key) || logs.includes(handoff.token), false, "logs must omit bearer secrets");
  console.log("Web pages/assets, console REST workflow, auth/origin boundaries, private-file isolation and handoff safety verified.");
} finally {
  if (child.exitCode === null) {
    child.kill();
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}

async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
  });
  assert.ok(response.ok, "console API request should succeed");
  return response.json();
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
