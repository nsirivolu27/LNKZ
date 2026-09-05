import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Express, RequestHandler } from "express";
import { buildConversationGraph, graphToMarkdown } from "./index.js";
import type { ConversationStore } from "../store/index.js";
import type { Conversation } from "../types.js";

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

export function mountGraphRoutes(app: Express, store: ConversationStore, requireApiKey: RequestHandler): void {
  app.get("/api/graph", requireApiKey, async (request, response) => {
    try {
      const options = graphObject.parse({
        limit: numberOr(request.query.limit, 50),
        minTopicConversations: numberOr(request.query.minTopicConversations, 2),
        duplicateThreshold: numberOr(request.query.duplicateThreshold, 0.6),
        conflictThreshold: numberOr(request.query.conflictThreshold, 0.45),
        maxTopics: numberOr(request.query.maxTopics, 40),
      });
      const conversations = await loadRecent(store, options.limit);
      const graph = buildConversationGraph(conversations, options);
      if (request.header("accept")?.includes("text/markdown")) {
        response.type("text/markdown").send(graphToMarkdown(graph));
        return;
      }
      response.json({ graph });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." });
    }
  });
}

/**
 * The graph needs whole conversations, not summaries, because the claims come
 * from message text. Recency is the bound: a graph over everything ever stored
 * stops being readable long before it stops being computable.
 */
async function loadRecent(store: ConversationStore, limit: number): Promise<Conversation[]> {
  const summaries = await store.list({ limit });
  const conversations: Conversation[] = [];
  for (const summary of summaries) {
    const conversation = await store.get(summary.id);
    if (conversation) conversations.push(conversation);
  }
  return conversations;
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
