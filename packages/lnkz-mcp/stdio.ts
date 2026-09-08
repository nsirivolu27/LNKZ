import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LnkzClient } from "./client.js";
import { createLnkzMcpServer } from "./mcp.js";

const server = createLnkzMcpServer(LnkzClient.fromEnv());

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    await server.close().catch(() => undefined);
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
