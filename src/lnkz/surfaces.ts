import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Express, RequestHandler } from "express";
import { registerExportTool, mountExportRoutes } from "./export/wire.js";
import { registerGraphTools, mountGraphRoutes } from "./graph/wire.js";
import { registerPublishTools, mountPublishRoutes } from "./publish/wire.js";
import type { ConversationStore } from "./store/index.js";

/**
 * One place where added capability meets the two files everything wants to edit.
 *
 * `mcp.ts` and `server.ts` are the natural collision point: every feature needs a
 * tool registered and a route mounted, so both files accumulate edits from
 * everyone at once and every branch conflicts in the same two places. Routing
 * registration through here means a new surface costs one line in its own wire
 * file and nothing in either of those, which is what lets more than one person
 * work on this server at a time.
 */
export function registerSurfaces(server: McpServer, store: ConversationStore): void {
  registerExportTool(server, store);
  registerGraphTools(server, store);
  registerPublishTools(server, store);
}

export function mountSurfaceRoutes(app: Express, store: ConversationStore, requireApiKey: RequestHandler): void {
  mountExportRoutes(app, store, requireApiKey);
  mountGraphRoutes(app, store, requireApiKey);
  mountPublishRoutes(app, store, requireApiKey);
}
