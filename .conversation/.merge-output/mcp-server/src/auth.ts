import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { hashBearerToken } from "./security.js";
import type { ConversationStore } from "./store/index.js";
import type { Actor } from "./types.js";

declare global {
  namespace Express {
    interface Request { actor?: Actor; }
  }
}

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * MCP is a machine-to-machine boundary. Browser cookies must never be
 * accepted here, even when the deployment has no legacy API key configured.
 */
export function requireMcpBearer(store: ConversationStore) {
  return async function mcpBearer(request: Request, response: Response, next: NextFunction): Promise<void> {
  const header = request.header("authorization") ?? "";
  const actual = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!actual) {
    response.status(401).json({ error: "MCP requires an Authorization: Bearer credential." });
    return;
  }
  const session = await store.findSession(hashBearerToken(actual));
  const token = await store.findApiToken(hashBearerToken(actual));
  const legacy = process.env.LNKZ_API_KEY?.trim();
  if (token) { request.actor = token.actor; next(); return; }
  if (session) { request.actor = session.actor; next(); return; }
  if (legacy && equalSecret(actual, legacy)) {
    request.actor = { id: "legacy-owner", workspaceId: process.env.LNKZ_WORKSPACE_ID?.trim() || "default", role: "owner", auth: "legacy", scope: "admin" };
    next();
    return;
  }
  response.status(401).json({ error: "Unauthorized" });
  };
}

export function requireActor(store: ConversationStore) {
  return async function actorMiddleware(request: Request, response: Response, next: NextFunction): Promise<void> {
    const bearer = bearerValue(request);
    const sessionToken = cookieValue(request.header("cookie"), "lnkz_session");
    const legacy = process.env.LNKZ_API_KEY?.trim();
    if (bearer) {
      const token = await store.findApiToken(hashBearerToken(bearer));
      if (token) {
        request.actor = token.actor;
        next();
        return;
      }
      if (legacy && equalSecret(bearer, legacy)) {
        request.actor = { id: "legacy-owner", workspaceId: process.env.LNKZ_WORKSPACE_ID?.trim() || "default", role: "owner", auth: "legacy", scope: "admin" };
        next();
        return;
      }
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    const session = sessionToken ? await store.findSession(hashBearerToken(sessionToken)) : null;
    if (session) {
      request.actor = session.actor;
      next();
      return;
    }
    response.status(401).json({ error: "Unauthorized" });
  };
}

export function bearerValue(request: Request): string {
  const value = request.header("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
}

export function validateOrigin(request: Request, response: Response, next: NextFunction): void {
  const origin = request.header("origin");
  const allowed = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && !isOriginAllowed(origin, request.header("host"), allowed)) {
    response.status(403).json({ error: "Origin is not allowed." });
    return;
  }
  next();
}

export function enforceHttps(request: Request, response: Response, next: NextFunction): void {
  const configured = process.env.LNKZ_REQUIRE_HTTPS;
  const required = configured === "true" || (configured !== "false" && process.env.NODE_ENV === "production");
  if (!required || request.path === "/health") {
    next();
    return;
  }
  const forwarded = process.env.TRUST_PROXY === "true" && request.header("x-forwarded-proto");
  if (request.secure || forwarded === "https") {
    next();
    return;
  }
  response.status(426).json({ error: "HTTPS is required." });
}

export function isOriginAllowed(origin: string, requestHost: string | undefined, allowed: string[]): boolean {
  if (allowed.includes(origin)) return true;
  try {
    return Boolean(requestHost) && new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  key?: (request: Request) => string;
}

/**
 * A fixed-window counter, deliberately in process. Share links are public URLs
 * that grant read access, so an unbounded endpoint is an invitation to guess
 * tokens; a single-instance MVP does not need a shared store to make that
 * expensive. A multi-instance deployment must move this to Redis.
 */
export function rateLimit(options: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function limiter(request: Request, response: Response, next: NextFunction): void {
    if (options.max <= 0) {
      next();
      return;
    }
    const now = Date.now();
    const key = options.key?.(request) ?? clientKey(request);
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      if (hits.size > 10_000) pruneExpired(hits, now);
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > options.max) {
      response.setHeader("retry-after", Math.ceil((entry.resetAt - now) / 1000));
      response.status(429).json({ error: "Too many requests." });
      return;
    }
    next();
  };
}

function clientKey(request: Request): string {
  const forwarded = request.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

function pruneExpired(hits: Map<string, { count: number; resetAt: number }>, now: number): void {
  for (const [key, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(key);
  }
}

/**
 * Host validation exists to stop DNS rebinding, and setting ALLOWED_HOSTS to a
 * public domain is the correct production setting. On its own, though, it also
 * rejects the container's own health check, which reaches the process over
 * loopback and therefore sends `Host: 127.0.0.1:<port>`. A machine that never
 * reports healthy never receives traffic, so the loopback names are always
 * allowed. The browser attack this protects against is still blocked, because a
 * page on another origin is stopped by the Origin check rather than this one.
 */
export function withLoopback(hosts: string[], port: number): string[] {
  if (!hosts.length) return hosts;
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  return [...new Set([
    ...hosts,
    ...loopback,
    ...loopback.map((name) => `${name}:${port}`),
  ])];
}
