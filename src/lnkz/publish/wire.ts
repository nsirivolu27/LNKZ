import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

export function registerPublishTools(server: McpServer, store: ConversationStore): void {
  server.registerTool(
    "list_publish_targets",
    {
      title: "List publish targets",
      description:
        "Connects to every configured downstream MCP server and lists the tools it exposes, marking which ones "
        + "look like writes. Configure targets with LNKZ_MCP_TARGETS as name=url, optionally name=url|key. "
        + "This is discovery only: it reads what is available and changes nothing.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const { targets, errors } = configuredTargets();
      if (!targets.length) {
        return {
          content: [{
            type: "text" as const,
            text: "No publish targets are configured. Set LNKZ_MCP_TARGETS to name=url pairs.",
          }],
          structuredContent: { targets: [], errors },
        };
      }

      const discovered = await discoverTools(targets);
      const lines = discovered.map((entry) => {
        if (entry.error) return `${entry.target}: unreachable (${entry.error})`;
        const writes = entry.tools.filter((tool) => tool.write);
        return `${entry.target}: ${entry.tools.length} tool(s), ${writes.length} that look like writes`
          + (writes.length ? `\n  ${writes.map((tool) => tool.name).join(", ")}` : "");
      });

      return {
        content: [{ type: "text" as const, text: lines.join("\n\n") }],
        structuredContent: { targets: discovered, errors },
      };
    },
  );

  server.registerTool(
    "prepare_publish",
    {
      title: "Prepare a conversation for another system",
      description:
        "Maps a conversation onto a downstream MCP tool's input schema and returns the exact call that would be "
        + "made, including which required fields it could not fill. It never sends anything. Review the payload, "
        + "then make the call yourself with that server's own tool if you want it to happen.",
      inputSchema: prepareSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const options = prepareObject.parse(input);
      const conversation = await store.get(options.conversationId);
      if (!conversation) return toolError("Conversation not found.");

      const { targets } = configuredTargets();
      const target = targets.find((candidate) => candidate.name === options.target);
      if (!target) {
        return toolError(`No target named "${options.target}". Configure it in LNKZ_MCP_TARGETS.`);
      }

      const discovered = await discoverTools([target]);
      const failure = discovered[0]?.error;
      if (failure) return toolError(`Could not reach ${options.target}: ${failure}`);

      const tool = findTool(discovered, options.target, options.tool);
      if (!tool) {
        const available = discovered[0]?.tools.map((entry) => entry.name).join(", ") || "none";
        return toolError(`${options.target} has no tool named "${options.tool}". Available: ${available}.`);
      }

      const prepared = prepareCall(conversation, options.target, tool, options.shape as PublishShape);
      const lines = [
        `Prepared a call to ${prepared.target}.${prepared.tool}. Nothing was sent.`,
        "",
        JSON.stringify(prepared.arguments, null, 2),
        "",
        prepared.filled.length ? `Filled: ${prepared.filled.map((entry) => `${entry.name} from ${entry.from}`).join("; ")}` : "",
        prepared.missing.length ? `Still needed: ${prepared.missing.map((entry) => `${entry.name} (${entry.type})`).join(", ")}` : "",
        ...prepared.notes,
      ].filter(Boolean);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: { prepared },
      };
    },
  );
}

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
