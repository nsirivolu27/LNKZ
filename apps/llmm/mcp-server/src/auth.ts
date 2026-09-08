import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireApiKey(request: Request, response: Response, next: NextFunction): void {
  const expected = process.env.LNKZ_API_KEY?.trim();
  if (!expected) {
    next();
    return;
  }
  const header = request.header("authorization") ?? "";
  const actual = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!actual || !equalSecret(actual, expected)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
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
    const key = clientKey(request);
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

export function requestClientKey(request: Request): string {
  return clientKey(request);
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
