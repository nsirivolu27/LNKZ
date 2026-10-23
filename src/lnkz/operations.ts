import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { RequestHandler } from "express";
import type { ConversationStore } from "./store/index.js";

export function requestLogging(write: (line: string) => void = console.log): RequestHandler {
  return (request, response, next) => {
    const started = performance.now();
    const requestId = randomUUID();
    response.setHeader("x-request-id", requestId);
    let logged = false;
    const log = (): void => {
      if (logged) return;
      logged = true;
      // Route templates omit bearer tokens and caller-controlled path segments.
      write(JSON.stringify({
        event: "request",
        requestId,
        method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(request.method)
          ? request.method : "OTHER",
        path: typeof request.route?.path === "string" ? request.route.path : "<unmatched>",
        status: response.writableFinished ? response.statusCode : 499,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        workspace: response.locals.workspaceId ?? null,
      }));
    };
    response.once("finish", log);
    response.once("close", log);
    next();
  };
}

export function readiness(store: Pick<ConversationStore, "stats">, isDraining: () => boolean): RequestHandler {
  return async (_request, response) => {
    if (isDraining()) {
      response.status(503).json({ ok: false });
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        store.stats(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Readiness timed out")), 2_000);
        }),
      ]);
      response.status(isDraining() ? 503 : 200).json({ ok: !isDraining() });
    } catch {
      response.status(503).json({ ok: false });
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function drainServer(server: Server, closeResources: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }).then(closeResources),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Shutdown timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
