import { z } from "zod";
import type { Express, RequestHandler } from "express";
import { executePublish, publishAllowlist } from "./execute.js";
import { prepareCall, type PublishShape } from "./prepare.js";
import { configuredTargets, discoverTools, findTool } from "./targets.js";
import type { ConversationStore } from "../store/index.js";
import type { Conversation } from "../types.js";
import type { RemoteTool } from "./prepare.js";
import type { PublishTarget } from "./targets.js";

const shapeSchema = z.enum(["summary", "decisions", "transcript", "brief"]);

const prepareSchema = {
  conversationId: z.string().uuid(),
  target: z.string().trim().min(1).max(80),
  tool: z.string().trim().min(1).max(120),
  shape: shapeSchema.default("summary"),
};

const prepareObject = z.object(prepareSchema);

const executeObject = z.object({
  ...prepareSchema,
  /** Required fields the mapping could not fill. */
  overrides: z.record(z.unknown()).optional(),
  /** On by default. Turning it off sends the transcript as stored. */
  redact: z.boolean().default(true),
});

export function mountPublishRoutes(app: Express, store: ConversationStore, requireApiKey: RequestHandler): void {
  app.get("/api/publish/targets", requireApiKey, async (_request, response) => {
    const { targets, errors } = configuredTargets();
    // The allowlist is reported alongside the tools, because "which of these
    // can I actually send to" is the question a caller has after discovery,
    // and making them find out by being refused is a worse way to answer it.
    response.json({ targets: await discoverTools(targets), errors, allowlist: [...publishAllowlist()] });
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

  app.post("/api/publish/execute", requireApiKey, async (request, response) => {
    try {
      const options = executeObject.parse(request.body);
      const resolved = await resolve(store, options.conversationId, options.target, options.tool);
      if (!resolved.ok) {
        response.status(resolved.status).json({ error: resolved.error });
        return;
      }

      const result = await executePublish(store, {
        conversation: resolved.conversation,
        target: resolved.target,
        tool: resolved.tool,
        shape: options.shape as PublishShape,
        ...(options.overrides ? { overrides: options.overrides } : {}),
        redact: options.redact,
        ...(response.locals.actorId ? { actorId: String(response.locals.actorId) } : {}),
      });

      // 403 for a refusal and 502 for a failure, because the two need
      // different things from whoever is reading: one is configuration on this
      // side, the other is the far end.
      const status = result.outcome === "sent" ? 200 : result.outcome === "refused" ? 403 : 502;
      response.status(status).json(result);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." });
    }
  });
}

/**
 * The four lookups both routes need, in one place: the conversation, the
 * configured target, that target being reachable, and the tool existing on it.
 * Returns either everything resolved or the status and message to answer with.
 *
 * Discriminated on `ok` rather than on the presence of a `status` field. An
 * `in` check across two inferred object literals reads fine and does not
 * narrow, which is how this shipped failing to typecheck.
 */
type Resolved =
  | { ok: true; conversation: Conversation; target: PublishTarget; tool: RemoteTool }
  | { ok: false; status: number; error: string };

async function resolve(
  store: ConversationStore,
  conversationId: string,
  targetName: string,
  toolName: string,
): Promise<Resolved> {
  const conversation = await store.get(conversationId);
  if (!conversation) return { ok: false, status: 404, error: "Conversation not found." };

  const { targets } = configuredTargets();
  const target = targets.find((candidate) => candidate.name === targetName);
  if (!target) return { ok: false, status: 404, error: `No target named "${targetName}".` };

  const discovered = await discoverTools([target]);
  if (discovered[0]?.error) {
    return { ok: false, status: 502, error: `Could not reach ${targetName}: ${discovered[0].error}` };
  }

  const tool = findTool(discovered, targetName, toolName);
  if (!tool) return { ok: false, status: 404, error: `${targetName} has no tool named "${toolName}".` };

  return { ok: true, conversation, target, tool };
}
