import type { Express, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { localContinuation, remoteContinuation } from "../continuation.js";
import { continueConversationSchema, continueFromLinkSchema, createHandoffSchema } from "../schemas.js";
import type { ConversationStore } from "../store/index.js";
import { fetchTransfer, peekTransfer, TransferError } from "../transfer.js";

/**
 * Every route that mints, lists, redeems, previews, continues or revokes a
 * handoff.
 *
 * These lived inline in server.ts, which listens on import, so nothing could
 * exercise them except by starting a real process on a real port. Three bugs
 * shipped in this surface before anyone noticed, and all three were found by
 * running two relays by hand rather than by a test. Registration now follows
 * the same pattern as export, graph and publish: a mount function a test can
 * call against a bare express app and an in-memory store.
 *
 * The rate limiters arrive as arrays rather than as fixed arguments because
 * the shared Postgres limiter is present only in some deployments, and a test
 * wants neither. Passing an empty array is a legitimate configuration, not a
 * hole: the limiters are a deployment concern and the routes do not depend on
 * them for correctness.
 */
export interface HandoffRouteDeps {
  requireApiKey: RequestHandler;
  /** Limiters for authenticated write routes. */
  apiGuards: RequestHandler[];
  /** Limiters for the unauthenticated share routes, which get their own budget. */
  shareGuards: RequestHandler[];
  /** Used to build the share url handed back when a handoff is minted. */
  publicBaseUrl: string;
}

export function mountHandoffRoutes(app: Express, store: ConversationStore, deps: HandoffRouteDeps): void {
  const { requireApiKey, apiGuards, shareGuards, publicBaseUrl } = deps;

  app.post("/api/conversations/:id/handoffs", requireApiKey, ...apiGuards, async (request, response) => {
    try {
      const options = createHandoffSchema.parse({ ...request.body, conversationId: pathParam(request.params.id) });
      const handoff = await store.createHandoff(options);
      response.status(201).json({ ...handoff, shareUrl: `${publicBaseUrl.replace(/\/$/, "")}/share/${handoff.token}` });
    } catch (error) {
      badRequest(response, error);
    }
  });

  app.get("/api/handoffs", requireApiKey, async (request, response) => {
    response.json({ handoffs: await store.listHandoffs(stringParam(request.query.conversationId)) });
  });

  /**
   * Redeem a handoff and store the continuation as a new conversation.
   *
   * Redemption alone is `GET /share/:token` and is deliberately unauthenticated,
   * because a share link has to work for someone who has no key. Continuing is a
   * write into this workspace, so it takes a key and lives here instead.
   */
  app.post("/api/handoffs/continue", requireApiKey, ...apiGuards, async (request, response) => {
    try {
      // Two shapes, chosen by what the caller sent, because the two produce
      // different lineage and a single refined schema could not be introspected
      // by the MCP tool registration that shares the local one.
      const body = request.body as { url?: unknown; token?: unknown } | undefined;
      if (body?.url && body?.token) {
        response.status(400).json({ error: "Provide either a token for a local handoff or a url for another instance's link, not both." });
        return;
      }

      if (body?.url) {
        const options = continueFromLinkSchema.parse(request.body);
        // Someone else's link. fetchTransfer applies the same SSRF guards as
        // import-url: http and https only, no credentials in the URL, every
        // resolved address public unless LNKZ_TRANSFER_ALLOW_PRIVATE says
        // otherwise, a size cap and a timeout. There is no separate path here
        // and no relaxed check for "trusted" links.
        const transfer = await fetchTransfer(options.url);

        const conversation = await store.save(remoteContinuation({
          parent: transfer.conversation,
          origin: transfer.origin,
          provider: options.provider,
          app: options.app,
          title: options.title,
          messages: options.messages,
        }));

        response.status(201).json({ conversation, origin: transfer.origin, warnings: transfer.warnings });
        return;
      }

      // A handoff minted here. The parent row is local, so the continuation can
      // point straight at it.
      const options = continueConversationSchema.parse(request.body);
      const packet = await store.redeemHandoff(options.token);
      if (!packet) {
        response.status(404).json({ error: "Handoff is invalid, revoked, exhausted, or expired." });
        return;
      }

      const parent = packet.conversation;
      const conversation = await store.save(localContinuation({
        parent,
        parentId: parent.id,
        handoffId: packet.handoff.id,
        provider: options.provider,
        app: options.app,
        title: options.title,
        messages: options.messages,
      }));

      response.status(201).json({ conversation, parentId: parent.id });
    } catch (error) {
      if (error instanceof TransferError) {
        response.status(422).json({ error: error.message });
        return;
      }
      badRequest(response, error);
    }
  });

  app.delete("/api/handoffs/:id", requireApiKey, async (request, response) => {
    const revoked = await store.revokeHandoff(pathParam(request.params.id));
    if (!revoked) {
      response.status(404).json({ error: "Handoff not found or already revoked." });
      return;
    }
    response.status(204).end();
  });

  /**
   * Look at a link without redeeming it.
   *
   * Unauthenticated for the same reason /share is: whoever holds the link is the
   * audience. It returns a title, a provider and a count, never the transcript,
   * so a peek cannot become a way to read someone's conversation for free.
   *
   * 410 rather than 404 when the link is gone. A relay old enough not to have
   * this route answers 404 from the catch-all, and a recipient's client needs to
   * tell "this link is dead" from "that relay cannot preview", because only one
   * of those means stop.
   */
  app.get("/share/:token/preview", ...shareGuards, async (request, response) => {
    const peek = await store.peekHandoff(pathParam(request.params.token));
    if (!peek) {
      response.status(410).json({ error: "Handoff is invalid, revoked, exhausted, or expired." });
      return;
    }
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-robots-tag", "noindex, nofollow");
    response.json({ format: "lnkz.preview.v1", preview: peek });
  });

  app.get("/share/:token", ...shareGuards, async (request, response) => {
    const packet = await store.redeemHandoff(pathParam(request.params.token));
    if (!packet) {
      response.status(404).json({ error: "Handoff is invalid, revoked, exhausted, or expired." });
      return;
    }
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-robots-tag", "noindex, nofollow");
    if ((request.header("accept") ?? "").includes("text/markdown")) {
      response.type("text/markdown").send(packet.transcriptMarkdown);
      return;
    }
    response.json(packet);
  });
}

/**
 * Copies of the two helpers server.ts keeps at its foot. Small enough that
 * importing them from the entry point, which starts a server on import, would
 * be a worse trade than repeating them.
 */
function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function badRequest(response: Response, error: unknown): void {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Invalid request.",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }
  response.status(400).json({ error: "Invalid request." });
}
