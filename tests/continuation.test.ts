import assert from "node:assert/strict";
import test from "node:test";
import { localContinuation, remoteContinuation } from "../src/lnkz/continuation.js";
import { SqliteConversationStore } from "../src/lnkz/store/index.js";

const PARENT = {
  title: "Which store for the relay",
  summary: "Storage choice for a single node deployment.",
  participants: ["Nihal"],
  tags: ["storage"],
  messages: [
    { role: "user" as const, content: "Postgres or SQLite?" },
    { role: "assistant" as const, content: "We decided to use SQLite for the single node case." },
  ],
};

const REPLY = [{ role: "assistant" as const, content: "Agreed. Revisit at ten nodes." }];

test("a local continuation points at the parent row and inherits the chain root", () => {
  const first = localContinuation({
    parent: PARENT,
    parentId: "aaaaaaaa-0000-4000-8000-000000000001",
    handoffId: "hhhhhhhh-0000-4000-8000-000000000001",
    provider: "claude",
    messages: REPLY,
  });

  // The parent has no lineage, so it is itself the start of the chain.
  assert.equal(first.lineage?.parentId, "aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(first.lineage?.rootId, "aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(first.lineage?.handoffId, "hhhhhhhh-0000-4000-8000-000000000001");
  assert.equal(first.lineage?.continuedBy, "claude");

  // Continuing the continuation must keep the original root rather than
  // restarting the chain at the most recent link.
  const second = localContinuation({
    parent: { ...PARENT, lineage: { rootId: "rrrrrrrr-0000-4000-8000-000000000001" } },
    parentId: "aaaaaaaa-0000-4000-8000-000000000002",
    handoffId: "hhhhhhhh-0000-4000-8000-000000000002",
    provider: "gemini",
    messages: REPLY,
  });
  assert.equal(second.lineage?.parentId, "aaaaaaaa-0000-4000-8000-000000000002");
  assert.equal(second.lineage?.rootId, "rrrrrrrr-0000-4000-8000-000000000001", "continuing a continuation restarted the chain");
});

test("a remote continuation never carries parentId across the machine boundary", () => {
  const continued = remoteContinuation({
    parent: PARENT,
    origin: {
      instance: "https://theirs.example.com",
      handoffId: "hhhhhhhh-0000-4000-8000-000000000003",
      conversationId: "their-own-id-42",
    },
    provider: "claude",
    messages: REPLY,
  });

  // This is the whole point of the module. parentId names a row in the sending
  // instance's database. Copying it here produces lineage that reads as though
  // it resolves locally and does not.
  assert.equal(continued.lineage?.parentId, undefined, "parentId crossed an instance boundary");

  assert.equal(continued.lineage?.originInstance, "https://theirs.example.com");
  assert.equal(continued.lineage?.originConversationId, "their-own-id-42");
  assert.equal(continued.lineage?.handoffId, "hhhhhhhh-0000-4000-8000-000000000003");
  assert.equal(continued.lineage?.continuedBy, "claude");
  assert.ok(continued.lineage?.importedAt, "the arrival time was not recorded");

  // With no root on the packet, the sender's conversation is the root.
  assert.equal(continued.lineage?.rootId, "their-own-id-42");
});

test("a remote continuation of an already-travelled conversation keeps the first root", () => {
  // B continued A's work, handed it back, and A is now continuing it again.
  // The root must still be A's original, not the id B assigned on the way past.
  const continued = remoteContinuation({
    parent: { ...PARENT, lineage: { rootId: "the-original-on-a", originInstance: "https://mine.example.com" } },
    origin: { instance: "https://theirs.example.com", conversationId: "bs-copy" },
    provider: "chatgpt",
    messages: REPLY,
  });
  assert.equal(continued.lineage?.rootId, "the-original-on-a", "a second crossing reset the chain root");
});

test("both paths carry the transcript forward and tag the result once", () => {
  for (const continued of [
    localContinuation({ parent: PARENT, parentId: "a", handoffId: "h", provider: "claude", messages: REPLY }),
    remoteContinuation({ parent: PARENT, origin: { instance: "https://theirs.example.com" }, provider: "claude", messages: REPLY }),
  ]) {
    assert.equal(continued.messages.length, 3, "the continuation did not carry the parent transcript");
    assert.equal(continued.messages.at(-1)?.content, REPLY[0].content, "the new turn is not last");
    assert.equal(continued.source.provider, "claude", "the continuation did not record the provider that carried it");
    assert.deepEqual(continued.tags, ["storage", "continuation"]);
  }

  // A conversation that already went around once must not collect the tag
  // again on the next hop.
  const again = localContinuation({
    parent: { ...PARENT, tags: ["storage", "continuation"] },
    parentId: "a", handoffId: "h", provider: "claude", messages: REPLY,
  });
  assert.deepEqual(again.tags, ["storage", "continuation"], "the continuation tag accumulated per hop");
});

test("what the builders produce survives a real save", async () => {
  // The builders returning the right object is half the guarantee. The other
  // half is the store keeping it, which is the half that failed before: both
  // stores rebuild lineage field by field, so a field nobody copied is dropped
  // on write with nothing failing.
  const store = new SqliteConversationStore(":memory:");
  try {
    const saved = await store.save(remoteContinuation({
      parent: PARENT,
      origin: { instance: "https://theirs.example.com", handoffId: "h-1", conversationId: "theirs-1" },
      provider: "claude",
      messages: REPLY,
    }));

    const reloaded = await store.get(saved.id);
    if (!reloaded) throw new Error("the saved continuation could not be read back");
    assert.equal(reloaded.lineage?.originInstance, "https://theirs.example.com");
    assert.equal(reloaded.lineage?.originConversationId, "theirs-1");
    assert.equal(reloaded.lineage?.rootId, "theirs-1");
    assert.equal(reloaded.lineage?.continuedBy, "claude");
    assert.equal(reloaded.lineage?.parentId, undefined);
    assert.equal(reloaded.messages.length, 3);
  } finally {
    store.close();
  }
});
