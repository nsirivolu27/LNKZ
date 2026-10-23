import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const directory = await mkdtemp(join(tmpdir(), "lnkz-demo-"));
const services = [];
const recording = [];
const started = performance.now();
function show(line) {
  console.log(line);
  recording.push([(performance.now() - started) / 1000, "o", `${line}\r\n`]);
}
try {
  const a = await start("A", false);
  const b = await start("B", true);
  const corpus = JSON.parse(await readFile(new URL("../seed/conversations.json", import.meta.url), "utf8"));
  show("A > Save the twelve-conversation seed corpus");
  for (const conversation of corpus) await call(a, "/api/conversations", conversation);
  const original = corpus[0];
  show(`Saved: ${original.title} (${original.source.provider})`);
  const answer = await call(a, "/api/context/packet", { query: "forecast model", budgetTokens: 1500, includeExternal: false });
  show("A > What did we decide about the forecast model?");
  for (const conversation of answer.packet.conversations) {
    for (const decision of conversation.decisions) show(`  ${decision}`);
  }
  show("A > Create an expiring, one-use handoff (bearer link kept private)");
  const handoff = await call(a, `/api/conversations/${original.id}/handoffs`, { ttlMinutes: 5, maxUses: 1 });
  show("B > Import the link from A");
  const imported = await call(b, "/api/conversations/import-url", { url: handoff.shareUrl });
  const id = imported.conversation.id;
  const saved = await call(b, `/api/conversations/${id}`);
  if (saved.conversation.lineage?.originConversationId !== original.id) throw new Error("Origin lineage was lost");
  show(`Lineage: originConversationId=${saved.conversation.lineage.originConversationId}`);
  show(`Lineage: originInstance=${saved.conversation.lineage.originInstance}`);
  show("B > Continue the conversation in another client");
  const continued = await call(b, `/api/conversations/${id}/messages`, {
    messages: [{ role: "assistant", author: "Claude", content: "I will compare the seasonal baseline on the pilot stations before we revisit gradient boosting." }],
  });
  show(continued.conversation.messages.at(-1).content);
  show("Done: the context and its origin are now stored on B.");
  if (process.argv.includes("--record")) {
    await writeFile("docs/demo.cast", [JSON.stringify({ version: 2, width: 120, height: 28, title: "LNKZ: save, handoff, continue" }), ...recording.map((event) => JSON.stringify(event))].join("\n") + "\n");
    await writeFile("docs/demo-output.txt", recording.map((event) => event[2].trimEnd()).join("\n") + "\n");
  }
} catch {
  console.error("Demo failed. Check the build and local port availability.");
  process.exitCode = 1;
} finally {
  for (const service of services) {
    if (service.child.exitCode !== null) continue;
    const exited = new Promise((resolve) => service.child.once("exit", resolve));
    service.child.kill();
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}

async function start(name, allowPrivate) {
  const port = await freePort();
  const key = randomBytes(32).toString("base64url");
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  for (const variable of Object.keys(env)) {
    if (/^(LNKZ_|DATABASE_|SLACK_|JIRA_|FIGMA_|DOCUMENT_FEED_|FANTASY_)/.test(variable)) delete env[variable];
  }
  const child = spawn(process.execPath, ["dist/index.mjs"], {
    env: { ...env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
      LNKZ_API_KEY: key, LNKZ_PUBLIC_BASE_URL: base, LNKZ_DB_FILE: join(directory, `${name}.db`),
      ALLOWED_HOSTS: "localhost,127.0.0.1", ALLOWED_ORIGINS: base,
      LNKZ_TRANSFER_ALLOW_PRIVATE: String(allowPrivate) },
    stdio: "ignore", windowsHide: true,
  });
  const service = { child, key, base };
  services.push(service);
  for (let tries = 0; tries < 150; tries++) {
    if (child.exitCode !== null) throw new Error("Demo instance stopped");
    try { if ((await fetch(`${base}/ready`)).ok) return service; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Demo readiness timed out");
}

async function call(service, path, body) {
  const response = await fetch(`${service.base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${service.key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Demo request failed");
  return response.json();
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
