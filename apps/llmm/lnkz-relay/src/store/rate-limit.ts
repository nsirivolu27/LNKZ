import { Pool } from "pg";
import { resolveDatabaseUrl } from "./postgres.js";

export interface SharedRateLimitOptions {
  windowMs: number;
  max: number;
}

/**
 * This is intentionally behind the in-process limiter. The local counter
 * rejects obvious floods without making a database write; this table keeps the
 * decision consistent when App Runner has more than one instance.
 */
export class PostgresRateLimiter {
  private readonly pool: Pool;
  private readonly workspaceId: string;
  private requestsSinceCleanup = 0;

  constructor(
    databaseUrl = resolveDatabaseUrl(),
    workspaceId = process.env.LNKZ_POSTGRES_WORKSPACE_ID,
  ) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for the shared rate limiter.");
    if (!workspaceId) throw new Error("LNKZ_POSTGRES_WORKSPACE_ID is required for the shared rate limiter.");
    this.workspaceId = workspaceId;
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
    });
  }

  async allow(key: string, options: SharedRateLimitOptions): Promise<{ allowed: boolean; retryAfter: number }> {
    if (options.max <= 0) return { allowed: true, retryAfter: 0 };
    const windowId = Math.floor(Date.now() / options.windowMs);
    const expiresAt = new Date((windowId + 1) * options.windowMs).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [this.workspaceId]);
      const result = await client.query<{ count: string }>(
        `insert into rate_limit_buckets (workspace_id, bucket_key, window_id, count, expires_at)
         values ($1, $2, $3, 1, $4)
         on conflict (workspace_id, bucket_key, window_id)
         do update set count = rate_limit_buckets.count + 1
         returning count::text as count`,
        [this.workspaceId, key, windowId, expiresAt],
      );
      this.requestsSinceCleanup += 1;
      if (this.requestsSinceCleanup >= 100) {
        this.requestsSinceCleanup = 0;
        await client.query("delete from rate_limit_buckets where expires_at <= now()");
      }
      await client.query("commit");
      const count = Number(result.rows[0]?.count ?? 1);
      return {
        allowed: count <= options.max,
        retryAfter: Math.max(1, Math.ceil(((windowId + 1) * options.windowMs - Date.now()) / 1000)),
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  close(): void {
    void this.pool.end();
  }
}