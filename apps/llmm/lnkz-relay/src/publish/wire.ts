import { z } from "zod";
import type { Express, RequestHandler } from "express";
import { prepareCall, type PublishShape } from "./prepare.js";
import { configuredTargets, discoverTools, findTool } from "./targets.js";
import type { ConversationStore } from "../store/index.js";

const shapeSchema = z.enum(["summary", "decisions", "transcript", "brief"]);

const prepareSchema = {
  conversationId: z.string().uuid(),
  target: z.string().trim().min(1).max(80),
  tool: z.string().trim().min(1).max(120),
  shape: shapeSchema.default("summary"),
};

const prepareObject = z.object(prepareSchema);

export function mountPublishRoutes(app: Express, store: ConversationStore, requireApiKey: RequestHandler): void {
  app.get("/api/publish/targets", requireApiKey, async (_request, response) => {
    const { targets, errors } = configuredTargets();
    response.json({ targets: await discoverTools(targets), errors });
  });

  app.post("/api/publish/prepare", requireApiKey, async (request, response) => {
    try {
      const options = prepareObject.parse(request.body);
      const conversation = await store.get(options.conversationId);
      if (!conversation) {
        response.status(404).json({ error: "Conversation not found." });
        return;
      }

      const { targets } = configuredTargets();
      const target = targets.find((candidate) => candidate.name === options.target);
      if (!target) {
        response.status(404).json({ error: `No target named "${options.target}".` });
        return;
      }

      const discovered = await discoverTools([target]);
      if (discovered[0]?.error) {
        response.status(502).json({ error: `Could not reach ${options.target}: ${discovered[0].error}` });
        return;
      }

      const tool = findTool(discovered, options.target, options.tool);
      if (!tool) {
        response.status(404).json({ error: `${options.target} has no tool named "${options.tool}".` });
        return;
      }

      response.json({ prepared: prepareCall(conversation, options.target, tool, options.shape as PublishShape) });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." });
    }
  });
}

function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}
