import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchTransfer } from "../src/lnkz/transfer.js";
import { SqliteConversationStore } from "../src/lnkz/store/index.js";
import type { ConversationStore } from "../src/lnkz/store/index.js";

const LOCAL = { LNKZ_TRANSFER_ALLOW_PRIVATE: "true" } as NodeJS.ProcessEnv;

/**
 * transfer.test.ts covers one crossing: a link becomes a local conversation,
 * and the origin is recorded. This file covers the trip back, which is where
 * the chain either survives or quietly breaks, and which nothing exercised.
 *
 * Each instance is a store plus an HTTP server answering /share/:token off it,
 * the way server.ts does. Two of them on two ports is two people running their
 * own LNKZ, which is the topology the product is built for.
 */
async function instance(): Promise<{ store: ConversationStore; origin: string; close: () => Promise<void> }> {
  const store = new SqliteConversationStore(":memory:");
  const server = createServer(async (request, response) => {
    const token = request.url?.replace(/^\/share\//, "") ?? "";
    const packet = await store.redeemHandoff(token);
    if (!packet) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "gone" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(packet));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

/** What continue_handoff does, applied to a conversation already in this store. */
async function continueLocally(store: ConversationStore, parentId: string, provider: string, reply: string) {
  const parent = await store.get(parentId);
  assert.ok(parent, "the parent must be in this store to continue it");
  return store.save({
    title: `${parent.title} (continued in ${provider})`,
    summary: parent.summary,
    source: { provider },
    participants: parent.participants,
    tags: [...new Set([...parent.tags, "continuation"])],
    messages: [...parent.messages, { role: "assistant", content: reply }],
    lineage: {
      parentId: parent.id,
      rootId: parent.lineage?.rootId ?? parent.id,
      continuedBy: provider,
    },
  });
}

async function handTo(from: { store: ConversationStore; origin: string }, conversationId: string): Promise<string> {
  const handoff = await from.store.createHandoff({ conversationId, ttlMinutes: 60, maxUses: 2 });
  return `${from.origin}/share/${handoff.token}`;
}

test("a conversation goes to another instance, is continued there, and comes back with its chain intact", async () => {
  const a = await instance();
  const b = await instance();
  try {
    const original = await a.store.save({
      title: "Which store for the relay",
      source: { provider: "chatgpt" },
      participants: ["Nihal"],
      tags: ["storage"],
      messages: [
        { role: "user", content: "Postgres or SQLite for a single-node relay?" },
        { role: "assistant", content: "We decided to use SQLite for the single-node case." },
      ],
    });

    // A hands it to B, and B stores its own copy.
    const arrivedAtB = await fetchTransfer(await handTo(a, original.id), LOCAL);
    const copyOnB = await b.store.save(arrivedAtB.conversation);

    assert.notEqual(copyOnB.id, original.id, "B assigns its own id");
    assert.equal(copyOnB.lineage?.originConversationId, original.id);
    assert.equal(copyOnB.lineage?.rootId, original.id, "the root crosses over with the conversation");

    // B carries the work forward on its own instance.
    const continuedOnB = await continueLocally(b.store, copyOnB.id, "claude", "Agreed. SQLite now, revisit at ten nodes.");
    assert.equal(continuedOnB.lineage?.parentId, copyOnB.id);
    assert.equal(continuedOnB.lineage?.rootId, original.id, "continuing on B does not lose the root");
    assert.equal(continuedOnB.messages.length, 3);

    // B hands the continuation back to A.
    const arrivedAtA = await fetchTransfer(await handTo(b, continuedOnB.id), LOCAL);
    const returnedToA = await a.store.save(arrivedAtA.conversation);

    assert.equal(returnedToA.lineage?.originInstance, b.origin);
    assert.equal(returnedToA.lineage?.originConversationId, continuedOnB.id);
    assert.equal(returnedToA.messages.length, 3, "B's reply came back with it");

    // The assertion the whole product rests on: after going out to another
    // instance, being continued there, and coming back, A can still walk from
    // the returned copy to its own original. Without the root surviving both
    // crossings this resolves to an id that exists on neither machine.
    assert.equal(returnedToA.lineage?.rootId, original.id);
    const root = await a.store.get(returnedToA.lineage?.rootId ?? "");
    assert.ok(root, "the root resolves on A");
    assert.equal(root.id, original.id);
    assert.equal(root.messages.length, 2, "and it is the untouched original, not the continuation");
  } finally {
    await a.close();
    await b.close();
  }
});

test("a handoff is spent by the transfer, so a link cannot be replayed past its limit", async () => {
  const a = await instance();
  const b = await instance();
  try {
    const original = await a.store.save({
      title: "Single use",
      source: { provider: "local" },
      messages: [{ role: "user", content: "Only once." }],
    });
    const handoff = await a.store.createHandoff({ conversationId: original.id, ttlMinutes: 60, maxUses: 1 });
    const link = `${a.origin}/share/${handoff.token}`;

    await b.store.save((await fetchTransfer(link, LOCAL)).conversation);
    await assert.rejects(() => fetchTransfer(link, LOCAL), /invalid, revoked, exhausted, or expired/);
  } finally {
    await a.close();
    await b.close();
  }
});

test("an instance can list what was handed to it, and by whom", async () => {
  const a = await instance();
  const b = await instance();
  try {
    const local = await b.store.save({
      title: "Made here",
      source: { provider: "local" },
      messages: [{ role: "user", content: "Native to B." }],
    });
    const remote = await a.store.save({
      title: "Made on A",
      source: { provider: "chatgpt" },
      messages: [{ role: "user", content: "Sent from A." }],
    });
    const imported = await b.store.save((await fetchTransfer(await handTo(a, remote.id), LOCAL)).conversation);

    // "any" is the recipient's actual question: what has been handed to me?
    const fromElsewhere = await b.store.list({ limit: 10, originInstance: "any" });
    assert.deepEqual(fromElsewhere.map((summary) => summary.id), [imported.id]);
    assert.equal(fromElsewhere[0]?.lineage?.originInstance, a.origin);

    // An exact origin narrows to one sender; a sender who sent nothing is empty.
    assert.equal((await b.store.list({ originInstance: a.origin })).length, 1);
    assert.equal((await b.store.list({ originInstance: "http://nobody.example" })).length, 0);

    // Locally authored conversations are still listed, and are not transfers.
    const everything = await b.store.list({ limit: 10 });
    assert.equal(everything.length, 2);
    assert.ok(everything.some((summary) => summary.id === local.id));
  } finally {
    await a.close();
    await b.close();
  }
});

test("every field declared on ConversationLineage survives a save", async () => {
  // Both stores rebuild lineage field by field and the input schema strips what
  // it does not declare, so a field added to the type and forgotten in either
  // place is dropped on write with nothing failing. The transfer fields were
  // added in exactly that way. This fails the moment it happens again.
  const store = new SqliteConversationStore(":memory:");
  try {
    const full = {
      parentId: "b0000001-0000-4000-8000-000000000001",
      rootId: "b0000002-0000-4000-8000-000000000002",
      handoffId: "b0000003-0000-4000-8000-000000000003",
      continuedBy: "claude",
      originInstance: "https://relay.example.com",
      originConversationId: "their-own-id-42",
      importedAt: "2026-09-07T18:00:00.000Z",
    };
    const saved = await store.save({
      title: "Lineage carries everything",
      source: { provider: "local" },
      messages: [{ role: "user", content: "Check the lineage." }],
      lineage: full,
    });

    const reloaded = await store.get(saved.id);
    assert.ok(reloaded);
    for (const [field, value] of Object.entries(full)) {
      assert.equal(
        (reloaded.lineage as Record<string, unknown> | undefined)?.[field],
        value,
        `lineage.${field} was dropped between save and get`,
      );
    }
  } finally {
    store.close();
  }
});
