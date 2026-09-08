import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import { Pool } from "pg";
import { toIdentityDocument, verifyHandoffPacket } from "../src/lnkz/identity.js";
import { migrateSqliteToPostgres } from "../src/lnkz/store/migrate-sqlite.js";
import {
  assertPostgresRuntimeRole,
  PostgresConversationStore,
  DEFAULT_WORKSPACE_ID,
} from "../src/lnkz/store/postgres.js";
import { runPostgresMigrations } from "../src/lnkz/store/migrate.js";
import { SqliteConversationStore } from "../src/lnkz/store/sqlite.js";

const migrationUrl = process.env.LNKZ_POSTGRES_MIGRATION_URL;
const appUrl = process.env.LNKZ_POSTGRES_TEST_URL;
const expectedAppRole = process.env.LNKZ_POSTGRES_TEST_ROLE;
const enabled = Boolean(migrationUrl && appUrl);

afterEach(async () => {
  if (enabled) await clearPostgresData();
});

test("Postgres migrations roll back a failed attempt and can be retried", { skip: !enabled }, async () => {
  const previousAppRole = process.env.LNKZ_DATABASE_APP_ROLE;
  process.env.LNKZ_DATABASE_APP_ROLE = "invalid-role";
  try {
    await assert.rejects(
      runPostgresMigrations(migrationUrl),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /Migration 3 \(003_instance_identity\.sql\) post-migration setup failed/);
        assert.match(error.message, /LNKZ_DATABASE_APP_ROLE must be a lowercase PostgreSQL identifier/);
        assert(error.cause instanceof Error);
        assert.equal(error.cause.message, "LNKZ_DATABASE_APP_ROLE must be a lowercase PostgreSQL identifier.");
        return true;
      },
    );
  } finally {
    if (previousAppRole === undefined) {
      delete process.env.LNKZ_DATABASE_APP_ROLE;
    } else {
      process.env.LNKZ_DATABASE_APP_ROLE = previousAppRole;
    }
  }

  const migrationPool = new Pool({ connectionString: migrationUrl, ssl: postgresSsl(), max: 1 });
  try {
    await assert.rejects(
      migrationPool.query("select version from schema_migrations"),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "42P01",
    );
    const tables = await migrationPool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in ('workspaces', 'conversations', 'messages', 'handoffs', 'events', 'rate_limit_buckets', 'instance_identity')
        order by table_name
      `,
    );
    assert.deepEqual(tables.rows, []);
  } finally {
    await migrationPool.end();
  }

  assert.equal(await runPostgresMigrations(migrationUrl), 3);
  const appPool = new Pool({ connectionString: appUrl, ssl: postgresSsl(), max: 1 });
  try {
    const versions = await appPool.query<{ version: number }>("select version from schema_migrations order by version");
    assert.deepEqual(
      versions.rows.map((row) => Number(row.version)),
      [1, 2, 3],
    );
    const tables = await appPool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_name = 'instance_identity'
      `,
    );
    assert.deepEqual(tables.rows, [{ table_name: "instance_identity" }]);
  } finally {
    await appPool.end();
  }

  const store = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
  const id = `postgres-migration-retry-${Date.now()}`;
  try {
    const conversation = await store.save({
      id,
      title: "Migration retry",
      summary: "The schema remained usable after a failed migration attempt.",
      source: { provider: "test" },
      participants: ["test"],
      tags: ["migration"],
      messages: [{ role: "user", content: "Retry the migration safely." }],
    });
    assert.equal(conversation.id, id);
    assert.equal((await store.get(id))?.id, id);
  } finally {
    await store.remove(id);
    store.close();
  }
});

test("Postgres migrations roll back a failed migration statement and can be retried", { skip: !enabled }, async () => {
  await resetPostgresSchema();
  const migrationPool = new Pool({ connectionString: migrationUrl, ssl: postgresSsl(), max: 1 });
  try {
    await migrationPool.query(`
      create or replace function lnkz_test_fail_on_actor_index()
      returns event_trigger
      language plpgsql
      as $$
      declare
        command record;
      begin
        for command in select * from pg_event_trigger_ddl_commands() loop
          if command.object_identity = 'public.events_workspace_actor_at_idx' then
            raise exception 'intentional migration SQL failure for rollback coverage';
          end if;
        end loop;
      end;
      $$
    `);
    await migrationPool.query(`
      create event trigger lnkz_test_fail_on_actor_index
      on ddl_command_end
      execute function lnkz_test_fail_on_actor_index()
    `);

    await assert.rejects(
      runPostgresMigrations(migrationUrl),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /Migration 2 \(002_identity_context\.sql\) failed/);
        assert.match(error.message, /intentional migration SQL failure for rollback coverage/);
        return true;
      },
    );

    const tables = await migrationPool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'schema_migrations',
          'workspaces',
          'conversations',
          'messages',
          'handoffs',
          'events',
          'rate_limit_buckets',
          'instance_identity'
        )
      order by table_name
    `);
    assert.deepEqual(tables.rows, []);
  } finally {
    await migrationPool.query("drop event trigger if exists lnkz_test_fail_on_actor_index");
    await migrationPool.query("drop function if exists lnkz_test_fail_on_actor_index()");
    await migrationPool.end();
  }

  assert.equal(await runPostgresMigrations(migrationUrl), 3);
  const store = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
  const id = `postgres-migration-sql-retry-${Date.now()}`;
  try {
    const conversation = await store.save({
      id,
      title: "Migration SQL retry",
      summary: "The schema remained usable after a failed migration statement.",
      source: { provider: "test" },
      participants: ["test"],
      tags: ["migration"],
      messages: [{ role: "user", content: "Retry the failed migration safely." }],
    });
    assert.equal(conversation.id, id);
    assert.equal((await store.get(id))?.id, id);
  } finally {
    await store.remove(id);
    store.close();
  }
});

test("Postgres migration SQL failures identify the migration and preserve the database error", async () => {
  const databaseError = new Error('column "actor_id" already exists');
  const client = {
    query: async (statement: string) => {
      if (statement.includes("select version from schema_migrations")) return { rows: [] };
      if (statement.includes("alter table events add column if not exists actor_id text")) {
        throw databaseError;
      }
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as import("pg").PoolClient;
  const originalConnect = Pool.prototype.connect;
  Object.defineProperty(Pool.prototype, "connect", {
    configurable: true,
    value: async () => client,
  });

  try {
    await assert.rejects(
      runPostgresMigrations("postgres://migration-context-test.invalid"),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /Migration 2 \(002_identity_context\.sql\) failed/);
        assert.match(error.message, /column "actor_id" already exists/);
        assert.equal(error.cause, databaseError);
        return true;
      },
    );
  } finally {
    Object.defineProperty(Pool.prototype, "connect", {
      configurable: true,
      value: originalConnect,
    });
  }
});

test("Postgres integration uses the restricted application role", { skip: !enabled || !expectedAppRole }, async () => {
  await runPostgresMigrations(migrationUrl);
  await assertPostgresRuntimeRole(appUrl);
  const pool = new Pool({ connectionString: appUrl, ssl: postgresSsl(), max: 1 });
  try {
    const result = await pool.query<{ current_user: string }>("select current_user");
    assert.equal(
      result.rows[0]?.current_user,
      expectedAppRole,
      `Postgres integration must use ${expectedAppRole}, not the migration owner`,
    );
  } finally {
    await pool.end();
  }
});

test("Postgres application role has the runtime schema privileges", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  const pool = new Pool({ connectionString: appUrl, ssl: postgresSsl(), max: 1 });
  try {
    const missing = await pool.query<{ object_name: string; privilege: string }>(`
      with required_table_privileges as (
        select
          format('%I.%I', namespace.nspname, relation.relname) as object_name,
          privilege
        from pg_class as relation
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]) as required(privilege)
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          -- These tables are not application data: one is migration bookkeeping
          -- and the other only supplies the workspace foreign-key parent.
          and relation.relname not in ('schema_migrations', 'workspaces')
      ),
      required_migration_privileges as (
        select
          'public.schema_migrations'::text as object_name,
          'SELECT'::text as privilege
      ),
      required_sequence_privileges as (
        select
          format('%I.%I', namespace.nspname, relation.relname) as object_name,
          'USAGE'::text as privilege
        from pg_class as relation
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind = 'S'
      ),
      missing as (
        select object_name, privilege
        from required_table_privileges
        where not has_table_privilege(current_user, object_name, privilege)
        union all
        select object_name, privilege
        from required_migration_privileges
        where not has_table_privilege(current_user, object_name, privilege)
        union all
        select object_name, privilege
        from required_sequence_privileges
        where not has_sequence_privilege(current_user, object_name, privilege)
      )
      select object_name, privilege
      from missing
      order by object_name, privilege
    `);

    assert.deepEqual(
      missing.rows,
      [],
      `Postgres application role is missing runtime privileges: ${missing.rows
        .map((row) => `${row.object_name} (${row.privilege})`)
        .join(", ")}`,
    );
  } finally {
    await pool.end();
  }
});

test("Postgres workspace tables require forced RLS and an isolation policy", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  const pool = new Pool({ connectionString: appUrl, ssl: postgresSsl(), max: 1 });
  try {
    const missing = await pool.query<{ table_name: string; requirement: string }>(`
      with workspace_tables as (
        select
          relation.oid as table_oid,
          format('%I.%I', namespace.nspname, relation.relname) as table_name,
          relation.relrowsecurity as rls_enabled,
          relation.relforcerowsecurity as rls_forced
        from pg_class as relation
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          -- A workspace_id column or foreign key to workspaces identifies a
          -- runtime tenant table without maintaining a second list.
          and (
            exists (
              select 1
              from pg_attribute as attribute
              where attribute.attrelid = relation.oid
                and attribute.attname = 'workspace_id'
                and not attribute.attisdropped
            )
            or exists (
              select 1
              from pg_constraint as constraint_record
              where constraint_record.conrelid = relation.oid
                and constraint_record.contype = 'f'
                and constraint_record.confrelid = 'public.workspaces'::regclass
            )
          )
      ),
      missing_requirements as (
        select table_name, 'row-level security must be enabled'::text as requirement
        from workspace_tables
        where not rls_enabled
        union all
        select table_name, 'row-level security must be forced'::text as requirement
        from workspace_tables
        where not rls_forced
        union all
        select table_name, 'a workspace isolation policy with USING and WITH CHECK is required'::text
        from workspace_tables
        where not exists (
          select 1
          from pg_policy as policy
          where policy.polrelid = workspace_tables.table_oid
            and policy.polqual is not null
            and policy.polwithcheck is not null
            and pg_get_expr(policy.polqual, policy.polrelid) ilike '%workspace_id%'
            and pg_get_expr(policy.polwithcheck, policy.polrelid) ilike '%workspace_id%'
            and pg_get_expr(policy.polqual, policy.polrelid) ilike '%app.workspace_id%'
            and pg_get_expr(policy.polwithcheck, policy.polrelid) ilike '%app.workspace_id%'
        )
      )
      select table_name, requirement
      from missing_requirements
      order by table_name, requirement
    `);

    assert.deepEqual(
      missing.rows,
      [],
      `Postgres workspace isolation requirements are missing: ${missing.rows
        .map((row) => `${row.table_name}: ${row.requirement}`)
        .join("; ")}`,
    );
  } finally {
    await pool.end();
  }
});

test("Postgres preserves instance identity across store reopen", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  await clearPostgresIdentity();

  const firstStore = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
  let created;
  try {
    created = await firstStore.ensureInstanceIdentity("Postgres integration test");
  } finally {
    firstStore.close();
  }

  const reopenedStore = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
  try {
    const reopened = await reopenedStore.getInstanceIdentity();
    assert.ok(reopened);
    assert.deepEqual(toIdentityDocument(reopened), toIdentityDocument(created));
  } finally {
    reopenedStore.close();
    await clearPostgresIdentity();
  }
});

test("SQLite to Postgres migration reports an imported instance identity", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  await clearPostgresIdentity();

  const directory = await mkdtemp(join(tmpdir(), "lnkz-postgres-migration-"));
  const sqlitePath = join(directory, "source.db");
  const sourceStore = new SqliteConversationStore(sqlitePath);
  let sourceIdentity;
  const privateConversationContent = "source conversation content stays out of migration reports";
  try {
    sourceIdentity = await sourceStore.ensureInstanceIdentity("Migrated integration test");
    await sourceStore.save({
      id: "migration-report-imported-private-conversation",
      title: "Private migration conversation",
      source: { provider: "test" },
      participants: ["test"],
      messages: [{ role: "user", content: privateConversationContent }],
    });
  } finally {
    sourceStore.close();
  }

  try {
    const migrationOutput: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => migrationOutput.push(args.map(String).join(" "));
    try {
      await migrateSqliteToPostgres({ sqlite: sqlitePath, database: appUrl, dryRun: false });
    } finally {
      console.log = originalLog;
    }

    const report = JSON.parse(migrationOutput.at(-1) ?? "{}") as {
      instanceIdentity?: {
        sourceIdentityImported?: boolean;
        existingTargetIdentityPreserved?: boolean;
      };
    };
    assert.deepEqual(report.instanceIdentity, {
      sourceIdentityImported: true,
      existingTargetIdentityPreserved: false,
    });
    const publicOutput = migrationOutput.join("\n");
    assert.doesNotMatch(publicOutput, /PRIVATE KEY/);
    assert.doesNotMatch(publicOutput, new RegExp(privateConversationContent));

    const targetStore = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
    try {
      const migrated = await targetStore.getInstanceIdentity();
      assert.ok(migrated);
      assert.deepEqual(toIdentityDocument(migrated), toIdentityDocument(sourceIdentity));
    } finally {
      targetStore.close();
    }
  } finally {
    await clearPostgresIdentity();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite to Postgres migration does not replace an existing target identity", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  await clearPostgresIdentity();

  const directory = await mkdtemp(join(tmpdir(), "lnkz-postgres-migration-"));
  const sqlitePath = join(directory, "source.db");
  const sourceStore = new SqliteConversationStore(sqlitePath);
  let sourceIdentity;
  const privateConversationContent = "source conversation content stays out of migration reports";
  try {
    sourceIdentity = await sourceStore.ensureInstanceIdentity("Migrated integration test");
    await sourceStore.save({
      id: "migration-report-private-conversation",
      title: "Private migration conversation",
      source: { provider: "test" },
      participants: ["test"],
      messages: [{ role: "user", content: privateConversationContent }],
    });
  } finally {
    sourceStore.close();
  }

  const targetStore = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
  let targetIdentity;
  try {
    targetIdentity = await targetStore.ensureInstanceIdentity("Existing target integration test");
  } finally {
    targetStore.close();
  }

  try {
    assert.notEqual(targetIdentity.instanceId, sourceIdentity.instanceId);
    const targetBeforeMigration = toIdentityDocument(targetIdentity);

    const migrationOutput: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => migrationOutput.push(args.map(String).join(" "));
    try {
      await migrateSqliteToPostgres({ sqlite: sqlitePath, database: appUrl, dryRun: false });
    } finally {
      console.log = originalLog;
    }

    const report = JSON.parse(migrationOutput.at(-1) ?? "{}") as {
      instanceIdentity?: {
        sourceIdentityImported?: boolean;
        existingTargetIdentityPreserved?: boolean;
      };
    };
    assert.deepEqual(report.instanceIdentity, {
      sourceIdentityImported: false,
      existingTargetIdentityPreserved: true,
    });
    const publicOutput = migrationOutput.join("\n");
    assert.doesNotMatch(publicOutput, /PRIVATE KEY/);
    assert.doesNotMatch(publicOutput, new RegExp(privateConversationContent));

    const reopenedTarget = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
    try {
      const targetAfterMigration = await reopenedTarget.getInstanceIdentity();
      assert.ok(targetAfterMigration);
      assert.deepEqual(toIdentityDocument(targetAfterMigration), targetBeforeMigration);
    } finally {
      reopenedTarget.close();
    }
  } finally {
    await clearPostgresIdentity();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite to Postgres migration without a source identity reports no identity change", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  await clearPostgresIdentity();

  const directory = await mkdtemp(join(tmpdir(), "lnkz-postgres-migration-"));
  const sqlitePath = join(directory, "source.db");
  const sourceStore = new SqliteConversationStore(sqlitePath);
  const privateConversationContent = "identity-less source conversation content stays out of migration reports";
  try {
    await sourceStore.save({
      id: "migration-report-no-source-identity",
      title: "Identity-less migration conversation",
      source: { provider: "test" },
      participants: ["test"],
      messages: [{ role: "user", content: privateConversationContent }],
    });
  } finally {
    sourceStore.close();
  }

  const sourceDatabase = new DatabaseSync(sqlitePath);
  try {
    sourceDatabase.exec("drop table instance_identity");
  } finally {
    sourceDatabase.close();
  }

  const targetStore = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
  let targetIdentity;
  try {
    targetIdentity = await targetStore.ensureInstanceIdentity("Existing target without source identity");
  } finally {
    targetStore.close();
  }

  try {
    const targetBeforeMigration = toIdentityDocument(targetIdentity);
    const migrationOutput: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => migrationOutput.push(args.map(String).join(" "));
    try {
      await migrateSqliteToPostgres({ sqlite: sqlitePath, database: appUrl, dryRun: false });
    } finally {
      console.log = originalLog;
    }

    const sourceReport = JSON.parse(migrationOutput[0] ?? "{}") as {
      counts?: { hasInstanceIdentity?: boolean };
    };
    assert.equal(sourceReport.counts?.hasInstanceIdentity, false);

    const report = JSON.parse(migrationOutput.at(-1) ?? "{}") as {
      instanceIdentity?: {
        sourceIdentityImported?: boolean;
        existingTargetIdentityPreserved?: boolean;
      };
    };
    assert.deepEqual(report.instanceIdentity, {
      sourceIdentityImported: false,
      existingTargetIdentityPreserved: false,
    });
    const publicOutput = migrationOutput.join("\n");
    assert.doesNotMatch(publicOutput, /PRIVATE KEY/);
    assert.doesNotMatch(publicOutput, new RegExp(privateConversationContent));

    const reopenedTarget = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
    try {
      const targetAfterMigration = await reopenedTarget.getInstanceIdentity();
      assert.ok(targetAfterMigration);
      assert.deepEqual(toIdentityDocument(targetAfterMigration), targetBeforeMigration);
    } finally {
      reopenedTarget.close();
    }
  } finally {
    await clearPostgresIdentity();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite to Postgres migration redeems handoffs with the existing target identity", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  await clearPostgresData();

  const directory = await mkdtemp(join(tmpdir(), "lnkz-postgres-migration-"));
  const sqlitePath = join(directory, "source.db");
  const sourceStore = new SqliteConversationStore(sqlitePath);
  let sourceIdentity;
  let handoff;
  try {
    sourceIdentity = await sourceStore.ensureInstanceIdentity("Migrated handoff source");
    const conversation = await sourceStore.save({
      id: "migrated-handoff-conversation",
      title: "Migrated handoff",
      source: { provider: "test" },
      participants: ["test"],
      messages: [{ role: "user", content: "A migrated handoff is redeemed after import." }],
    });
    handoff = await sourceStore.createHandoff({ conversationId: conversation.id, maxUses: 1 });
  } finally {
    sourceStore.close();
  }

  const targetStore = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
  let targetIdentity;
  try {
    targetIdentity = await targetStore.ensureInstanceIdentity("Existing handoff target");
  } finally {
    targetStore.close();
  }

  try {
    assert.notEqual(targetIdentity.instanceId, sourceIdentity.instanceId);
    await migrateSqliteToPostgres({ sqlite: sqlitePath, database: appUrl, dryRun: false });

    const migratedTarget = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
    try {
      const packet = await migratedTarget.redeemHandoff(handoff.token);
      assert.ok(packet);
      assert.equal(packet.signingInstanceId, targetIdentity.instanceId);
      assert.equal(verifyHandoffPacket(packet, targetIdentity.publicKeyPem), true);
      assert.equal(verifyHandoffPacket(packet, sourceIdentity.publicKeyPem), false);
    } finally {
      migratedTarget.close();
    }
  } finally {
    await clearPostgresData();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Postgres preserves search, handoffs, and workspace isolation", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  const store = new PostgresConversationStore(appUrl, DEFAULT_WORKSPACE_ID);
  const id = `postgres-test-${Date.now()}`;
  try {
    const conversation = await store.save({
      id,
      title: "Postgres relay",
      summary: "The relay uses Postgres for shared deployments.",
      source: { provider: "test" },
      participants: ["user"],
      tags: ["postgres"],
      messages: [{ role: "user", content: "Use Postgres when multiple instances share a database." }],
    });
    assert.equal(conversation.id, id);

    const matches = await store.search("multiple instances", 10);
    assert.equal(matches[0]?.id, id);
    assert.match(matches[0]?.snippet ?? "", /Postgres|multiple/i);

    const handoff = await store.createHandoff({ conversationId: id, maxUses: 1 });
    assert.equal((await store.redeemHandoff(handoff.token))?.conversation.id, id);
    assert.equal(await store.redeemHandoff(handoff.token), null);
  } finally {
    await store.remove(id);
    store.close();
  }
});

test("Postgres RLS fails closed for unset, empty, and foreign workspace context", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  const pool = new Pool({ connectionString: appUrl, ssl: postgresSsl(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const setting of [null, "", "00000000-0000-0000-0000-000000000099"]) {
      if (setting === null) {
        await client.query("reset app.workspace_id");
      } else {
        await client.query("select set_config('app.workspace_id', $1, true)", [setting]);
      }
      const result = await client.query("select count(*)::int as count from conversations");
      assert.equal(result.rows[0].count, 0);
    }
    await client.query("rollback");
  } finally {
    client.release();
    await pool.end();
  }
});

function postgresSsl(): false | { rejectUnauthorized: boolean } {
  return process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true };
}

async function resetPostgresSchema(): Promise<void> {
  const pool = new Pool({ connectionString: migrationUrl, ssl: postgresSsl(), max: 1 });
  try {
    await pool.query("drop event trigger if exists lnkz_test_fail_on_actor_index");
    await pool.query("drop function if exists lnkz_test_fail_on_actor_index()");
    await pool.query(`
      drop table if exists
        schema_migrations,
        instance_identity,
        rate_limit_buckets,
        events,
        handoffs,
        messages,
        conversations,
        workspaces
      cascade
    `);
  } finally {
    await pool.end();
  }
}

async function clearPostgresIdentity(): Promise<void> {
  const pool = new Pool({ connectionString: appUrl, ssl: postgresSsl(), max: 1 });
  try {
    await pool.query("delete from instance_identity");
  } finally {
    await pool.end();
  }
}

async function clearPostgresData(): Promise<void> {
  const pool = new Pool({ connectionString: appUrl, ssl: postgresSsl(), max: 1 });
  try {
    await pool.query("select set_config('app.workspace_id', $1, false)", [DEFAULT_WORKSPACE_ID]);
    await pool.query("delete from events");
    await pool.query("delete from handoffs");
    await pool.query("delete from messages");
    await pool.query("delete from conversations");
    await pool.query("delete from instance_identity");
  } finally {
    await pool.end();
  }
}