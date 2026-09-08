import { randomUUID } from "node:crypto";

const base = new URL(process.argv[2] ?? process.env.LNKZ_BASE_URL ?? "http://127.0.0.1:3100");
if (base.username || base.password || base.search || base.hash) throw new Error("Use a base URL without credentials, query or fragment.");
if (!process.env.LNKZ_API_KEY) throw new Error("Set LNKZ_API_KEY for the instance being checked.");
const headers = { authorization: `Bearer ${process.env.LNKZ_API_KEY}`, "content-type": "application/json" };
let id;
try {
  for (const path of ["/health", "/ready"]) await call(path);
  const denied = await fetch(new URL("/api/stats", base));
  if (denied.status !== 401) throw new Error("Unauthenticated API access was not rejected.");
  const saved = await call("/api/conversations", { method: "POST", body: JSON.stringify({
    title: `Smoke check ${randomUUID()}`, source: { provider: "local" }, tags: ["smoke-check"],
    messages: [{ role: "assistant", content: "We decided to keep the relay in one process." }],
  }) });
  id = saved.conversation.id;
  const read = await call(`/api/conversations/${id}`);
  if (!read.analysis.decisions.length) throw new Error("Stored conversation did not produce a decision.");
  const handoff = await call(`/api/conversations/${id}/handoffs`, { method: "POST", body: JSON.stringify({ maxUses: 1, ttlMinutes: 5 }) });
  const packet = await call(`/share/${handoff.token}`, {}, false);
  if (packet.conversation.id !== id) throw new Error("Handoff did not return the saved conversation.");
  const exhausted = await fetch(new URL(`/share/${handoff.token}`, base));
  if (exhausted.status !== 404) throw new Error("Single-use handoff was redeemable twice.");
  console.log("PASS: liveness, readiness, authentication, save, analysis, handoff and use limit.");
} catch {
  console.error("Smoke check failed; inspect sanitized request logs and deployment configuration.");
  process.exitCode = 1;
} finally {
  if (id) {
    try { await call(`/api/conversations/${id}`, { method: "DELETE" }); }
    catch { console.error("Smoke cleanup failed; remove the conversation tagged smoke-check."); process.exitCode = 1; }
  }
}

async function call(path, options = {}, authenticated = true) {
  const response = await fetch(new URL(path, base), { ...options, headers: authenticated ? headers : {}, signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error("Unexpected HTTP response.");
  return response.status === 204 ? undefined : response.json();
}
