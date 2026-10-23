import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const MCP_CONTEXT_HEADER = "x-lnkz-context";
export const MCP_CONTEXT_TTL_MS = 60_000;

const MCP_CONTEXT_MAX_TTL_MS = 5 * 60_000;
const MCP_CONTEXT_CLOCK_SKEW_MS = 5_000;
const MCP_CONTEXT_MAX_LENGTH = 8_192;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Scope = "mcp" | "read" | "write" | "admin";

export interface RequestTrace {
  id: string;
  parentId?: string;
}

export interface RequestContext {
  workspaceId: string;
  actorId: string;
  scopes: ReadonlySet<Scope>;
  authMethod: "api-key" | "managed" | "forwarded" | "default";
  trace?: RequestTrace;
}

export interface McpContextEnvelope {
  version: 1;
  workspaceId: string;
  actorId: string;
  scopes: Scope[];
  issuedAt: number;
  expiresAt: number;
  trace: RequestTrace;
}

export interface McpContextOptions {
  now?: number;
  ttlMs?: number;
  trace?: RequestTrace;
  requiredScope?: Scope;
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
 * Sign the minimum actor context another LNKZ MCP node needs. The secret never
 * enters the payload and callers should put only the returned opaque value in
 * the x-lnkz-context header.
 */
export function signMcpContext(
  context: RequestContext,
  secret: string,
  options: McpContextOptions = {},
): string {
  validateSecret(secret);
  validateContext(context);
  const issuedAt = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? MCP_CONTEXT_TTL_MS;
  if (!Number.isInteger(issuedAt) || !Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MCP_CONTEXT_MAX_TTL_MS) {
    throw new Error("MCP context expiry is outside the allowed window.");
  }

  const trace = options.trace ?? context.trace ?? { id: randomUUID() };
  validateTrace(trace);
  const payload: McpContextEnvelope = {
    version: 1,
    workspaceId: context.workspaceId,
    actorId: context.actorId,
    scopes: [...new Set(context.scopes)].sort(),
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    trace,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Verify a forwarded context without throwing details across the auth boundary.
 * The HMAC is checked before any claims are trusted.
 */
export function verifyMcpContext(
  value: string,
  secret: string,
  options: McpContextOptions = {},
): RequestContext | null {
  try {
    validateSecret(secret);
    if (!value || value.length > MCP_CONTEXT_MAX_LENGTH) return null;
    const parts = value.split(".");
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const [encoded, suppliedSignature] = parts as [string, string];
    const expected = createHmac("sha256", secret).update(encoded).digest();
    const supplied = Buffer.from(suppliedSignature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<McpContextEnvelope>;
    if (!isEnvelope(payload, options.now ?? Date.now())) return null;
    const scopes = new Set(payload.scopes);
    if (options.requiredScope && !scopes.has(options.requiredScope) && !scopes.has("admin")) return null;

    return {
      workspaceId: payload.workspaceId,
      actorId: payload.actorId,
      scopes,
      authMethod: "forwarded",
      trace: payload.trace,
    };
  } catch {
    return null;
  }
}

/** Build outbound MCP headers from the active request without exposing context fields. */
export function mcpContextHeaders(
  secret: string | undefined,
  context: RequestContext | undefined = currentRequestContext(),
  options: McpContextOptions = {},
): Record<string, string> {
  if (!secret || !context) return {};
  return { [MCP_CONTEXT_HEADER]: signMcpContext(context, secret, options) };
}

function validateSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("LNKZ_MCP_CONTEXT_SECRET must contain at least 32 bytes.");
  }
}

function validateContext(context: RequestContext): void {
  if (!UUID_PATTERN.test(context.workspaceId)) throw new Error("MCP context workspaceId must be a UUID.");
  if (!boundedString(context.actorId, 256)) throw new Error("MCP context actorId is invalid.");
  const scopes = [...context.scopes];
  if (!scopes.length || scopes.some((scope) => !isScope(scope))) throw new Error("MCP context scopes are invalid.");
}

function validateTrace(trace: RequestTrace): void {
  if (!boundedString(trace.id, 128) || (trace.parentId != null && !boundedString(trace.parentId, 128))) {
    throw new Error("MCP context trace is invalid.");
  }
}

function isEnvelope(payload: Partial<McpContextEnvelope>, now: number): payload is McpContextEnvelope {
  if (payload.version !== 1 || !UUID_PATTERN.test(payload.workspaceId ?? "") || !boundedString(payload.actorId, 256)) {
    return false;
  }
  if (!Array.isArray(payload.scopes) || !payload.scopes.length || payload.scopes.some((scope) => !isScope(scope))) {
    return false;
  }
  if (new Set(payload.scopes).size !== payload.scopes.length) return false;
  if (!Number.isInteger(payload.issuedAt) || !Number.isInteger(payload.expiresAt)) return false;
  const issuedAt = payload.issuedAt as number;
  const expiresAt = payload.expiresAt as number;
  if (issuedAt > now + MCP_CONTEXT_CLOCK_SKEW_MS || expiresAt <= now || expiresAt <= issuedAt) return false;
  if (expiresAt - issuedAt > MCP_CONTEXT_MAX_TTL_MS) return false;
  try {
    validateTrace(payload.trace as RequestTrace);
  } catch {
    return false;
  }
  return true;
}

function isScope(value: unknown): value is Scope {
  return value === "mcp" || value === "read" || value === "write" || value === "admin";
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
