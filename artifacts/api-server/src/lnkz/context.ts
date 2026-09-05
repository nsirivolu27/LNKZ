import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const FORWARDED_CONTEXT_HEADER = "x-lnkz-context";
const FORWARDED_CONTEXT_VERSION = 1;
const FORWARDED_CONTEXT_TTL_MS = 60_000;

export type Scope = "mcp" | "read" | "write" | "admin";

export interface RequestContext {
  workspaceId: string;
  actorId: string;
  scopes: ReadonlySet<Scope>;
  authMethod: "api-key" | "managed" | "mcp-context" | "default";
  traceId?: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return requestContext.run(context, work);
}

export function currentRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function hasScope(scope: Scope): boolean {
  const context = currentRequestContext();
  // Direct stdio usage and in-memory unit tests do not pass through HTTP auth;
  // they remain trusted local callers. HTTP requests always establish a context.
  return !context || Boolean(context.scopes.has(scope) || context.scopes.has("admin"));
}

export function defaultRequestContext(workspaceId = DEFAULT_WORKSPACE_ID): RequestContext {
  return {
    workspaceId,
    actorId: "system",
    scopes: new Set<Scope>(["mcp", "read", "write", "admin"]),
    authMethod: "default",
  };
}

/**
 * A downstream LNKZ server cannot safely trust ordinary workspace headers.
 * This envelope is signed with a deployment-shared secret, expires quickly,
 * and is only emitted for authenticated request contexts.
 */
export function buildForwardedContextHeaders(
  secret = process.env.LNKZ_MCP_CONTEXT_SECRET,
): Record<string, string> {
  const context = currentRequestContext();
  if (!secret?.trim() || !context || context.authMethod === "default") return {};

  const issuedAt = Date.now();
  const payload = {
    version: FORWARDED_CONTEXT_VERSION,
    workspaceId: context.workspaceId,
    actorId: context.actorId,
    scopes: [...context.scopes],
    traceId: context.traceId,
    issuedAt,
    expiresAt: issuedAt + FORWARDED_CONTEXT_TTL_MS,
  };
  const encoded = encodePayload(payload);
  return { [FORWARDED_CONTEXT_HEADER]: `${encoded}.${sign(encoded, secret)}` };
}

export function readForwardedContext(
  value: string | undefined,
  secret = process.env.LNKZ_MCP_CONTEXT_SECRET,
  now = Date.now(),
): RequestContext | undefined {
  if (!value || !secret?.trim()) return undefined;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return undefined;
  const encoded = value.slice(0, separator);
  const actualSignature = value.slice(separator + 1);
  const expectedSignature = sign(encoded, secret);
  const actual = Buffer.from(actualSignature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      version?: unknown;
      workspaceId?: unknown;
      actorId?: unknown;
      scopes?: unknown;
      traceId?: unknown;
      issuedAt?: unknown;
      expiresAt?: unknown;
    };
    if (
      payload.version !== FORWARDED_CONTEXT_VERSION
      || typeof payload.workspaceId !== "string"
      || !isUuid(payload.workspaceId)
      || typeof payload.actorId !== "string"
      || !payload.actorId.trim()
      || !Array.isArray(payload.scopes)
      || payload.scopes.length === 0
      || payload.scopes.some((scope) => !isScope(scope))
      || (payload.traceId !== undefined && (typeof payload.traceId !== "string" || payload.traceId.length > 200))
      || typeof payload.issuedAt !== "number"
      || typeof payload.expiresAt !== "number"
      || payload.issuedAt > now + 5_000
      || payload.expiresAt <= now
      || payload.expiresAt - payload.issuedAt > FORWARDED_CONTEXT_TTL_MS
    ) {
      return undefined;
    }
    return {
      workspaceId: payload.workspaceId,
      actorId: payload.actorId,
      scopes: new Set(payload.scopes as Scope[]),
      authMethod: "mcp-context",
      traceId: payload.traceId,
    };
  } catch {
    return undefined;
  }
}

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function isScope(value: unknown): value is Scope {
  return value === "mcp" || value === "read" || value === "write" || value === "admin";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}