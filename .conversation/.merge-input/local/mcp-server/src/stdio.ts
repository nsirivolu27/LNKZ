import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLnkzMcpServer } from "./mcp.js";
import { createRuntime } from "./runtime.js";

// Stdio has no HTTP authentication boundary. Never allow a local process to
// accidentally operate as an implicit/global actor.
const actorId = process.env.LNKZ_ACTOR_ID?.trim();
const workspaceId = process.env.LNKZ_WORKSPACE_ID?.trim();
if (!actorId || !workspaceId) {
  console.error("Refusing to start stdio MCP: LNKZ_ACTOR_ID and LNKZ_WORKSPACE_ID are required.");
  process.exit(1);
}

const { store, connectors } = createRuntime();
const actor = await store.switchWorkspace(
  { id: actorId, workspaceId, role: "owner", auth: "stdio" },
  workspaceId,
);
if (!actor) {
  console.error("Refusing to start stdio MCP: actor is not a member of the configured workspace.");
  store.close();
  process.exit(1);
}
const server = createLnkzMcpServer(store, connectors, process.env.LNKZ_PUBLIC_BASE_URL, actor);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    store.close();
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
