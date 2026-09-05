import { DEFAULT_WORKSPACE_ID, type Scope } from "./context.js";

export interface ApiPrincipal {
  key: string;
  workspaceId: string;
  actorId: string;
  scopes: Scope[];
}

export interface McpConfig {
  enabled: boolean;
  path: string;
  authRequired: boolean;
}

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxBody: string;
  webDistDir?: string;
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
  };
}

/**
 * Keep deployment configuration in one place. The store and connector modules
 * still accept their own env objects for isolated tests, while the HTTP and
 * stdio entrypoints use this validated boundary.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST?.trim() || "127.0.0.1";
  const port = integer(env.PORT, 3100, 1, 65_535, "PORT");
  const publicBaseUrl = env.LNKZ_PUBLIC_BASE_URL?.trim() || `http://${host}:${port}`;
  validateBaseUrl(publicBaseUrl);

  const mcpPath = normalizePath(env.LNKZ_MCP_PATH, "/mcp");
  const mcpEnabled = boolean(env.LNKZ_MCP_ENABLED, true);
  const apiKey = env.LNKZ_API_KEY?.trim();
  const mcpAuthRequired = boolean(env.LNKZ_MCP_API_KEY_REQUIRED, false);
  const allowUnauthenticated = boolean(env.LNKZ_ALLOW_UNAUTHENTICATED, env.NODE_ENV !== "production");
  const defaultWorkspaceId = env.LNKZ_POSTGRES_WORKSPACE_ID?.trim() || DEFAULT_WORKSPACE_ID;
  validateUuid(defaultWorkspaceId, "LNKZ_POSTGRES_WORKSPACE_ID");
  const authMode = env.LNKZ_AUTH_MODE?.trim().toLowerCase() === "multi-key" ? "multi-key" : "static";
  const principals = parsePrincipals(env.LNKZ_API_KEYS_JSON, apiKey, defaultWorkspaceId, env.LNKZ_DEFAULT_ACTOR_ID);
  const apiKeyRequired = Boolean(apiKey) || mcpAuthRequired || authMode === "multi-key" || !allowUnauthenticated;
  if (mcpEnabled && mcpAuthRequired && principals.length === 0) {
    throw new Error("LNKZ_MCP_API_KEY_REQUIRED=true requires LNKZ_API_KEY or LNKZ_API_KEYS_JSON.");
  }
  if (authMode === "multi-key" && principals.length === 0) {
    throw new Error("LNKZ_AUTH_MODE=multi-key requires LNKZ_API_KEYS_JSON.");
  }
  if (apiKeyRequired && principals.length === 0) {
    throw new Error("Authentication is required; configure LNKZ_API_KEY or LNKZ_API_KEYS_JSON.");
  }

  return {
    host,
    port,
    publicBaseUrl,
    allowedHosts: splitList(env.ALLOWED_HOSTS),
    allowedOrigins: splitList(env.ALLOWED_ORIGINS),
    maxBody: env.LNKZ_MAX_BODY?.trim() || "24mb",
    webDistDir: env.WEB_DIST_DIR?.trim() || undefined,
    trustProxy: proxySetting(env.LNKZ_TRUST_PROXY),
    rateLimitWindowMs: integer(env.LNKZ_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 86_400_000, "LNKZ_RATE_LIMIT_WINDOW_MS"),
    shareRateLimit: nonNegativeInteger(env.LNKZ_SHARE_RATE_LIMIT, 60, "LNKZ_SHARE_RATE_LIMIT"),
    apiRateLimit: nonNegativeInteger(env.LNKZ_API_RATE_LIMIT, 600, "LNKZ_API_RATE_LIMIT"),
    shutdownTimeoutMs: integer(env.LNKZ_SHUTDOWN_TIMEOUT_MS, 10_000, 1_000, 120_000, "LNKZ_SHUTDOWN_TIMEOUT_MS"),
    mcp: {
      enabled: mcpEnabled,
      path: mcpPath,
      authRequired: mcpAuthRequired,
    },
    auth: {
      mode: authMode,
      apiKeyRequired,
      defaultWorkspaceId,
      principals,
    },
  };
}

export function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
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
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`LNKZ_API_KEYS_JSON[${index}] must be an object.`);
    const item = entry as { key?: unknown; workspaceId?: unknown; actorId?: unknown; scopes?: unknown };
    if (typeof item.key !== "string" || !item.key.trim()) throw new Error(`LNKZ_API_KEYS_JSON[${index}].key is required.`);
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