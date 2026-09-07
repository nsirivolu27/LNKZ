import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchTransfer, isPublicAddress, safeUrl, TransferError } from "../src/lnkz/transfer.js";
import { SqliteConversationStore } from "../src/lnkz/store/index.js";

const LOCAL = { LNKZ_TRANSFER_ALLOW_PRIVATE: "true" } as NodeJS.ProcessEnv;

/** Serves one body on any path, so a test can act as the far instance. */
async function serve(body: string, status = 200): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/share/token`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A genuine packet, produced the way the sending instance produces one. */
async function realPacket(): Promise<string> {
  const store = new SqliteConversationStore(":memory:");
  try {
    const conversation = await store.save({
      title: "Which store for the relay",
      summary: "Settled on SQLite for single-node installs.",
      source: { provider: "chatgpt", app: "web" },
      participants: ["Nihal", "assistant"],
      tags: ["storage"],
      messages: [
        { role: "user", content: "Postgres or SQLite for a single-node relay?" },
        { role: "assistant", content: "We decided to use SQLite. I will write the migration." },
      ],
    });
    const handoff = await store.createHandoff({ conversationId: conversation.id, ttlMinutes: 60, maxUses: 3 });
    const packet = await store.redeemHandoff(handoff.token);
    assert.ok(packet, "the fixture handoff should redeem");
    return JSON.stringify(packet);
  } finally {
    store.close();
  }
}

test("a share link from another instance becomes a local conversation", async () => {
  const origin = await serve(await realPacket());
  try {
    const transfer = await fetchTransfer(origin.url, LOCAL);

    assert.equal(transfer.conversation.title, "Which store for the relay");
    assert.equal(transfer.conversation.messages.length, 2);
    assert.equal(transfer.conversation.source.provider, "chatgpt");
  } finally {
    await origin.close();
  }
});

test("a transferred conversation records where it came from", async () => {
  const origin = await serve(await realPacket());
  try {
    const transfer = await fetchTransfer(origin.url, LOCAL);
    const lineage = transfer.conversation.lineage ?? {};

    assert.equal(lineage.originInstance, new URL(origin.url).origin);
    assert.ok(lineage.originConversationId, "the origin's id is kept so the chain stays walkable");
    assert.ok(lineage.handoffId, "the handoff that carried it is recorded");
    assert.ok(lineage.importedAt, "and when it arrived");

    // The local id is the recipient's to assign. Two instances that both
    // imported the same conversation would otherwise collide on it.
    assert.equal(transfer.conversation.id, undefined);
    assert.notEqual(lineage.originConversationId, transfer.conversation.id);
  } finally {
    await origin.close();
  }
});

test("a link that is not a LNKZ packet is refused rather than half-imported", async () => {
  const origin = await serve(JSON.stringify({ hello: "world" }));
  try {
    await assert.rejects(() => fetchTransfer(origin.url, LOCAL), TransferError);
  } finally {
    await origin.close();
  }
});

test("an expired or revoked link reports what happened", async () => {
  const origin = await serve(JSON.stringify({ error: "gone" }), 404);
  try {
    await assert.rejects(
      () => fetchTransfer(origin.url, LOCAL),
      (error: Error) => error instanceof TransferError && /invalid, revoked, exhausted, or expired/.test(error.message),
    );
  } finally {
    await origin.close();
  }
});

test("the server refuses to fetch anything but a public http url", async () => {
  // The URL comes from whoever called the tool and the server is what dials it,
  // so an unchecked fetch turns "import this link" into "read anything my host
  // can reach". These are the shapes that attack takes.
  await assert.rejects(() => safeUrl("file:///etc/passwd"), TransferError);
  await assert.rejects(() => safeUrl("ftp://example.com/packet.json"), TransferError);
  await assert.rejects(() => safeUrl("https://user:secret@example.com/share/x"), TransferError);
  await assert.rejects(() => safeUrl("not a url at all"), TransferError);
});

test("private and metadata addresses are refused unless development explicitly allows them", async () => {
  await assert.rejects(() => safeUrl("http://169.254.169.254/latest/meta-data/"), TransferError);
  await assert.rejects(() => safeUrl("http://127.0.0.1:3100/share/x"), TransferError);
  await assert.rejects(() => safeUrl("http://10.0.0.5/share/x"), TransferError);
  await assert.rejects(() => safeUrl("http://192.168.1.20/share/x"), TransferError);
  await assert.rejects(() => safeUrl("http://[::1]/share/x"), TransferError);

  // The same links work with the development flag, which is what lets two
  // instances on one laptop transfer to each other.
  const allowed = await safeUrl("http://127.0.0.1:3100/share/x", LOCAL);
  assert.equal(allowed.hostname, "127.0.0.1");
});

test("address classification covers the ranges that matter", () => {
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("8.8.8.8"), true);

  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("169.254.169.254"), false, "the cloud metadata endpoint");
  assert.equal(isPublicAddress("10.1.2.3"), false);
  assert.equal(isPublicAddress("172.16.0.1"), false);
  assert.equal(isPublicAddress("172.32.0.1"), true, "172.32 is outside the private block");
  assert.equal(isPublicAddress("192.168.0.1"), false);
  assert.equal(isPublicAddress("100.64.0.1"), false, "carrier-grade NAT");
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("fd00::1"), false);
  assert.equal(isPublicAddress("::ffff:10.0.0.1"), false, "a private v4 address wearing a v6 hat");
  assert.equal(isPublicAddress("not-an-address"), false);
});
