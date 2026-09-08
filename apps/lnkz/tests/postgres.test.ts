import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { Pool } from "pg";
import { toIdentityDocument } from "../src/lnkz/identity.js";
import { migrateSqliteToPostgres } from "../src/lnkz/store/migrate-sqlite.js";
import { PostgresConversationStore, DEFAULT_WORKSPACE_ID } from "../src/lnkz/store/postgres.js";
import { runPostgresMigrations } from "../src/lnkz/store/migrate.js";
import { SqliteConversationStore } from "../src/lnkz/store/sqlite.js";

const migrationUrl = process.env.LNKZ_POSTGRES_MIGRATION_URL;
const appUrl = process.env.LNKZ_POSTGRES_TEST_URL;
const expectedAppRole = process.env.LNKZ_POSTGRES_TEST_ROLE;
const enabled = Boolean(migrationUrl && appUrl);

afterEach(async () => {
  if (enabled) await clearPostgresData();
});

test("Postgres integration uses the restricted application role", { skip: !enabled || !expectedAppRole }, async () => {
  await runPostgresMigrations(migrationUrl);
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

test("SQLite to Postgres migration preserves instance identity", { skip: !enabled }, async () => {
  await runPostgresMigrations(migrationUrl);
  await clearPostgresIdentity();

  const directory = await mkdtemp(join(tmpdir(), "lnkz-postgres-migration-"));
  const sqlitePath = join(directory, "source.db");
  const sourceStore = new SqliteConversationStore(sqlitePath);
  let sourceIdentity;
  try {
    sourceIdentity = await sourceStore.ensureInstanceIdentity("Migrated integration test");
  } finally {
    sourceStore.close();
  }

  try {
    await migrateSqliteToPostgres({ sqlite: sqlitePath, database: appUrl, dryRun: false });

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
  try {
    sourceIdentity = await sourceStore.ensureInstanceIdentity("Migrated integration test");
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

    await migrateSqliteToPostgres({ sqlite: sqlitePath, database: appUrl, dryRun: false });

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