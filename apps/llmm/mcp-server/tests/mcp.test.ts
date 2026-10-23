import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLnkzConnector } from "../src/connectors/lnkz.js";
import { createLnkzMcpServer } from "../src/mcp.js";
import { SqliteConversationStore } from "../src/store/index.js";

const EXPECTED_TOOLS = [
  "analyze_conversation",
  "append_messages",
  "audit_log",
  "build_context_graph",
  "build_context_packet",
  "continue_handoff",
  "create_handoff",
  "delete_conversation",
  "export_conversation",
  "find_conflicts",
  "find_duplicates",
  "get_conversation",
  "import_conversation",
  "list_connectors",
  "list_conversations",
  "list_handoffs",
  "list_publish_targets",
  "prepare_publish",
  "redeem_handoff",
  "revoke_handoff",
  "save_conversation",
  "search_context",
  "search_conversations",
  "workspace_stats",
];

async function connect(t: { after: (fn: () => unknown) => void }) {
  const store = new SqliteConversationStore(":memory:");
  const server = createLnkzMcpServer(store, [createLnkzConnector(store)], "https://lnkz.example");
  const client = new Client({ name: "lnkz-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await server.close();
    store.close();
  });
  return { store, client };
}

function structured<T>(result: unknown): T {
  return (result as { structuredContent: T }).structuredContent;
}

function textOf(result: unknown): string {
  const blocks = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return blocks.map((block) => block.text ?? "").join("\n");
}

test("the MCP surface exposes the full relay lifecycle", async (t) => {
  const { client } = await connect(t);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), EXPECTED_TOOLS);

  const prompts = await client.listPrompts();
  assert.deepEqual(
    prompts.prompts.map((prompt) => prompt.name).sort(),
    ["continue_shared_conversation", "prepare_handoff", "reconcile_conflicts", "research_brief"],
  );

  const resources = await client.listResources();
  assert.deepEqual(
    resources.resources.map((resource) => resource.uri).sort(),
    ["lnkz://connectors", "lnkz://conversations", "lnkz://graph", "lnkz://stats"],
  );
});

test("a chat can be saved, found, packaged, and handed off over MCP", async (t) => {
  const { client } = await connect(t);

  const saveResult = await client.callTool({
    name: "save_conversation",
    arguments: {
      title: "MCP portability test",
      source: { provider: "local-model" },
      tags: ["research"],
      messages: [
        { role: "user", content: "Which store should the relay use?" },
        { role: "assistant", content: "We decided to use SQLite. I will write the migration." },
      ],
    },
  });
  assert.equal(saveResult.isError, undefined);
  const saved = structured<{ conversation: { id: string } }>(saveResult).conversation;

  const searchResult = await client.callTool({ name: "search_conversations", arguments: { query: "sqlite relay" } });
  assert.equal(structured<{ matches: unknown[] }>(searchResult).matches.length, 1);

  const packetResult = await client.callTool({
    name: "build_context_packet",
    arguments: { query: "sqlite", budgetTokens: 1_000, includeExternal: false },
  });
  assert.match(textOf(packetResult), /LNKZ context packet/);

  const handoffResult = await client.callTool({
    name: "create_handoff",
    arguments: { conversationId: saved.id, ttlMinutes: 5, maxUses: 2, redact: true },
  });
  const handoff = structured<{ shareUrl: string; token: string; id: string }>(handoffResult);
  assert.match(handoff.shareUrl, /^https:\/\/lnkz\.example\/share\//);

  const continued = await client.callTool({
    name: "continue_handoff",
    arguments: {
      token: handoff.token,
      provider: "claude",
      messages: [{ role: "user", content: "Picking this up on my laptop." }],
    },
  });
  const continuation = structured<{ conversation: { id: string; lineage?: { parentId?: string } }; parentId: string }>(continued);
  assert.equal(continuation.parentId, saved.id);
  assert.equal(continuation.conversation.lineage?.parentId, saved.id);

  const revoked = await client.callTool({ name: "revoke_handoff", arguments: { handoffId: handoff.id } });
  assert.equal(revoked.isError, undefined);

  const afterRevoke = await client.callTool({ name: "redeem_handoff", arguments: { token: handoff.token } });
  assert.equal(afterRevoke.isError, true);
});

test("import runs as a dry run before it writes anything", async (t) => {
  const { client, store } = await connect(t);

  const payload = JSON.stringify([{
    uuid: "1f0d5a2e-0000-4000-8000-000000000000",
    name: "Imported over MCP",
    chat_messages: [{ uuid: "m1", sender: "human", text: "Carry this into LNKZ." }],
  }]);

  const dryRun = await client.callTool({ name: "import_conversation", arguments: { payload, dryRun: true } });
  assert.equal(structured<{ format: string }>(dryRun).format, "claude");
  assert.equal((await store.list()).length, 0, "a dry run must not write");

  const real = await client.callTool({ name: "import_conversation", arguments: { payload, tags: ["migrated"] } });
  const imported = structured<{ conversations: { id: string }[] }>(real).conversations;
  assert.equal(imported.length, 1);
  assert.ok((await store.get(imported[0].id))?.tags.includes("migrated"));
});

test("tool errors are returned as protocol errors, not thrown", async (t) => {
  const { client } = await connect(t);

  const missing = await client.callTool({
    name: "get_conversation",
    arguments: { id: "00000000-0000-4000-8000-000000000000" },
  });
  assert.equal(missing.isError, true);

  const badImport = await client.callTool({ name: "import_conversation", arguments: { payload: "{not json", format: "claude" } });
  assert.equal(badImport.isError, true);

  const emptyPacket = await client.callTool({ name: "build_context_packet", arguments: {} });
  assert.equal(emptyPacket.isError, true);
});

test("conversation resources render as portable Markdown", async (t) => {
  const { client } = await connect(t);

  const saveResult = await client.callTool({
    name: "save_conversation",
    arguments: {
      title: "Resource test",
      source: { provider: "gemini" },
      messages: [{ role: "user", content: "We decided to expose conversations as resources." }],
    },
  });
  const saved = structured<{ conversation: { id: string } }>(saveResult).conversation;

  const resource = await client.readResource({ uri: `lnkz://conversation/${saved.id}` });
  const text = (resource.contents[0] as { text: string }).text;
  assert.match(text, /# Resource test/);
  assert.match(text, /## Decisions/);

  const stats = await client.readResource({ uri: "lnkz://stats" });
  assert.equal(JSON.parse((stats.contents[0] as { text: string }).text).conversations, 1);
});

test("a conversation can be exported back out to another client's format over MCP", async (t) => {
  const { client } = await connect(t);

  const saved = structured<{ conversation: { id: string } }>(await client.callTool({
    name: "save_conversation",
    arguments: {
      title: "Export over MCP",
      source: { provider: "chatgpt" },
      messages: [
        { role: "user", content: "Which store did we pick?" },
        { role: "assistant", content: "We decided to use SQLite." },
      ],
    },
  })).conversation;

  const exported = await client.callTool({
    name: "export_conversation",
    arguments: { conversationId: saved.id, format: "openai" },
  });
  const meta = structured<{ format: string; mimeType: string; reimportable: boolean }>(exported);
  assert.equal(meta.format, "openai");
  assert.equal(meta.mimeType, "application/json");
  assert.equal(meta.reimportable, true);

  const payload = JSON.parse(textOf(exported)) as { messages: { role: string }[] };
  assert.deepEqual(payload.messages.map((message) => message.role), ["user", "assistant"]);

  const missing = await client.callTool({
    name: "export_conversation",
    arguments: { conversationId: "00000000-0000-4000-8000-000000000000" },
  });
  assert.equal(missing.isError, true);
});
