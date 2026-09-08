import type { Express, RequestHandler } from "express";
import { mountExportRoutes } from "./export/wire.js";
import { mountGraphRoutes } from "./graph/wire.js";
import { mountPublishRoutes } from "./publish/wire.js";
import type { ConversationStore } from "./store/index.js";

/**
 * Every REST route that lives outside server.ts, mounted in one place.
 *
 * Same reasoning as mcp-surfaces.ts: server.ts is a collision point, and a new
 * surface should cost it one line.
 */
export function mountSurfaceRoutes(app: Express, store: ConversationStore, requireApiKey: RequestHandler): void {
  mountExportRoutes(app, store, requireApiKey);
  mountGraphRoutes(app, store, requireApiKey);
  mountPublishRoutes(app, store, requireApiKey);
}
