import assert from "node:assert/strict";
import test from "node:test";
import { instanceIdForPublicKey, verifyHandoffPacket } from "../src/lnkz/identity.js";
import { SqliteConversationStore } from "../src/lnkz/store/index.js";

test("SQLite handoffs are signed by the persisted instance identity", async () => {
  const store = new SqliteConversationStore(":memory:");
  try {
    const conversation = await store.save({
      title: "Signed relay context",
      source: { provider: "test" },
      participants: ["user", "assistant"],
      messages: [{ role: "user", content: "Keep this packet intact." }],
    });
    const handoff = await store.createHandoff({ conversationId: conversation.id });
    const packet = await store.redeemHandoff(handoff.token);
    const identity = await store.getInstanceIdentity();

    assert.ok(packet);
    assert.ok(identity);
    assert.equal(packet.signingInstanceId, identity.instanceId);
    assert.equal(identity.instanceId, instanceIdForPublicKey(identity.publicKeyPem));
    assert.equal(verifyHandoffPacket(packet, identity.publicKeyPem), true);

    const tampered = {
      ...packet,
      conversation: { ...packet.conversation, title: "Changed after signing" },
    };
    assert.equal(verifyHandoffPacket(tampered, identity.publicKeyPem), false);
  } finally {
    store.close();
  }
});