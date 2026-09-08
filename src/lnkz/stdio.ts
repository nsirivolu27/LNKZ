import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createLnkzMcpServer } from "./mcp.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig();
const { store, connectors, sharedRateLimiter } = createRuntime();
try {
  await store.stats();
} catch {
  console.error("Store startup check failed; check database access and run pnpm db:migrate for Postgres.");
  await Promise.all([store.close(), sharedRateLimiter?.close()]);
  process.exit(1);
}
const server = createLnkzMcpServer(store, connectors, config.publicBaseUrl);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    await server.close();
    await Promise.all([store.close(), sharedRateLimiter?.close()]);
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
