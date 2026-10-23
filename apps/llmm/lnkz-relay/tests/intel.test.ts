import assert from "node:assert/strict";
import test from "node:test";
import { analyzeConversation, approxTokens } from "../src/intel/analyze.js";
import { detectConflicts, detectDuplicates } from "../src/intel/conflict.js";
import { buildContextPacket } from "../src/intel/packet.js";
import { redactConversation, redactText } from "../src/intel/redact.js";
import { textSimilarity } from "../src/intel/similarity.js";
import { SqliteConversationStore } from "../src/store/index.js";
import type { Conversation } from "../src/types.js";

function conversation(id: string, title: string, contents: string[]): Conversation {
  return {
    id,
    version: 1,
    title,
    source: { provider: "chatgpt" },
    participants: ["Nihal"],
    tags: [],
    messages: contents.map((content, index) => ({
      id: `${id}-m${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content,
      createdAt: "2026-03-01T00:00:00.000Z",
    })),
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}

test("analysis separates decisions, open questions, and action items", () => {
  const analysis = analyzeConversation(conversation("a", "Storage choice", [
    "Should the store be Postgres or SQLite for the first release?",
    "We decided to use SQLite because it removes the deployment dependency.",
    "I will migrate the JSON snapshot on first boot.",
    "It is still unclear whether we need WAL checkpoints on the hosted plan.",
  ]));

  assert.ok(analysis.decisions.some((claim) => claim.text.includes("SQLite")));
  assert.ok(analysis.actionItems.some((claim) => claim.text.includes("migrate")));
  assert.ok(analysis.openQuestions.some((claim) => claim.text.includes("Postgres or SQLite")));
  assert.ok(analysis.openQuestions.some((claim) => claim.text.includes("WAL checkpoints")));
  assert.ok(analysis.topics.length > 0);
  assert.equal(analysis.messageCount, 4);
});

test("claims carry the message they came from so a reader can go back to the source", () => {
  const analysis = analyzeConversation(conversation("b", "Attribution", [
    "We decided to ship the staged rollout on Tuesday.",
  ]));
  assert.equal(analysis.decisions[0].messageId, "b-m0");
  assert.equal(analysis.decisions[0].author, "user");
});

test("conflicting decisions across two conversations are flagged", () => {
  const conflicts = detectConflicts([
    conversation("c1", "Storage decision", ["We decided to use SQLite for the conversation store."]),
    conversation("c2", "Storage revisited", ["We decided to use Postgres for the conversation store."]),
  ]);

  assert.equal(conflicts.length >= 1, true);
  assert.match(conflicts[0].reason, /different choice/i);
});

test("agreeing decisions are not reported as conflicts", () => {
  const conflicts = detectConflicts([
    conversation("d1", "Storage decision", ["We decided to use SQLite for the conversation store."]),
    conversation("d2", "Unrelated", ["We decided to move standup to Thursday mornings."]),
  ]);
  assert.equal(conflicts.length, 0);
});

test("near-duplicate conversations are detected and distinct ones are not", () => {
  const original = conversation("e1", "Relay", [
    "Explain how the handoff token is stored and why the plaintext never touches disk.",
    "The token is hashed with SHA-256 and only the digest is persisted by the store.",
  ]);
  const relayed = conversation("e2", "Relay (via Claude)", original.messages.map((message) => message.content));
  const other = conversation("e3", "Groceries", ["We need milk, bread, and coffee before Friday."]);

  const duplicates = detectDuplicates([original, relayed, other]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].right.conversationId, "e2");
  assert.ok(duplicates[0].similarity > 0.9);
  assert.ok(textSimilarity("alpha beta gamma delta", "nothing at all alike") < 0.1);
});

test("redaction removes credentials and leaves ordinary text alone", () => {
  const secrets = redactText(
    "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 token ghp_abcdefghijklmnopqrstuvwxyz0123 and postgres://user:pw@db.example/app",
  );
  assert.equal(secrets.text.includes("sk-ant-api03"), false);
  assert.equal(secrets.text.includes("ghp_"), false);
  assert.equal(secrets.text.includes("pw@db.example"), false);
  assert.ok(secrets.removed.size >= 3);

  const untouched = redactText("The release is version 1.2.3 and the build ran in 4200 ms.");
  assert.equal(untouched.text, "The release is version 1.2.3 and the build ran in 4200 ms.");
  assert.equal(untouched.removed.size, 0);
});

test("aggressive redaction is opt-in, so emails survive an ordinary export", () => {
  const source = conversation("f1", "Contact", ["Ping nihal@example.com when the deploy is green."]);
  assert.ok(redactConversation(source).conversation.messages[0].content.includes("nihal@example.com"));
  assert.equal(
    redactConversation(source, { aggressive: true }).conversation.messages[0].content.includes("nihal@example.com"),
    false,
  );
});

test("a context packet respects its token budget and reports what it used", async (t) => {
  const store = new SqliteConversationStore(":memory:");
  t.after(() => store.close());

  await store.save({
    title: "Rollout plan",
    source: { provider: "chatgpt" },
    tags: ["launch"],
    messages: [
      { role: "user", content: "Which rollout do we use for the pricing page?" },
      { role: "assistant", content: "We decided to go with the staged rollout. I will prepare the flag by Monday." },
      { role: "user", content: `Filler context. ${"detail ".repeat(4_000)}` },
    ],
  });

  const packet = await buildContextPacket(store, [], { query: "rollout", budgetTokens: 900, includeExternal: false });

  assert.equal(packet.conversations.length, 1);
  assert.ok(packet.usedTokens <= packet.budgetTokens, `used ${packet.usedTokens} of ${packet.budgetTokens}`);
  assert.ok(packet.conversations[0].decisions.some((text) => text.includes("staged rollout")));
  assert.ok(packet.markdown.includes("# LNKZ context packet"));
  assert.ok(approxTokens(packet.markdown) < packet.budgetTokens * 2);
});

test("a packet built from explicit ids does not need a query", async (t) => {
  const store = new SqliteConversationStore(":memory:");
  t.after(() => store.close());

  const saved = await store.save({
    title: "Direct packet",
    source: { provider: "claude" },
    messages: [{ role: "user", content: "We decided to keep the JSON importer for one release." }],
  });

  const packet = await buildContextPacket(store, [], { conversationIds: [saved.id], includeExternal: false });
  assert.equal(packet.conversations[0].id, saved.id);
  assert.equal(packet.conversations[0].relevance, 1);
});
