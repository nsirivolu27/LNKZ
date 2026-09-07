import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildConversationGraph, graphToMarkdown, loadRecent } from "./index.js";
import type { ConversationStore } from "../store/index.js";

export const graphSchema = {
  limit: z.number().int().min(2).max(200).default(50),
  minTopicConversations: z.number().int().min(2).max(20).default(2),
  duplicateThreshold: z.number().min(0.2).max(0.99).default(0.6),
  conflictThreshold: z.number().min(0.1).max(0.95).default(0.45),
  maxTopics: z.number().int().min(1).max(200).default(40),
};

const graphObject = z.object(graphSchema);

export function registerGraphTools(server: McpServer, store: ConversationStore): void {
  server.registerTool(
    "build_context_graph",
    {
      title: "Build the conversation graph",
      description:
        "Builds a graph over the stored conversations: nodes for conversations, decisions, open questions "
        + "and shared topics, and edges for lineage, shared subject matter, near duplicates and contradictions. "
        + "Answers the questions search cannot: what this corpus knows, which decisions everything else leans on, "
        + "and which conversations stand alone. Every edge carries the reason it exists.",
      inputSchema: graphSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const options = graphObject.parse(input);
      const conversations = await loadRecent(store, options.limit);
      const graph = buildConversationGraph(conversations, options);
      return {
        content: [{ type: "text" as const, text: graphToMarkdown(graph) }],
        structuredContent: { graph },
      };
    },
  );

  server.registerResource(
    "conversation-graph",
    "lnkz://graph",
    {
      title: "LNKZ conversation graph",
      description: "Nodes and edges over the 50 most recent conversations.",
      mimeType: "application/json",
    },
    async () => {
      const conversations = await loadRecent(store, 50);
      return {
        contents: [{
          uri: "lnkz://graph",
          mimeType: "application/json",
          text: JSON.stringify(buildConversationGraph(conversations), null, 2),
        }],
      };
    },
  );
}
