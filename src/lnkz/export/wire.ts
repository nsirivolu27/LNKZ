import { z } from "zod";
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
