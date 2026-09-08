import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLnkzConnector } from "../src/lnkz/connectors/lnkz.js";
import { createLnkzMcpServer } from "../src/lnkz/mcp.js";
import { SqliteConversationStore } from "../src/lnkz/store/index.js";

test("local MCP preserves tool names and lnkz resource URIs", async (t) => {
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

  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "save_conversation"));
  assert.ok(tools.tools.some((tool) => tool.name === "list_publish_targets"));
  assert.ok(tools.tools.some((tool) => tool.name === "prepare_publish"));

  const resources = await client.listResources();
  assert.deepEqual(
    resources.resources.map((resource) => resource.uri).sort(),
    ["lnkz://connectors", "lnkz://conversations", "lnkz://graph", "lnkz://stats"],
  );
});
