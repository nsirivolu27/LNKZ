import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { mountHandoffRoutes } from "../src/lnkz/handoffs/wire.js";
import { SqliteConversationStore } from "../src/lnkz/store/index.js";
import type { ConversationStore } from "../src/lnkz/store/index.js";

/**
 * The handoff routes, exercised as routes.
 *
 * Everything else in this suite tests the store or a pure function. Three bugs
 * shipped in this surface and every one of them lived between the HTTP layer
 * and the store: a dry run that redeemed, a schema that broke a sibling
 * handler, a revocation path nothing called. None of them were reachable from
 * a store test, and all of them were found by hand. Now they are reachable.
 *
 * Each relay is a bare express app with the handoff routes mounted on it, no
 * auth and no rate limiting, which is what makes this a test of the routes
 * rather than of the deployment around them.
 */
// Both relays live on loopback, and transfer.ts refuses private addresses
// unless told otherwise. This is the same switch the two-instance demo uses,
// and it stays off everywhere that is not a developer's own machine. Set at
// module scope because the routes read process.env when they dial, and each
// test file runs in its own process.
process.env.LNKZ_TRANSFER_ALLOW_PRIVATE = "true";

async function relay(): Promise<{ store: ConversationStore; base: string; close: () => Promise<void> }> {
  const store = new SqliteConversationStore(":memory:");
  const app = express();
  app.use(express.json());

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  mountHandoffRoutes(app, store, {
    // Open, on purpose. Authentication has its own tests; mixing it in here
    // would mean a failure could be either layer.
    requireApiKey: (_request, _response, next) => next(),
    apiGuards: [],
    shareGuards: [],
    publicBaseUrl: base,
  });

  return {
    store,
    base,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

async function call(base: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

const TRANSCRIPT = {
  title: "Which store for the relay",
  source: { provider: "chatgpt" },
  tags: ["storage"],
  messages: [
    { role: "user" as const, content: "Postgres or SQLite?" },
    { role: "assistant" as const, content: "We decided to use SQLite for the single node case." },
  ],
};

test("previewing a link over HTTP does not spend a use, and importing after it still works", async () => {
  const a = await relay();
  try {
    const conversation = await a.store.save(TRANSCRIPT);
    const minted = await call(a.base, "POST", `/api/conversations/${conversation.id}/handoffs`, { ttlMinutes: 10, maxUses: 1 });
    assert.equal(minted.status, 201);
    const shareUrl: string = minted.body.shareUrl;

    for (const attempt of [1, 2]) {
      const peek = await fetch(`${shareUrl}/preview`);
      assert.equal(peek.status, 200, `preview ${attempt} returned ${peek.status}`);
      const payload = await peek.json();
      assert.equal(payload.format, "lnkz.preview.v1");
      assert.equal(payload.preview.usesRemaining, 1, `preview ${attempt} saw the use already spent`);
      assert.equal(payload.preview.messageCount, 2);
      assert.equal("messages" in payload.preview, false, "the preview carried the transcript");
    }

    // The single use is still there.
    const redeemed = await fetch(shareUrl);
    assert.equal(redeemed.status, 200, "the link could not be redeemed after being previewed twice");

    // And now it is gone, from both routes, with the two statuses that tell a
    // dead link apart from a relay that cannot preview.
    assert.equal((await fetch(shareUrl)).status, 404);
    assert.equal((await fetch(`${shareUrl}/preview`)).status, 410);
  } finally {
    await a.close();
  }
});

test("revoking a link with uses left stops redemption, preview and continuation", async () => {
  const a = await relay();
  const b = await relay();
  try {
    const conversation = await a.store.save(TRANSCRIPT);
    const minted = await call(a.base, "POST", `/api/conversations/${conversation.id}/handoffs`, { ttlMinutes: 10, maxUses: 5 });
    const shareUrl: string = minted.body.shareUrl;

    // Live first, so revocation is what stops it rather than exhaustion.
    assert.equal((await fetch(`${shareUrl}/preview`)).status, 200);

    const revoked = await call(a.base, "DELETE", `/api/handoffs/${minted.body.id}`);
    assert.equal(revoked.status, 204);

    assert.equal((await fetch(shareUrl)).status, 404);
    assert.equal((await fetch(`${shareUrl}/preview`)).status, 410);

    const continued = await call(b.base, "POST", "/api/handoffs/continue", {
      url: shareUrl, provider: "claude", messages: [{ role: "assistant", content: "Too late." }],
    });
    assert.equal(continued.status, 422, `a revoked link was continued, status ${continued.status}`);

    // Revoking twice is not an error the caller caused, but it is not a second
    // success either.
    assert.equal((await call(a.base, "DELETE", `/api/handoffs/${minted.body.id}`)).status, 404);
  } finally {
    await a.close();
    await b.close();
  }
});

test("continue takes a token or a url, and refuses a body naming both", async () => {
  const a = await relay();
  try {
    const conversation = await a.store.save(TRANSCRIPT);
    const minted = await call(a.base, "POST", `/api/conversations/${conversation.id}/handoffs`, { ttlMinutes: 10, maxUses: 3 });

    const both = await call(a.base, "POST", "/api/handoffs/continue", {
      token: minted.body.token,
      url: minted.body.shareUrl,
      provider: "claude",
      messages: [{ role: "assistant", content: "Which one did you mean?" }],
    });
    assert.equal(both.status, 400, "a body naming both a token and a url was accepted");

    const neither = await call(a.base, "POST", "/api/handoffs/continue", {
      provider: "claude", messages: [{ role: "assistant", content: "Nothing to redeem." }],
    });
    assert.equal(neither.status, 400, "a body naming neither was accepted");

    // The local form still works, and still points at the parent row.
    const local = await call(a.base, "POST", "/api/handoffs/continue", {
      token: minted.body.token,
      provider: "gemini",
      messages: [{ role: "assistant", content: "Carrying it forward here." }],
    });
    assert.equal(local.status, 201);
    assert.equal(local.body.conversation.lineage.parentId, conversation.id);
    assert.equal(local.body.conversation.lineage.rootId, conversation.id);
    assert.equal(local.body.conversation.lineage.continuedBy, "gemini");
    assert.equal(local.body.conversation.messages.length, 3);
  } finally {
    await a.close();
  }
});

test("a conversation continued from another relay records the origin and never a local parent", async () => {
  const a = await relay();
  const b = await relay();
  try {
    const conversation = await a.store.save(TRANSCRIPT);
    const minted = await call(a.base, "POST", `/api/conversations/${conversation.id}/handoffs`, { ttlMinutes: 10, maxUses: 2 });

    const continued = await call(b.base, "POST", "/api/handoffs/continue", {
      url: minted.body.shareUrl,
      provider: "claude",
      messages: [{ role: "assistant", content: "Agreed, revisit at ten nodes." }],
    });
    assert.equal(continued.status, 201, JSON.stringify(continued.body).slice(0, 200));

    const lineage = continued.body.conversation.lineage;
    assert.equal(lineage.parentId, undefined, "a parent id from another relay was stored as if it were local");
    assert.equal(lineage.rootId, conversation.id, "the chain root did not survive the crossing");
    assert.equal(lineage.originConversationId, conversation.id);
    assert.equal(lineage.originInstance, a.base);
    assert.equal(lineage.continuedBy, "claude");
    assert.equal(continued.body.conversation.messages.length, 3);

    // A's original is untouched by anything B did.
    const original = await a.store.get(conversation.id);
    assert.equal(original?.messages.length, 2);
  } finally {
    await a.close();
    await b.close();
  }
});
