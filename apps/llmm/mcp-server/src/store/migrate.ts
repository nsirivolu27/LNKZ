import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrations = [
  {
    version: 1,
    file: "001_initial.sql",
  },
] as const;

export async function runPostgresMigrations(databaseUrl = process.env.DATABASE_URL): Promise<number> {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run Postgres migrations.");
  const pool = new Pool({ connectionString: databaseUrl, ssl: postgresSsl(), max: 1 });
  const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`
      create table if not exists schema_migrations (
        version integer primary key,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query("select pg_advisory_xact_lock($1)", [187514]);
    const applied = await client.query<{ version: number }>("select version from schema_migrations order by version");
    const appliedVersions = new Set(applied.rows.map((row) => Number(row.version)));
    let latest = Math.max(0, ...applied.rows.map((row) => Number(row.version)));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      const sql = await readFile(resolve(migrationsDirectory, migration.file), "utf8");
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [migration.version]);
      latest = migration.version;
    }
    if (process.env.LNKZ_DATABASE_APP_ROLE) {
      await grantApplicationRole(client, process.env.LNKZ_DATABASE_APP_ROLE);
    }
    await client.query("commit");
    return latest;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function grantApplicationRole(client: import("pg").PoolClient, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("LNKZ_DATABASE_APP_ROLE must be a lowercase PostgreSQL identifier.");
  }
  const quotedRole = `"${role}"`;
  await client.query(`grant usage on schema public to ${quotedRole}`);
  await client.query(`grant select, insert, update, delete on conversations, messages, handoffs, events, rate_limit_buckets to ${quotedRole}`);
  await client.query(`grant select on schema_migrations to ${quotedRole}`);
}

function postgresSsl(): false | { rejectUnauthorized: boolean } {
  return process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runPostgresMigrations()
    .then((version) => console.log(`[db] Postgres schema is at version ${version}`))
    .catch((error) => {
      console.error(`[db] migration failed: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
}