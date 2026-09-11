import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LnkzClient, resolveProfile, verifyExpectedWorkspace } from "./client.js";
import { createLnkzMcpServer } from "./mcp.js";

const profile = resolveProfile();
const client = new LnkzClient(profile.baseUrl, profile.apiKey);
if (profile.workspaceId) await verifyExpectedWorkspace(client, profile.workspaceId);
const server = createLnkzMcpServer(client);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    await server.close().catch(() => undefined);
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
