import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { DEFAULT_WORKSPACE_ID } from "./postgres.js";

interface Args {
  sqlite: string;
  database?: string;
  dryRun: boolean;
}

interface SourceConversation {
  id: string;
  title: string;
  summary: string | null;
  provider: string;
  source_json: string;
  participants_json: string;
  tags_json: string;
  lineage_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceMessage {
  conversation_id: string;
  seq: number;
  id: string;
  role: string;
  content: string;
  author: string | null;
  created_at: string;
  metadata_json: string | null;
}

interface SourceHandoff {
  id: string;
  conversation_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  audience: string | null;
  note: string | null;
  redact: number;
}

interface SourceEvent {
  id: string;
  at: string;
  kind: string;
  conversation_id: string | null;
  handoff_id: string | null;
  detail_json: string | null;
}

export async function migrateSqliteToPostgres(args = parseArgs(process.argv.slice(2))): Promise<void> {
  const source = new DatabaseSync(resolve(args.sqlite));
  try {
    const conversations = source.prepare("select * from conversations order by created_at, id").all() as unknown as SourceConversation[];
    const messages = source.prepare("select * from messages order by conversation_id, seq").all() as unknown as SourceMessage[];
    const handoffs = source.prepare("select * from handoffs order by created_at, id").all() as unknown as SourceHandoff[];
    const events = source.prepare("select * from events order by at, id").all() as unknown as SourceEvent[];
    validateSource(conversations, messages);
    const counts = {
      conversations: conversations.length,
      messages: messages.length,
      handoffs: handoffs.length,
      events: events.length,
    };
    console.log(JSON.stringify({ dryRun: args.dryRun, source: resolve(args.sqlite), counts }, null, 2));
    if (args.dryRun) return;
    if (!args.database) throw new Error("--database or DATABASE_URL is required unless --dry-run is used.");

    const pool = new Pool({ connectionString: args.database, ssl: postgresSsl(), max: 1 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [DEFAULT_WORKSPACE_ID]);
      await assertTargetReady(client);
      for (const conversation of conversations) {
        const conversationMessages = messages.filter((message) => message.conversation_id === conversation.id);
        await writeConversation(client, conversation, conversationMessages);
      }
      for (const handoff of handoffs) await writeHandoff(client, handoff);
      for (const event of events) await writeEvent(client, event);
      await client.query("commit");
      console.log(JSON.stringify({ migrated: counts }, null, 2));
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  } finally {
    source.close();
  }
}

function validateSource(conversations: SourceConversation[], messages: SourceMessage[]): void {
  const ids = new Set(conversations.map((conversation) => conversation.id));
  for (const message of messages) {
    if (!ids.has(message.conversation_id)) {
      throw new Error(`SQLite message ${message.id} points to missing conversation ${message.conversation_id}.`);
    }
  }
}

async function assertTargetReady(client: PoolClient): Promise<void> {
  const result = await client.query<{ version: number }>(
    "select version from schema_migrations order by version desc limit 1",
  );
  if (Number(result.rows[0]?.version ?? 0) < 1) {
    throw new Error("Postgres migrations must run before the SQLite import.");
  }
}

async function writeConversation(client: PoolClient, row: SourceConversation, messages: SourceMessage[]): Promise<void> {
  const summary = row.summary ?? "";
  const body = [summary, ...messages.map((message) => message.content)].filter(Boolean).join("\n");
  const tags = parseArray(row.tags_json);
  const participants = parseArray(row.participants_json);
  await client.query(
    `insert into conversations
      (id, workspace_id, title, summary, provider, source_json, participants_json, tags_json,
       lineage_json, metadata_json, search_text, search_vector, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11,
       setweight(to_tsvector('english', coalesce($3, '')), 'A') ||
       setweight(to_tsvector('english', coalesce($4, '')), 'B') ||
       setweight(to_tsvector('english', coalesce($11, '')), 'B') ||
       setweight(to_tsvector('english', coalesce($12, '')), 'C') ||
       setweight(to_tsvector('english', coalesce($13, '')), 'C'),
       $14, $15)
     on conflict (id) do update set
       title = excluded.title, summary = excluded.summary, provider = excluded.provider,
       source_json = excluded.source_json, participants_json = excluded.participants_json,
       tags_json = excluded.tags_json, lineage_json = excluded.lineage_json,
       metadata_json = excluded.metadata_json, search_text = excluded.search_text,
       search_vector = excluded.search_vector, updated_at = excluded.updated_at`,
    [
      row.id,
      DEFAULT_WORKSPACE_ID,
      row.title,
      row.summary,
      row.provider,
      row.source_json,
      row.participants_json,
      row.tags_json,
      row.lineage_json,
      row.metadata_json,
      body,
      tags.join(" "),
      participants.join(" "),
      row.created_at,
      row.updated_at,
    ],
  );
  await client.query("delete from messages where conversation_id = $1", [row.id]);
  for (const message of messages) {
    await client.query(
      `insert into messages
        (conversation_id, workspace_id, seq, id, role, content, author, created_at, metadata_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        row.id,
        DEFAULT_WORKSPACE_ID,
        message.seq,
        message.id,
        message.role,
        message.content,
        message.author,
        message.created_at,
        message.metadata_json,
      ],
    );
  }
}

async function writeHandoff(client: PoolClient, row: SourceHandoff): Promise<void> {
  await client.query(
    `insert into handoffs
      (id, workspace_id, conversation_id, token_hash, created_at, expires_at, max_uses, uses,
       revoked_at, audience, note, redact)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (id) do update set
       conversation_id = excluded.conversation_id, token_hash = excluded.token_hash,
       created_at = excluded.created_at, expires_at = excluded.expires_at,
       max_uses = excluded.max_uses, uses = excluded.uses, revoked_at = excluded.revoked_at,
       audience = excluded.audience, note = excluded.note, redact = excluded.redact`,
    [
      row.id,
      DEFAULT_WORKSPACE_ID,
      row.conversation_id,
      row.token_hash,
      row.created_at,
      row.expires_at,
      row.max_uses,
      row.uses,
      row.revoked_at,
      row.audience,
      row.note,
      Boolean(row.redact),
    ],
  );
}

async function writeEvent(client: PoolClient, row: SourceEvent): Promise<void> {
  await client.query(
    `insert into events (id, workspace_id, at, kind, conversation_id, handoff_id, detail_json)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     on conflict (id) do nothing`,
    [row.id, DEFAULT_WORKSPACE_ID, row.at, row.kind, row.conversation_id, row.handoff_id, row.detail_json],
  );
}

function parseArgs(values: string[]): Args {
  const get = (name: string): string | undefined => {
    const index = values.indexOf(name);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const sqlite = get("--sqlite") ?? process.env.LNKZ_DB_FILE ?? ".data/lnkz.db";
  return {
    sqlite,
    database: get("--database") ?? process.env.DATABASE_URL,
    dryRun: values.includes("--dry-run"),
  };
}

function parseArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}

function postgresSsl(): false | { rejectUnauthorized: boolean } {
  return process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true };
}

if (process.argv[1]?.endsWith("migrate-sqlite.ts")) {
  migrateSqliteToPostgres().catch((error) => {
    console.error(`[db] SQLite migration failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}