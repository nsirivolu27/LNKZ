// Local two-device setup: isolated relays, persistent data, same-origin mobile UI.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const addresses = Object.values(networkInterfaces()).flat().filter((entry) => entry?.family === "IPv4" && !entry.internal).map((entry) => entry.address);
const host = args[0];
if (args.length !== 1 || !["127.0.0.1", ...addresses].includes(host)) {
  console.error("Usage: corepack pnpm dev:devices <this computer's LAN IPv4 address>");
  console.error(`Available addresses: ${addresses.join(", ") || "none"}; 127.0.0.1 works for laptop-only testing.`);
  process.exit(1);
}
await access(resolve("dist/index.mjs"));
await access(resolve("dist/mobile/index.html"));
const directory = resolve(".data/two-devices");
await mkdir(directory, { recursive: true });
const keyFile = resolve(directory, "connections.json");
let keys;
try { keys = JSON.parse(await readFile(keyFile, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  keys = { A: randomBytes(32).toString("base64url"), B: randomBytes(32).toString("base64url") };
  await writeFile(keyFile, JSON.stringify(keys, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
if (![keys.A, keys.B].every((key) => typeof key === "string" && key.length >= 32) || keys.A === keys.B) throw new Error("Invalid local connection keys; inspect .data/two-devices/connections.json.");

const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (/^(LNKZ_|DATABASE_|SLACK_|JIRA_|FIGMA_|DOCUMENT_FEED_|FANTASY_)/.test(name)) delete env[name];
}
delete env.WEB_DIST_DIR;
const services = [];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all(services.map(async ({ child }) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((done) => child.once("exit", done));
    child.kill();
    await exited;
  }));
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  for (const [name, port] of [["A", 3101], ["B", 3102]]) {
    const base = `http://${host}:${port}`;
    const child = spawn(process.execPath, ["dist/index.mjs"], {
      env: { ...env, NODE_ENV: "production", HOST: host === "127.0.0.1" ? host : "0.0.0.0", PORT: String(port),
        LNKZ_API_KEY: keys[name], LNKZ_PUBLIC_BASE_URL: base, LNKZ_DB_FILE: resolve(directory, `${name}.db`),
        ALLOWED_HOSTS: `${host},localhost,127.0.0.1`, ALLOWED_ORIGINS: base,
        LNKZ_TRANSFER_ALLOW_PRIVATE: "true" },
      stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
    });
    let logs = "";
    child.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-4000); });
    const service = { name, child };
    services.push(service);
    child.once("error", (error) => { console.error(`Relay ${name}: ${error.message}`); process.exitCode = 1; void stop(); });
    child.once("exit", () => {
      if (!stopping) { console.error(`Relay ${name} stopped unexpectedly. ${logs}`); process.exitCode = 1; void stop(); }
    });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const result = await fetch(`${base}/api/stats`, { headers: { authorization: `Bearer ${keys[name]}` }, signal: AbortSignal.timeout(1000) });
        ready = result.ok;
      } catch {}
      if (ready) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    if (!ready) throw new Error(`Relay ${name} could not start. Ports 3101 and 3102 must be free. ${logs}`);
    console.log(`Device ${name}: ${base}/mobile/`);
  }
  console.log(`Connection keys (A and B) are saved locally at: ${keyFile}`);
  console.log("Use this on a trusted local network with test conversations. Press Ctrl+C to stop both relays; saved conversations remain.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  await stop();
}
