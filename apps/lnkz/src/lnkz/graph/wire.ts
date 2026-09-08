import { z } from "zod";
import type { Express, RequestHandler } from "express";
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


function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
