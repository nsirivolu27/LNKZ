import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Connector, ContextItem } from "../types.js";

export function createFantasyConnector(env: NodeJS.ProcessEnv = process.env): Connector | null {
  const url = env.FANTASY_MCP_URL?.trim();
  const apiKey = env.FANTASY_MCP_API_KEY?.trim();
  if (!url) return null;

  return {
    id: "fantasy",
    label: "Fantasy Copilot",
    status: () => ({
      id: "fantasy",
      label: "Fantasy Copilot",
      configured: true,
      detail: `Remote MCP federation is configured for ${new URL(url).hostname}.`,
    }),
    search: async (query, limit) => {
      const client = new Client({ name: "lnkz", version: "0.1.0" });
      const headers: Record<string, string> = {};
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: "search_league",
          arguments: { query, limit: Math.min(limit, 15) },
        });
        if ("isError" in result && result.isError) {
          throw new Error(textContent(result.content) || "Fantasy MCP tool failed.");
        }
        const text = "content" in result ? textContent(result.content) : "";
        return text
          ? [{
              source: "fantasy",
              id: `league-search:${query.toLowerCase()}`,
              title: "Fantasy league context",
              text,
              metadata: { tool: "search_league" },
            } satisfies ContextItem]
          : [];
      } finally {
        await client.close().catch(() => undefined);
      }
    },
  };
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      Boolean(block && typeof block === "object" && (block as { type?: string }).type === "text"),
    )
    .map((block) => block.text)
    .join("\n");
}
