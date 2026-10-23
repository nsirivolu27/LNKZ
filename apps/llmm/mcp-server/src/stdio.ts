import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLnkzMcpServer } from "./mcp.js";
import { createRuntime } from "./runtime.js";

const { store, connectors } = createRuntime();
const server = createLnkzMcpServer(store, connectors);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    store.close();
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
