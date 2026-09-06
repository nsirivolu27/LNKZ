import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import {
  currentRequestContext,
  defaultRequestContext,
  hasScope,
  MCP_CONTEXT_HEADER,
  runWithRequestContext,
  verifyMcpContext,
  type Scope,
} from "./context.js";
import type { ApiPrincipal } from "./config.js";

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

export function createApiKeyMiddleware(
  principals: ApiPrincipal[],
  required: boolean,
  defaultWorkspaceId: string,
  options: {
    allowForwardedContext?: boolean;
    forwardedContextSecret?: string;
    requiredForwardedScope?: Scope;
    now?: () => number;
  } = {},
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    // A managed identity middleware may establish context only after resolving
    // explicit Postgres workspace membership. Never replace that trusted result
    // with a caller-controlled forwarding header.
    const established = currentRequestContext();
    if (established?.authMethod === "managed" || established?.authMethod === "api-key") {
      next();
      return;
    }

    const header = request.header("authorization") ?? "";
    const actual = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const principal = actual
      ? principals.find((candidate) => equalSecret(actual, candidate.key))
      : undefined;

    if (actual && !principal) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (principal) {
      runWithRequestContext({
        workspaceId: principal.workspaceId,
        actorId: principal.actorId,
        scopes: new Set(principal.scopes),
        authMethod: "api-key",
      }, next);
      return;
    }

    const forwarded = request.header(MCP_CONTEXT_HEADER);
    if (options.allowForwardedContext && forwarded) {
      const context = options.forwardedContextSecret
        ? verifyMcpContext(forwarded, options.forwardedContextSecret, {
            now: options.now?.(),
            requiredScope: options.requiredForwardedScope,
          })
        : null;
      if (!context) {
        response.status(401).json({ error: "Unauthorized" });
        return;
      }
      runWithRequestContext(context, next);
      return;
    }

    if (required) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    runWithRequestContext(defaultRequestContext(defaultWorkspaceId), next);
  };
}

export function requireScope(scope: Scope): (request: Request, response: Response, next: NextFunction) => void {
  return (_request, response, next) => {
    if (!hasScope(scope)) {
      response.status(403).json({ error: `The ${scope} scope is required.` });
      return;
    }
    next();
  };
}

export function createOriginValidator(allowed: string[]): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const origin = request.header("origin");
    if (origin && !isOriginAllowed(origin, request.header("host"), allowed)) {
      response.status(403).json({ error: "Origin is not allowed." });
      return;
    }
    next();
  };
}

export function securityHeaders(request: Request, response: Response, next: NextFunction): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
      "img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
  );
  if (request.secure) {
    response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export const validateOrigin = createOriginValidator(
  (process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
);

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
