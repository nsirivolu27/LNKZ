import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { Pool } from "pg";
import * as oidc from "openid-client";
import type { Scope } from "./context.js";
import type { ManagedAuthenticator, ManagedIdentity } from "./auth.js";

export interface ManagedAuthConfig {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  sessionTtlMs: number;
  workspaceId: string;
}

interface IdentityClaims {
  sub?: unknown;
  iss?: unknown;
  email?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  picture?: unknown;
  exp?: unknown;
}

interface SessionUser {
  issuer: string;
  subject: string;
  email?: string;
  name?: string;
  picture?: string;
}

const SESSION_COOKIE = "lnkz_sid";
const STATE_COOKIE = "lnkz_oidc_state";
const NONCE_COOKIE = "lnkz_oidc_nonce";
const VERIFIER_COOKIE = "lnkz_oidc_verifier";
const RETURN_COOKIE = "lnkz_oidc_return";

/**
 * Replit's managed OIDC provider is deliberately kept behind this small
 * service. The API never trusts browser claims: the callback is verified by
 * openid-client and every request resolves the session to a Postgres
 * workspace membership before a request context is created.
 */
export class ManagedAuthService implements ManagedAuthenticator {
  private readonly pool: Pool;
  private readonly config: ManagedAuthConfig;
  private readonly sessionSecret: string;
  private oidcConfig: Awaited<ReturnType<typeof oidc.discovery>> | null = null;

  constructor(config: ManagedAuthConfig, databaseUrl = process.env.DATABASE_URL) {
    if (!config.enabled) throw new Error("Managed authentication is disabled.");
    if (!databaseUrl) throw new Error("DATABASE_URL is required for managed authentication.");
    this.config = config;
    this.sessionSecret = process.env.SESSION_SECRET?.trim() || randomBytes(32).toString("hex");
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
    });
  }

  async beginLogin(request: Request, response: Response): Promise<void> {
    const config = await this.getOidcConfig();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const returnTo = safeReturnTo(request.query.returnTo);
    const callbackUrl = `${requestOrigin(request)}/api/callback`;
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl,
      scope: "openid email profile",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    setCookie(response, STATE_COOKIE, state, request);
    setCookie(response, NONCE_COOKIE, nonce, request);
    setCookie(response, VERIFIER_COOKIE, verifier, request);
    setCookie(response, RETURN_COOKIE, returnTo, request);
    response.redirect(authorizationUrl.href);
  }

  async completeLogin(request: Request, response: Response): Promise<void> {
    const state = readCookie(request, STATE_COOKIE);
    const nonce = readCookie(request, NONCE_COOKIE);
    const verifier = readCookie(request, VERIFIER_COOKIE);
    if (!state || !nonce || !verifier) {
      response.redirect("/api/login");
      return;
    }

    const callbackUrl = new URL(`${requestOrigin(request)}${request.originalUrl}`);
    const tokens = await oidc.authorizationCodeGrant(await this.getOidcConfig(), callbackUrl, {
      pkceCodeVerifier: verifier,
      expectedNonce: nonce,
      expectedState: state,
      idTokenExpected: true,
    });
    const claims = tokens.claims() as unknown as IdentityClaims | undefined;
    const subject = stringClaim(claims?.sub);
    if (!subject) throw new Error("Managed identity did not include a subject.");

    const issuer = stringClaim(claims?.iss) || this.config.issuerUrl;
    const sessionUser: SessionUser = {
      issuer,
      subject,
      email: stringClaim(claims?.email),
      name: stringClaim(claims?.name) || [stringClaim(claims?.given_name), stringClaim(claims?.family_name)].filter(Boolean).join(" ") || undefined,
      picture: stringClaim(claims?.picture),
    };
    const sid = randomBytes(32).toString("base64url");
    await this.pool.query(
      `insert into managed_sessions (sid_hash, issuer, subject, user_json, expires_at)
       values ($1, $2, $3, $4, now() + ($5 * interval '1 millisecond'))`,
      [this.hashSession(sid), issuer, subject, sessionUser, this.config.sessionTtlMs],
    );

    clearCookie(response, STATE_COOKIE);
    clearCookie(response, NONCE_COOKIE);
    clearCookie(response, VERIFIER_COOKIE);
    const returnTo = safeReturnTo(readCookie(request, RETURN_COOKIE));
    clearCookie(response, RETURN_COOKIE);
    setCookie(response, SESSION_COOKIE, sid, request, this.config.sessionTtlMs);
    response.redirect(returnTo);
  }

  async authenticate(request: Request): Promise<ManagedIdentity | null> {
    const sid = bearerToken(request) || readCookie(request, SESSION_COOKIE);
    if (!sid) return null;
    const result = await this.pool.query<{
      sid_hash: string;
      issuer: string;
      subject: string;
      user_json: SessionUser;
      expires_at: string;
    }>(
      `select sid_hash, issuer, subject, user_json, expires_at
         from managed_sessions
        where sid_hash = $1 and expires_at > now()`,
      [this.hashSession(sid)],
    );
    const session = result.rows[0];
    if (!session) return null;

    const membership = await this.pool.query<{ actor_id: string; scopes: string[] }>(
      `select actor_id, scopes
         from workspace_memberships
        where workspace_id = $1 and issuer = $2 and subject = $3 and active`,
      [this.config.workspaceId, session.issuer, session.subject],
    );
    const row = membership.rows[0];
    if (!row) {
      const error = new Error("Your account is authenticated but is not a member of this workspace.") as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    const scopes = row.scopes.filter((scope): scope is Scope => ["mcp", "read", "write", "admin"].includes(scope));
    if (!scopes.length) throw new Error("Workspace membership has no valid scopes.");
    return {
      workspaceId: this.config.workspaceId,
      actorId: row.actor_id,
      scopes,
      issuer: session.issuer,
      subject: session.subject,
    };
  }

  async currentUser(request: Request): Promise<SessionUser | null> {
    const sid = bearerToken(request) || readCookie(request, SESSION_COOKIE);
    if (!sid) return null;
    const result = await this.pool.query<{ user_json: SessionUser }>(
      `select user_json from managed_sessions where sid_hash = $1 and expires_at > now()`,
      [this.hashSession(sid)],
    );
    return result.rows[0]?.user_json ?? null;
  }

  async logout(request: Request, response: Response): Promise<void> {
    const sid = bearerToken(request) || readCookie(request, SESSION_COOKIE);
    if (sid) await this.pool.query("delete from managed_sessions where sid_hash = $1", [this.hashSession(sid)]);
    clearCookie(response, SESSION_COOKIE);
    const returnTo = safeReturnTo(request.query.returnTo);
    response.redirect(returnTo);
  }

  close(): void {
    void this.pool.end();
  }

  private async getOidcConfig(): Promise<Awaited<ReturnType<typeof oidc.discovery>>> {
    if (!this.oidcConfig) this.oidcConfig = await oidc.discovery(new URL(this.config.issuerUrl), this.config.clientId);
    return this.oidcConfig;
  }

  private hashSession(value: string): string {
    return createHmac("sha256", this.sessionSecret).update(value).digest("hex");
  }
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "/";
  try {
    const url = new URL(value, "http://lnkz.local");
    if (url.origin !== "http://lnkz.local" || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function requestOrigin(request: Request): string {
  const forwarded = request.header("x-forwarded-proto");
  const protocol = forwarded?.split(",")[0]?.trim() || request.protocol;
  return `${protocol}://${request.get("host")}`;
}

function bearerToken(request: Request): string | undefined {
  const header = request.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || undefined : undefined;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries((header ?? "").split(";").map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("=") || "")];
  }).filter(([key]) => Boolean(key)));
}

function readCookie(request: Request, name: string): string | undefined {
  return parseCookies(request.header("cookie"))[name];
}

function setCookie(response: Response, name: string, value: string, request: Request, maxAge = 600_000): void {
  const secure = request.header("x-forwarded-proto") === "https" || request.protocol === "https";
  response.append("set-cookie", `${name}=${encodeURIComponent(value)}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
}

function clearCookie(response: Response, name: string): void {
  response.append("set-cookie", `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}