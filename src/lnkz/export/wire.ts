import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Express, RequestHandler } from "express";
import { EXPORT_FORMATS, exportConversation, type ExportFormat } from "./index.js";
import type { ConversationStore } from "../store/index.js";

/**
 * Registration lives here rather than inline in mcp.ts and server.ts so that
 * adding a surface costs one line in each of those files. They are the two
 * places every feature wants to edit, and keeping the edits to a line each is
 * what makes concurrent work on this server survivable.
 */

export const exportFormatSchema = z.enum(EXPORT_FORMATS as [ExportFormat, ...ExportFormat[]]);

const exportSchema = {
  conversationId: z.string().uuid(),
  format: exportFormatSchema.default("markdown"),
};

export function registerExportTool(server: McpServer, store: ConversationStore): void {
  server.registerTool(
    "export_conversation",
    {
      title: "Export a conversation",
      description:
        "Writes a stored conversation back out in another client's format: a Markdown transcript, "
        + "a Markdown brief with the decisions on top, a chat-completions message array, a ChatGPT-shaped "
        + "export, a Claude-shaped export, a LNKZ packet, or plain text. Every format re-imports, so a "
        + "conversation can leave LNKZ as easily as it arrived.",
      inputSchema: exportSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ conversationId, format }) => {
      const conversation = await store.get(conversationId);
      if (!conversation) {
        return { isError: true as const, content: [{ type: "text" as const, text: "Conversation not found." }] };
      }
      const result = exportConversation(conversation, format);
      return {
        content: [{ type: "text" as const, text: result.body }],
        structuredContent: {
          format: result.format,
          mimeType: result.mimeType,
          filename: result.filename,
          reimportable: result.reimportable,
          bytes: Buffer.byteLength(result.body, "utf8"),
        },
      };
    },
  );
}

export function mountExportRoutes(app: Express, store: ConversationStore, requireApiKey: RequestHandler): void {
  app.get("/api/conversations/:id/export", requireApiKey, async (request, response) => {
    const parsed = exportFormatSchema.safeParse(request.query.format ?? "markdown");
    if (!parsed.success) {
      response.status(400).json({ error: `Unknown format. Supported: ${EXPORT_FORMATS.join(", ")}.` });
      return;
    }

    const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const conversation = await store.get(id);
    if (!conversation) {
      response.status(404).json({ error: "Conversation not found." });
      return;
    }

    const result = exportConversation(conversation, parsed.data);
    response.setHeader("content-disposition", `attachment; filename="${result.filename}"`);
    response.type(result.mimeType).send(result.body);
  });
}
