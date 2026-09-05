import assert from "node:assert/strict";
import test from "node:test";
import { SqliteConversationStore } from "../src/store/index.js";
import { hashBearerToken, hashPassword } from "../src/security.js";
import type { Actor, ConversationInput } from "../src/types.js";

const actor: Actor = { id: "test-owner", workspaceId: "default", role: "owner", auth: "stdio", scope: "admin" };

function memoryStore(): SqliteConversationStore {
  return new SqliteConversationStore(":memory:");
}

function conversation(overrides: Partial<ConversationInput> = {}): ConversationInput {
  return {
    title: "Launch decision",
    summary: "Compared two launch plans and selected the lower-risk path.",
    source: { provider: "ChatGPT", app: "desktop" },
    participants: ["Nihal", "Assistant"],
    tags: ["launch"],
    messages: [
      { role: "user", content: "Compare the rollout plans for the pricing page." },
      { role: "assistant", content: "We decided to go with the staged rollout because it limits blast radius." },
    ],
    ...overrides,
  };
}

test("conversations round-trip with normalized provider, ids, and timestamps", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  const saved = await store.save(conversation(), actor);
  assert.equal(saved.source.provider, "chatgpt", "providers are lowercased so filters are stable");
  assert.equal(saved.messages.length, 2);
  assert.ok(saved.messages.every((message) => message.id && message.createdAt));

  const loaded = await store.get(saved.id, actor);
  assert.deepEqual(loaded?.messages.map((message) => message.content), saved.messages.map((message) => message.content));
  assert.equal(loaded?.createdAt, saved.createdAt);
});

test("updating a conversation keeps its creation time and replaces its messages", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  const saved = await store.save(conversation(), actor);
  const updated = await store.save({
    ...conversation({ title: "Launch decision (revised)" }),
    id: saved.id,
    messages: [{ role: "user", content: "Only one message now." }],
  }, actor);

  assert.equal(updated.id, saved.id);
  assert.equal(updated.createdAt, saved.createdAt);
  assert.equal(updated.title, "Launch decision (revised)");
  assert.equal((await store.get(saved.id, actor))?.messages.length, 1);
});

test("full-text search ranks matches and returns a snippet", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  await store.save(conversation({ title: "Staged rollout plan" }), actor);
  await store.save(conversation({
    title: "Dinner plans",
    summary: undefined,
    tags: [],
    messages: [{ role: "user", content: "Where should we eat on Friday?" }],
  }), actor);

  const matches = await store.search("staged rollout", 10, actor);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, "Staged rollout plan");
  assert.ok(matches[0].snippet.length > 0);
  assert.ok(matches[0].relevance > 0 && matches[0].relevance <= 1);

  assert.equal((await store.search("nothing matches this phrase", 5, actor)).length, 0);
  assert.equal((await store.search("!!!", 5, actor)).length, 0, "punctuation-only queries must not throw");
});

test("appending messages extends the thread instead of replacing it", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  const saved = await store.save(conversation(), actor);
  const extended = await store.appendMessages(saved.id, [
    { role: "user", content: "One more question before we ship." },
  ], actor);

  assert.equal(extended?.messages.length, 3);
  assert.equal(extended?.messages[2].content, "One more question before we ship.");
  assert.equal(await store.appendMessages("00000000-0000-4000-8000-000000000000", [], actor).then((value) => value), null);
});

test("handoffs are single-use when asked, and never store the plaintext token", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  const saved = await store.save(conversation(), actor);
  const handoff = await store.createHandoff({ conversationId: saved.id, ttlMinutes: 10, maxUses: 1 }, actor);

  const first = await store.redeemHandoff(handoff.token, actor);
  assert.equal(first?.conversation.id, saved.id);
  assert.equal(first?.handoff.usesRemaining, 0);
  assert.ok(first?.analysis.decisions.length, "a redeemed packet carries the extracted decisions");

  assert.equal(await store.redeemHandoff(handoff.token, actor), null, "a single-use link cannot be redeemed twice");

  const listed = await store.listHandoffs(saved.id, actor);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].active, false);
  assert.equal(JSON.stringify(listed).includes(handoff.token), false, "tokens must never leave the store");
});

test("revoked handoffs stop working immediately", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  const saved = await store.save(conversation(), actor);
  const handoff = await store.createHandoff({ conversationId: saved.id, ttlMinutes: 60, maxUses: 10 }, actor);
  assert.equal(await store.revokeHandoff(handoff.id, actor), true);
  assert.equal(await store.redeemHandoff(handoff.token, actor), null);
  assert.equal(await store.revokeHandoff(handoff.id, actor), false, "revoking twice is reported, not silently accepted");
});

test("a redacting handoff scrubs secrets before the packet leaves", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  const saved = await store.save(conversation({
    messages: [
      { role: "user", content: "Here is the staging key sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 and mail me at nihal@example.com." },
      { role: "assistant", content: "We decided to rotate it." },
    ],
  }), actor);

  const handoff = await store.createHandoff({ conversationId: saved.id, ttlMinutes: 10, redact: true }, actor);
  const packet = await store.redeemHandoff(handoff.token, actor);

  assert.ok(packet);
  assert.equal(packet.redaction.applied, true);
  assert.equal(packet.transcriptMarkdown.includes("sk-ant-api03"), false);
  assert.equal(packet.transcriptMarkdown.includes("nihal@example.com"), false);
  assert.ok(packet.transcriptMarkdown.includes("We decided to rotate it."), "redaction must not destroy the content");
});

test("deleting a conversation removes it from search and listings", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  const saved = await store.save(conversation(), actor);
  assert.equal(await store.remove(saved.id, actor), true);
  assert.equal(await store.get(saved.id, actor), null);
  assert.equal((await store.search("staged rollout", 5, actor)).length, 0);
  assert.equal((await store.list({}, actor)).length, 0);
  assert.equal(await store.remove(saved.id, actor), false);
});

test("listings filter by provider and tag, and stats count what is stored", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  await store.save(conversation(), actor);
  await store.save(conversation({
    title: "Gemini research",
    source: { provider: "gemini" },
    tags: ["research"],
  }), actor);

  assert.equal((await store.list({ provider: "gemini" }, actor)).length, 1);
  assert.equal((await store.list({ tag: "launch" }, actor)).length, 1);
  assert.equal((await store.list({ participant: "Nihal" }, actor)).length, 2);

  const stats = await store.stats(actor);
  assert.equal(stats.conversations, 2);
  assert.equal(stats.messages, 4);
  assert.deepEqual(stats.providers.map((entry) => entry.provider).sort(), ["chatgpt", "gemini"]);
});

test("the audit log records saves, handoffs, and rejected redemptions", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());

  const saved = await store.save(conversation(), actor);
  const handoff = await store.createHandoff({ conversationId: saved.id, ttlMinutes: 10, maxUses: 1 }, actor);
  await store.redeemHandoff(handoff.token, actor);
  await store.redeemHandoff(handoff.token, actor);

  const kinds = (await store.listEvents(50, actor)).map((event) => event.kind);
  assert.ok(kinds.includes("conversation.saved"));
  assert.ok(kinds.includes("handoff.created"));
  assert.ok(kinds.includes("handoff.redeemed"));
  assert.ok(kinds.includes("handoff.rejected"));
});

test("a handoff for an unknown conversation is refused", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());
  await assert.rejects(
    () => store.createHandoff({ conversationId: "00000000-0000-4000-8000-000000000000" }, actor),
    /Conversation not found/,
  );
});

test("workspace isolation returns 404-shaped nulls and scoped tokens cannot write", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());
  const ownerAccount = await store.createAccount("owner@example.com", await hashPassword("owner-password-2026"));
  const otherAccount = await store.createAccount("other@example.com", await hashPassword("other-password-2026"));
  const owner = { ...actor, id: ownerAccount.id, workspaceId: ownerAccount.workspaceId };
  const other = { ...actor, id: otherAccount.id, workspaceId: otherAccount.workspaceId };
  const saved = await store.save(conversation(), owner);

  assert.equal(await store.get(saved.id, other), null);
  assert.equal((await store.list({}, other)).length, 0);
  const token = await store.createApiToken(owner, "read");
  const resolved = await store.findApiToken(hashBearerToken(token.token));
  assert.equal(resolved?.actor.workspaceId, owner.workspaceId);
  await assert.rejects(() => store.save(conversation({ title: "blocked" }), resolved!.actor), /Forbidden/);
});

test("membership changes are reflected by session lookup and the capability matrix", async (t) => {
  const store = memoryStore();
  t.after(() => store.close());
  const ownerAccount = await store.createAccount("owner2@example.com", await hashPassword("owner-password-2026"));
  const memberAccount = await store.createAccount("member2@example.com", await hashPassword("member-password-2026"));
  const owner = { ...actor, id: ownerAccount.id, workspaceId: ownerAccount.workspaceId };
  const member = { ...actor, id: memberAccount.id, workspaceId: memberAccount.workspaceId };
  const invite = await store.createInvite(owner, memberAccount.email, "viewer", new Date(Date.now() + 60_000).toISOString());
  assert.equal(await store.acceptInvite(invite.token, member), true);
  const memberSession = "session-hash";
  await store.createSession({ ...memberAccount, workspaceId: owner.workspaceId, role: "viewer" }, memberSession, new Date(Date.now() + 60_000).toISOString(), new Date(Date.now() + 60_000).toISOString());
  assert.equal((await store.findSession(memberSession))?.actor.role, "viewer");
  assert.equal(await store.changeMemberRole(owner, member.id, "member"), true);
  assert.equal((await store.findSession(memberSession))?.actor.role, "member");
  await assert.rejects(() => store.listMembers({ ...member, workspaceId: owner.workspaceId, role: "member" }), /Forbidden/);
});
