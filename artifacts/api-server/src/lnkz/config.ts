import { DEFAULT_WORKSPACE_ID, type Scope } from "./context.js";

export interface ApiPrincipal {
  key: string;
  workspaceId: string;
  actorId: string;
  scopes: Scope[];
}
export interface WorkspaceConfig {
  id: string;
  name: string;
  mode: "personal" | "team";
  useCase: string;
  datasets: { enabled: boolean; approvalTag: string };
}

export interface McpConfig {
  enabled: boolean;
  path: string;
  authRequired: boolean;
  contextSecret?: string;
}

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxBody: string;
  trustProxy: boolean | number;
  rateLimitWindowMs: number;
  shareRateLimit: number;
  apiRateLimit: number;
  shutdownTimeoutMs: number;
  mcp: McpConfig;
  auth: {
    mode: "static" | "multi-key";
    apiKeyRequired: boolean;
    defaultWorkspaceId: string;
    principals: ApiPrincipal[];
    managed: {
      enabled: boolean;
      issuerUrl: string;
      clientId: string;
      sessionTtlMs: number;
      workspaceId: string;
    };
  };
  workspaces: WorkspaceConfig[];
}

/**
 * Keep deployment configuration in one place. The store and connector modules
 * still accept their own env objects for isolated tests, while the HTTP and
 * stdio entrypoints use this validated boundary.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST?.trim() || "127.0.0.1";
  const port = integer(env.PORT, 3100, 1, 65_535, "PORT");
  const previewOrigin = exactOrigin(env.REPLIT_DEV_DOMAIN);
  const publicBaseUrl = env.LNKZ_PUBLIC_BASE_URL?.trim() || previewOrigin || `http://${host}:${port}`;
  validateBaseUrl(publicBaseUrl);

  const mcpPath = normalizePath(env.LNKZ_MCP_PATH, "/mcp");
  const mcpEnabled = boolean(env.LNKZ_MCP_ENABLED, true);
  const apiKey = env.LNKZ_API_KEY?.trim();
  const mcpAuthRequired = boolean(env.LNKZ_MCP_API_KEY_REQUIRED, false);
  let mcpContextSecret = env.LNKZ_MCP_CONTEXT_SECRET?.trim() || undefined;
  if (mcpContextSecret && mcpContextSecret.length < 32) {
    if (env.NODE_ENV === "production") {
      throw new Error("LNKZ_MCP_CONTEXT_SECRET must be at least 32 characters.");
    }
    console.warn("[config] LNKZ_MCP_CONTEXT_SECRET is too short; forwarded context signing is disabled outside production.");
    mcpContextSecret = undefined;
  }
  const allowUnauthenticated = boolean(env.LNKZ_ALLOW_UNAUTHENTICATED, env.NODE_ENV !== "production");
  const defaultWorkspaceId = env.LNKZ_POSTGRES_WORKSPACE_ID?.trim() || DEFAULT_WORKSPACE_ID;
  validateUuid(defaultWorkspaceId, "LNKZ_POSTGRES_WORKSPACE_ID");
  const authMode = env.LNKZ_AUTH_MODE?.trim().toLowerCase() === "multi-key" ? "multi-key" : "static";
  const principals = parsePrincipals(env.LNKZ_API_KEYS_JSON, apiKey, defaultWorkspaceId, env.LNKZ_DEFAULT_ACTOR_ID);
  const workspaces = parseWorkspaces(env.LNKZ_WORKSPACES_JSON, defaultWorkspaceId);
  for (const principal of principals) {
    if (!workspaces.some((workspace) => workspace.id === principal.workspaceId)) throw new Error(`API principal references unconfigured workspace "${principal.workspaceId}".`);
  }
  const managedEnabled = boolean(env.LNKZ_MANAGED_AUTH_ENABLED, Boolean(env.REPL_ID?.trim() && env.DATABASE_URL?.trim()));
  const managedIssuerUrl = env.LNKZ_MANAGED_AUTH_ISSUER?.trim() || "https://replit.com/oidc";
  const managedClientId = env.LNKZ_MANAGED_AUTH_CLIENT_ID?.trim() || env.REPL_ID?.trim() || "";
  const managedWorkspaceId = env.LNKZ_MANAGED_WORKSPACE_ID?.trim() || defaultWorkspaceId;
  if (managedEnabled && !env.DATABASE_URL?.trim()) {
    throw new Error("LNKZ_MANAGED_AUTH_ENABLED=true requires DATABASE_URL.");
  }
  if (managedEnabled && !managedClientId) {
    throw new Error("Managed authentication requires REPL_ID or LNKZ_MANAGED_AUTH_CLIENT_ID.");
  }
  if (managedEnabled) {
    validateBaseUrl(managedIssuerUrl);
    validateUuid(managedWorkspaceId, "LNKZ_MANAGED_WORKSPACE_ID");
  }
  const apiKeyRequired = Boolean(apiKey) || mcpAuthRequired || authMode === "multi-key" || !allowUnauthenticated || managedEnabled;
  if (mcpEnabled && mcpAuthRequired && principals.length === 0 && !managedEnabled) {
    throw new Error("LNKZ_MCP_API_KEY_REQUIRED=true requires API keys or managed authentication.");
  }
  if (authMode === "multi-key" && principals.length === 0) {
    throw new Error("LNKZ_AUTH_MODE=multi-key requires LNKZ_API_KEYS_JSON.");
  }
  if (apiKeyRequired && principals.length === 0 && !managedEnabled) {
    throw new Error("Authentication is required; configure LNKZ_API_KEY or LNKZ_API_KEYS_JSON.");
  }
  return {
    host,
    port,
    publicBaseUrl,
    allowedHosts: mergeExactHosts(splitList(env.ALLOWED_HOSTS), [
      exactHost(env.REPLIT_DEV_DOMAIN),
      exactHost(env.REPLIT_EXPO_DEV_DOMAIN),
    ]),
    allowedOrigins: mergeExactOrigins(splitList(env.ALLOWED_ORIGINS), [
      exactOrigin(env.REPLIT_DEV_DOMAIN),
      exactOrigin(env.REPLIT_EXPO_DEV_DOMAIN),
    ]),
    maxBody: env.LNKZ_MAX_BODY?.trim() || "24mb",
    trustProxy: proxySetting(env.LNKZ_TRUST_PROXY),
    rateLimitWindowMs: integer(env.LNKZ_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 86_400_000, "LNKZ_RATE_LIMIT_WINDOW_MS"),
    shareRateLimit: nonNegativeInteger(env.LNKZ_SHARE_RATE_LIMIT, 60, "LNKZ_SHARE_RATE_LIMIT"),
    apiRateLimit: nonNegativeInteger(env.LNKZ_API_RATE_LIMIT, 600, "LNKZ_API_RATE_LIMIT"),
    shutdownTimeoutMs: integer(env.LNKZ_SHUTDOWN_TIMEOUT_MS, 10_000, 1_000, 120_000, "LNKZ_SHUTDOWN_TIMEOUT_MS"),
    mcp: {
      enabled: mcpEnabled,
      path: mcpPath,
      authRequired: mcpAuthRequired,
      contextSecret: mcpContextSecret,
    },
    auth: {
      mode: authMode,
      apiKeyRequired,
      defaultWorkspaceId,
      principals,
      managed: {
        enabled: managedEnabled,
        issuerUrl: managedIssuerUrl,
        clientId: managedClientId,
        sessionTtlMs: integer(env.LNKZ_MANAGED_SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000, 60_000, 30 * 24 * 60 * 60 * 1000, "LNKZ_MANAGED_SESSION_TTL_MS"),
        workspaceId: managedWorkspaceId,
      },
    },
    workspaces,
  };
}

export function parseWorkspaces(value: string | undefined, defaultWorkspaceId: string): WorkspaceConfig[] {
  if (!value?.trim()) return [{ id: defaultWorkspaceId, name: "LNKZ workspace", mode: "personal", useCase: "Conversation context", datasets: { enabled: false, approvalTag: "training-approved" } }];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("LNKZ_WORKSPACES_JSON must be valid JSON."); }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("LNKZ_WORKSPACES_JSON must be a non-empty JSON array.");
  const ids = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`LNKZ_WORKSPACES_JSON[${index}] must be an object.`);
    const item = entry as { id?: unknown; name?: unknown; mode?: unknown; useCase?: unknown; datasets?: unknown };
    const id = typeof item.id === "string" ? item.id.trim() : ""; validateUuid(id, `LNKZ_WORKSPACES_JSON[${index}].id`);
    if (ids.has(id)) throw new Error(`LNKZ_WORKSPACES_JSON contains duplicate workspace id "${id}".`); ids.add(id);
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 160) throw new Error(`LNKZ_WORKSPACES_JSON[${index}].name is invalid.`);
    if (item.mode !== "personal" && item.mode !== "team") throw new Error(`LNKZ_WORKSPACES_JSON[${index}].mode must be personal or team.`);
    if (typeof item.useCase !== "string" || !item.useCase.trim() || item.useCase.length > 2_000) throw new Error(`LNKZ_WORKSPACES_JSON[${index}].useCase is invalid.`);
    const datasets = item.datasets as { enabled?: unknown; approvalTag?: unknown } | undefined;
    if (!datasets || typeof datasets.enabled !== "boolean" || typeof datasets.approvalTag !== "string" || !datasets.approvalTag.trim()) throw new Error(`LNKZ_WORKSPACES_JSON[${index}].datasets is invalid.`);
    return { id, name: item.name.trim(), mode: item.mode as "personal" | "team", useCase: item.useCase.trim(), datasets: { enabled: datasets.enabled, approvalTag: datasets.approvalTag.trim() } };
  });
}

export function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function mergeExactHosts(configured: string[], derived: Array<string | undefined>): string[] {
  return [...new Set([...configured, ...derived.filter((value): value is string => Boolean(value))])];
}

function mergeExactOrigins(configured: string[], derived: Array<string | undefined>): string[] {
  return [...new Set([...configured, ...derived.filter((value): value is string => Boolean(value))])];
}

function exactHost(value: string | undefined): string | undefined {
  const origin = exactOrigin(value);
  return origin ? new URL(origin).host : undefined;
}

function exactOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return `https://${parsed.host}`;
  } catch {
    return undefined;
  }
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.trim().toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.trim().toLowerCase())) return false;
  throw new Error(`Expected a boolean value, received "${value}".`);
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function normalizePath(value: string | undefined, fallback: string): string {
  const path = (value?.trim() || fallback).replace(/\/+/g, "/");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.length > 200 || normalized.includes("?") || normalized.includes("#")) {
    throw new Error("LNKZ_MCP_PATH must be a URL path without query or fragment components.");
  }
  const result = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  if (result === "/health" || result === "/share" || result === "/api" || result.startsWith("/api/")) {
    throw new Error("LNKZ_MCP_PATH conflicts with a reserved LNKZ route.");
  }
  return result;
}

function proxySetting(value: string | undefined): boolean | number {
  if (value == null || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "no" || normalized === "off") return false;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  throw new Error("LNKZ_TRUST_PROXY must be true, false, or a non-negative integer.");
}

function validateBaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("LNKZ_PUBLIC_BASE_URL must be an absolute http(s) URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("LNKZ_PUBLIC_BASE_URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("LNKZ_PUBLIC_BASE_URL must not include user information.");
  }
}

function parsePrincipals(
  value: string | undefined,
  fallbackKey: string | undefined,
  defaultWorkspaceId: string,
  defaultActorId: string | undefined,
): ApiPrincipal[] {
  if (!value?.trim()) {
    return fallbackKey
      ? [{
          key: fallbackKey,
          workspaceId: defaultWorkspaceId,
          actorId: defaultActorId?.trim() || "system",
          scopes: ["mcp", "read", "write", "admin"],
        }]
      : [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("LNKZ_API_KEYS_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("LNKZ_API_KEYS_JSON must be a non-empty JSON array.");
  }
  const keys = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`LNKZ_API_KEYS_JSON[${index}] must be an object.`);
    const item = entry as { key?: unknown; workspaceId?: unknown; actorId?: unknown; scopes?: unknown };
    if (typeof item.key !== "string" || !item.key.trim()) throw new Error(`LNKZ_API_KEYS_JSON[${index}].key is required.`);
    if (keys.has(item.key.trim())) throw new Error(`LNKZ_API_KEYS_JSON contains duplicate key at index ${index}.`);
    keys.add(item.key.trim());
    const workspaceId = typeof item.workspaceId === "string" ? item.workspaceId.trim() : "";
    validateUuid(workspaceId, `LNKZ_API_KEYS_JSON[${index}].workspaceId`);
    const scopes = item.scopes ?? ["mcp", "read", "write"];
    if (!Array.isArray(scopes) || scopes.some((scope) => !["mcp", "read", "write", "admin"].includes(String(scope)))) {
      throw new Error(`LNKZ_API_KEYS_JSON[${index}].scopes contains an unknown scope.`);
    }
    return {
      key: item.key.trim(),
      workspaceId,
      actorId: typeof item.actorId === "string" && item.actorId.trim() ? item.actorId.trim() : "api-key",
      scopes: [...new Set(scopes.map((scope) => String(scope) as Scope))],
    };
  });
}

function validateUuid(value: string, name: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
}
