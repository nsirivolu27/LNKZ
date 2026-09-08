import { createHmac, timingSafeEqual } from "node:crypto";

export interface LnkzContext {
  workspaceId: string;
  actorId: string;
  scopes: string[];
  exp: number;
  traceId: string;
}

const MAX_LIFETIME_SECONDS = 300;

export function signContext(context: Omit<LnkzContext, "exp"> & { exp?: number }, secret: string, now = Math.floor(Date.now() / 1000)): string {
  const exp = context.exp ?? now + 60;
  if (exp <= now || exp > now + MAX_LIFETIME_SECONDS) throw new Error("MCP context expiry is not short-lived.");
  const payload: LnkzContext = {
    workspaceId: requireValue(context.workspaceId, "workspace ID"),
    actorId: requireValue(context.actorId, "actor ID"),
    scopes: [...new Set(context.scopes.map((scope) => scope.trim()).filter(Boolean))],
    exp,
    traceId: requireValue(context.traceId, "trace ID"),
  };
  if (!payload.scopes.length) throw new Error("MCP context requires at least one scope.");
  const encoded = encode(JSON.stringify(payload));
  return `v1.${encoded}.${signature(encoded, secret)}`;
}

export function verifyContext(header: string | undefined, secret: string | undefined, requiredScope?: string, now = Math.floor(Date.now() / 1000)): LnkzContext | null {
  if (!header || !secret) return null;
  const parts = header.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [version, encoded, actual] = parts;
  if (!version || !encoded || !actual) return null;
  const expected = signature(encoded, secret);
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  let context: LnkzContext;
  try {
    const parsed = JSON.parse(decode(encoded)) as Partial<LnkzContext>;
    if (
      typeof parsed.workspaceId !== "string" || !parsed.workspaceId
      || typeof parsed.actorId !== "string" || !parsed.actorId
      || !Array.isArray(parsed.scopes) || parsed.scopes.some((scope) => typeof scope !== "string")
      || typeof parsed.exp !== "number" || !Number.isInteger(parsed.exp)
      || typeof parsed.traceId !== "string" || !parsed.traceId
    ) return null;
    context = { workspaceId: parsed.workspaceId, actorId: parsed.actorId, scopes: parsed.scopes, exp: parsed.exp, traceId: parsed.traceId };
  } catch {
    return null;
  }
  if (context.exp <= now || context.exp > now + MAX_LIFETIME_SECONDS) return null;
  if (requiredScope && !context.scopes.includes(requiredScope)) return null;
  return context;
}

export function outboundContextHeader(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const secret = env.LNKZ_MCP_CONTEXT_SECRET?.trim();
  const workspaceId = env.LNKZ_CONTEXT_WORKSPACE_ID?.trim();
  const actorId = env.LNKZ_CONTEXT_ACTOR_ID?.trim();
  const traceId = env.LNKZ_CONTEXT_TRACE_ID?.trim();
  const scopes = (env.LNKZ_CONTEXT_SCOPES ?? "").split(",").map((scope) => scope.trim()).filter(Boolean);
  const anyConfigured = Boolean(secret || workspaceId || actorId || traceId || scopes.length);
  if (!anyConfigured) return undefined;
  if (!secret || !workspaceId || !actorId || !traceId || !scopes.length) {
    throw new Error("Signed MCP context requires secret, workspace, actor, scopes, and trace ID.");
  }
  return signContext({ workspaceId, actorId, scopes, traceId }, secret);
}

function signature(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(`v1.${encoded}`).digest("base64url");
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function requireValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`MCP context requires ${label}.`);
  return trimmed;
}