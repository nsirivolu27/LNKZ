/**
 * The MVP gate, run end to end against two real relays.
 *
 * Every other check in this repository tests a part. `pnpm test` exercises the
 * stores and the importers in process, `verify:http` checks one running server,
 * and `demo.mjs` narrates a walkthrough for a viewer. None of them answers the
 * only question that decides whether this product works:
 *
 *   can a conversation leave one person's instance, be continued on another
 *   person's instance under a different provider, and still know where it came
 *   from?
 *
 * This script answers that, with two processes, two SQLite files, and hard
 * assertions. It is deliberately not a narrated demo: every step either passes
 * with a reason or fails with the specific thing that was wrong. A generic
 * "demo failed" tells you nothing at 2am.
 *
 * Usage, after `pnpm build`:
 *
 *   node scripts/acceptance.mjs
 *
 * Exit code 0 means the MVP gate is met. Anything else names the step.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "lnkz-acceptance-"));
const running = [];
let step = 0;
let passed = false;

/** A planted secret, so redaction has something visible to strip. */
const PLANTED_CREDENTIAL = "sk-live-4f9c2b7e1a8d6035e2c4a90b7d15f8e3";

const TRANSCRIPT = {
  title: "Which store for the single node relay",
  source: { provider: "chatgpt", app: "ChatGPT" },
  participants: ["Nihal"],
  tags: ["storage", "acceptance"],
  messages: [
    { role: "user", content: "Postgres or SQLite for a relay that one person runs?" },
    { role: "assistant", content: "We decided to use SQLite for the single node case, because there is no second writer." },
    { role: "user", content: `Here is the staging key so you can check the dashboard: ${PLANTED_CREDENTIAL}` },
    { role: "assistant", content: "Open question: at what node count does that stop holding? Action: revisit at ten nodes." },
  ],
};

function pass(description) {
  step += 1;
  console.log(`  ${String(step).padStart(2, " ")}. ok   ${description}`);
}

try {
  console.log("LNKZ acceptance: a conversation crossing between two instances\n");

  // Both relays allow private addresses because both are on loopback here. In
  // production neither would, and transfer.ts refuses private destinations by
  // default for exactly that reason.
  const a = await start("A");
  const b = await start("B");
  pass("two relays are running on separate databases");

  // 1. A person saves a conversation from an LLM client.
  const original = (await call(a, "POST", "/api/conversations", TRANSCRIPT)).conversation;
  assert.ok(original.id, "A did not return an id for the saved conversation");
  assert.equal(original.messages.length, 4, "A did not store every message");
  pass("a transcript is imported into relay A with its turns in order");

  // 2. Deterministic analysis, not a model call.
  const read = await call(a, "GET", `/api/conversations/${original.id}`);
  assert.ok(read.analysis, "A returned no analysis for the conversation");
  assert.ok(read.analysis.decisions.length > 0, "A found no decision in a transcript that states one");
  pass("A produces analysis with at least one decision");

  // 3. Search has to find it, or the library is useless at any real size.
  const found = await call(a, "POST", "/api/conversations/search", { query: "SQLite single node", limit: 10 });
  assert.ok(Array.isArray(found.matches), "search did not return a matches array; the response shape changed");
  assert.ok(found.matches.some((match) => match.id === original.id), "search on A did not return the conversation it just stored");
  pass("search on A finds the conversation");

  // 4. A context packet, under budget, carrying the useful parts.
  const packet = (await call(a, "POST", "/api/context/packet", { query: "store for the relay", budgetTokens: 1500 })).packet;
  assert.ok(packet, "A returned no packet");
  assert.ok(packet.conversations?.length > 0, "the packet contained no conversations");
  assert.ok(packet.usedTokens <= packet.budgetTokens, `the packet used ${packet.usedTokens} tokens against a budget of ${packet.budgetTokens}`);
  assert.ok(
    packet.conversations.some((entry) => entry.decisions.length || entry.openQuestions.length || entry.actionItems.length),
    "the packet carried transcript but none of the decisions, questions or actions that make it worth sending",
  );
  pass("A builds a context packet within a token budget, carrying decisions and questions");

  // 5. A scoped handoff. One use, so looking at it and taking it cannot both
  // work unless looking is genuinely free. Redaction on, so the planted
  // credential must not leave.
  const handoff = await call(a, "POST", `/api/conversations/${original.id}/handoffs`, {
    ttlMinutes: 10, maxUses: 1, audience: "a colleague", redact: true,
  });
  assert.ok(handoff.shareUrl, "A did not return a share url");
  assert.ok(handoff.id, "A did not return a handoff id, so it cannot be revoked");
  pass("A creates a redacted one-use handoff with an expiry");

  // 6. Look before taking. This is the regression test: a dry run used to
  // redeem the link, so on a one-use link the preview succeeded and the import
  // that followed failed. Peeking twice here would have spent it twice over.
  const firstLook = await call(b, "POST", "/api/conversations/import-url", { url: handoff.shareUrl, dryRun: true });
  assert.equal(firstLook.preview.messages, 4, "the preview did not describe the conversation");
  const secondLook = await call(b, "POST", "/api/conversations/import-url", { url: handoff.shareUrl, dryRun: true });
  assert.equal(secondLook.preview.usesRemaining, 1, `looking at the link spent a use; ${secondLook.preview.usesRemaining} left after two previews`);
  pass("previewing the link twice does not spend its single use");

  // 7. B pulls it. B never pushed anything to A and A never pushed to B.
  const imported = (await call(b, "POST", "/api/conversations/import-url", { url: handoff.shareUrl })).conversation;
  const onB = (await call(b, "GET", `/api/conversations/${imported.id}`)).conversation;
  assert.notEqual(onB.id, original.id, "B reused A's id instead of assigning its own");
  assert.equal(onB.lineage?.originConversationId, original.id, "B lost the id it came from");
  assert.ok(onB.lineage?.originInstance, "B did not record which instance sent this");
  pass("B imports the handoff and records where it came from");

  // The credential was in the transcript on A. Redaction happens on the way
  // out, so B must never have seen it at all.
  const bodyOnB = JSON.stringify(onB);
  assert.ok(!bodyOnB.includes(PLANTED_CREDENTIAL), "the planted credential crossed to B despite redaction being on");
  pass("redaction stripped the planted credential before it left A");

  // The link is now spent. A second attempt must fail, and this is the only
  // place exhaustion is proved; the revocation step below uses a fresh link so
  // the two cannot be confused for each other.
  await assert.rejects(
    () => call(b, "POST", "/api/conversations/import-url", { url: handoff.shareUrl }),
    /invalid, revoked, exhausted, or expired|422/,
    "a one-use link was redeemable twice",
  );
  pass("the one-use link is spent after a single import");

  // 8 and 9. The heart of it. B continues the work under a different provider,
  // and the result is a NEW conversation on B that knows its root, not an edit
  // of the imported copy. A fresh link, because the first one is spent.
  const forContinuing = await call(a, "POST", `/api/conversations/${original.id}/handoffs`, {
    ttlMinutes: 10, maxUses: 1, redact: true,
  });
  const continued = (await call(b, "POST", "/api/handoffs/continue", {
    url: forContinuing.shareUrl,
    provider: "claude",
    messages: [{ role: "assistant", content: "Agreed. SQLite now, and we revisit at ten nodes as noted." }],
  })).conversation;
  assert.ok(continued.id, "B did not return a continuation");
  assert.notEqual(continued.id, onB.id, "the continuation overwrote the imported copy instead of being a new conversation");
  assert.equal(continued.lineage?.continuedBy, "claude", "the continuation did not record which provider carried it forward");
  assert.ok(continued.lineage?.handoffId, "the continuation did not record the handoff it came through");
  assert.equal(continued.lineage?.rootId, original.id, "the chain root did not survive the crossing");
  assert.ok(continued.messages.length > onB.messages.length, "the continuation did not add the new turn");
  pass("B continues it under another provider as a new conversation with intact lineage");

  // 9. A is untouched. This is what makes a handoff a copy and not a move.
  const stillOnA = (await call(a, "GET", `/api/conversations/${original.id}`)).conversation;
  assert.equal(stillOnA.messages.length, 4, "A's original changed when B continued it");
  assert.ok(JSON.stringify(stillOnA).includes(PLANTED_CREDENTIAL), "A's own copy was redacted; redaction is for the packet leaving, not the stored original");
  pass("A's original is unchanged by anything B did");

  // 11. Revocation, on a link with uses left. Revoking an already-exhausted
  // link proves nothing: it was already refusing. This one has never been used.
  const toRevoke = await call(a, "POST", `/api/conversations/${original.id}/handoffs`, {
    ttlMinutes: 10, maxUses: 5, redact: true,
  });
  const beforeRevoke = await fetch(toRevoke.shareUrl + "/preview");
  assert.equal(beforeRevoke.status, 200, "a fresh link was not redeemable before revocation, so the test proves nothing");

  await call(a, "DELETE", `/api/handoffs/${toRevoke.id}`);
  const afterRevoke = await fetch(toRevoke.shareUrl);
  assert.equal(afterRevoke.status, 404, `a revoked link still redeemed, status ${afterRevoke.status}`);
  await assert.rejects(
    () => call(b, "POST", "/api/handoffs/continue", {
      url: toRevoke.shareUrl, provider: "claude", messages: [{ role: "assistant", content: "Too late." }],
    }),
    /invalid, revoked, exhausted, or expired|422/,
    "a revoked link could still be continued",
  );
  pass("revoking a link with four uses left stops redemption on both paths");

  // 11. Restart B on the same database. Nothing may be lost.
  await stop(b);
  const bAgain = await start("B", b.port, b.key);
  const survived = (await call(bAgain, "GET", `/api/conversations/${continued.id}`)).conversation;
  assert.equal(survived.lineage?.rootId, original.id, "lineage did not survive a restart of B");
  assert.equal(survived.messages.length, continued.messages.length, "messages did not survive a restart of B");
  pass("B restarts and the continuation is still there with its lineage");

  passed = true;
} catch (error) {
  console.error(`\nFAIL at step ${step + 1}: ${error.message}`);
  if (error.cause) console.error(`  cause: ${error.cause}`);
  process.exitCode = 1;
} finally {
  // Iterate a copy. stop() removes the service from `running`, and mutating the
  // array being iterated skipped every second relay, which left a process alive
  // holding its database file open.
  for (const service of [...running]) await stop(service);

  try {
    // Windows will not unlink a SQLite file the moment the process holding it
    // exits, so a single attempt reports EBUSY on a run that was otherwise
    // fine. Retry briefly, and treat a leftover temp directory as untidy
    // rather than as a failed acceptance run.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  } catch (error) {
    console.warn(`\nNote: could not remove ${directory} (${error.code ?? error.message}). Temporary files were left behind.`);
  }

  // Printed last, and only from here, so a cleanup problem can never appear
  // after the word PASS and make a clean run look broken.
  if (passed) console.log("\nPASS: the MVP gate is met.");
}

/**
 * Start a relay. Pass a port and key to restart an existing one on its own
 * database, which is how the persistence check works.
 */
async function start(name, port, key) {
  port ??= await freePort();
  key ??= randomBytes(32).toString("base64url");
  const base = `http://127.0.0.1:${port}`;

  // Strip inherited configuration so a developer's own environment cannot
  // change what this proves. A run that passes here because DATABASE_URL was
  // set is not a run that passed.
  const env = { ...process.env };
  for (const variable of Object.keys(env)) {
    if (/^(LNKZ_|DATABASE_|SLACK_|JIRA_|FIGMA_|DOCUMENT_FEED_|FANTASY_)/.test(variable)) delete env[variable];
  }

  const child = spawn(process.execPath, ["dist/index.mjs"], {
    env: {
      ...env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      LNKZ_API_KEY: key,
      LNKZ_PUBLIC_BASE_URL: base,
      LNKZ_DB_FILE: join(directory, `${name}.db`),
      ALLOWED_HOSTS: "localhost,127.0.0.1",
      ALLOWED_ORIGINS: base,
      // Both instances are on loopback here. transfer.ts refuses private
      // destinations by default and that default stays untouched in production.
      LNKZ_TRANSFER_ALLOW_PRIVATE: "true",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  const service = { name, child, key, base, port };
  running.push(service);

  for (let tries = 0; tries < 150; tries += 1) {
    if (child.exitCode !== null) throw new Error(`relay ${name} exited during startup; run 'pnpm build' first`);
    try { if ((await fetch(`${base}/ready`)).ok) return service; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`relay ${name} never became ready on ${base}`);
}

async function stop(service) {
  const index = running.indexOf(service);
  if (index >= 0) running.splice(index, 1);
  if (service.child.exitCode !== null) return;
  const exited = new Promise((resolve) => service.child.once("exit", resolve));
  service.child.kill();
  await exited;
}

async function call(service, method, path, body) {
  const response = await fetch(`${service.base}${path}`, {
    method,
    headers: { authorization: `Bearer ${service.key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return {};
  const text = await response.text();
  if (!response.ok) {
    // The body matters here. "Request failed" sends you reading source; the
    // server's own message usually names the field it rejected.
    throw new Error(`${method} ${path} on ${service.name} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
