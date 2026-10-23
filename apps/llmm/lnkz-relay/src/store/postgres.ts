import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { analyzeConversation } from "../intel/analyze.js";
import { noRedaction, redactConversation } from "../intel/redact.js";
import { conversationToMarkdown } from "./markdown.js";
import type { ConversationStore } from "./index.js";
import type {
  AuditEvent,
  Conversation,
  ConversationInput,
  ConversationLineage,
  ConversationMatch,
  ConversationMessage,
  ConversationSummary,
  HandoffIssue,
  HandoffOptions,
  HandoffPacket,
  HandoffSummary,
  ListOptions,
  MessageInput,
  MessageRole,
  StoreStats,
} from "../types.js";

export const REQUIRED_POSTGRES_SCHEMA_VERSION = 1;
export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

/**
 * The Postgres implementation deliberately keeps the ConversationStore
 * contract identical to SQLite. Until the identity layer supplies a request
 * workspace, LNKZ_POSTGRES_WORKSPACE_ID selects the single workspace used by
 * this process. It is required explicitly in production deployments.
 */
export class PostgresConversationStore implements ConversationStore {
  private readonly pool: Pool;
  private readonly workspaceId: string;
  private readonly ready: Promise<void>;

  constructor(databaseUrl = resolveDatabaseUrl(), workspaceId = process.env.LNKZ_POSTGRES_WORKSPACE_ID || DEFAULT_WORKSPACE_ID) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for the Postgres store.");
    if (!isUuid(workspaceId)) throw new Error("LNKZ_POSTGRES_WORKSPACE_ID must be a UUID.");
    this.workspaceId = workspaceId;
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: boundedPoolSize(Number(process.env.LNKZ_PG_POOL_MAX ?? 8)),
      idleTimeoutMillis: Number(process.env.LNKZ_PG_IDLE_TIMEOUT_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.LNKZ_PG_CONNECTION_TIMEOUT_MS ?? 5_000),
      maxLifetimeSeconds: Number(process.env.LNKZ_PG_MAX_LIFETIME_SECONDS ?? 300),
      ssl: postgresSsl(),
    });
    this.ready = this.assertSchema();
  }

  async save(input: ConversationInput): Promise<Conversation> {
    return this.transaction(async (client) => {
      const existing = input.id ? await this.loadConversation(client, input.id) : null;
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id: input.id || randomUUID(),
        version: 1,
        title: input.title.trim(),
        summary: input.summary?.trim() || undefined,
        source: { ...input.source, provider: input.source.provider.trim().toLowerCase() },
        participants: uniqueStrings(input.participants ?? []),
        tags: uniqueStrings(input.tags ?? []),
        messages: input.messages.map((message, index) => normalizeMessage(message, index, now)),
        lineage: normalizeLineage(input.lineage, input.id || undefined),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        metadata: input.metadata,
      };

      await this.writeConversation(client, conversation);
      await this.recordEventWithClient(client, {
        kind: existing ? "conversation.updated" : "conversation.saved",
        conversationId: conversation.id,
        detail: { provider: conversation.source.provider, messages: conversation.messages.length },
      });
      return conversation;
    });
  }

  async get(id: string): Promise<Conversation | null> {
    return this.transaction((client) => this.loadConversation(client, id));
  }

  async list(options: ListOptions = {}): Promise<ConversationSummary[]> {
    return this.transaction(async (client) => {
      const limit = boundedLimit(options.limit ?? 25, 200);
      const offset = Math.max(0, options.offset ?? 0);
      const filters: string[] = [];
      const values: unknown[] = [];
      if (options.provider) {
        values.push(options.provider.toLowerCase());
        filters.push(`provider = $${values.length}`);
      }
      if (options.tag) {
        values.push(options.tag);
        filters.push(`tags_json @> $${values.length}::jsonb`);
      }
      if (options.participant) {
        values.push(options.participant);
        filters.push(`participants_json @> $${values.length}::jsonb`);
      }
      values.push(limit, offset);
      const result = await client.query<ConversationRow>(
        `select id, title, summary, provider, source_json, participants_json, tags_json,
                lineage_json, metadata_json, created_at, updated_at
           from conversations
          ${filters.length ? `where ${filters.join(" and ")}` : ""}
          order by updated_at desc
          limit $${values.length - 1} offset $${values.length}`,
        [...values.slice(0, -2), limit, offset],
      );
      const summaries: ConversationSummary[] = [];
      for (const row of result.rows) {
        summaries.push(rowToSummary(row, await this.messageCount(client, row.id)));
      }
      return summaries;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query("delete from conversations where id = $1", [id]);
      if (!result.rowCount) return false;
      await this.recordEventWithClient(client, { kind: "conversation.deleted", conversationId: id });
      return true;
    });
  }

  async appendMessages(id: string, messages: MessageInput[]): Promise<Conversation | null> {
    return this.transaction(async (client) => {
      const existing = await this.loadConversation(client, id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const conversation: Conversation = {
        ...existing,
        messages: [...existing.messages, ...messages.map((message, index) => normalizeMessage(message, existing.messages.length + index, now))],
        updatedAt: now,
      };
      await this.writeConversation(client, conversation);
      await this.recordEventWithClient(client, {
        kind: "conversation.appended",
        conversationId: id,
        detail: { added: messages.length, total: conversation.messages.length },
      });
      return conversation;
    });
  }

  async search(query: string, limit: number): Promise<ConversationMatch[]> {
    return this.transaction(async (client) => {
      const bounded = boundedLimit(limit, 50);
      const terms = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 2)
        .slice(0, 12);
      if (!terms.length) return [];

      const strict = await this.runSearch(client, terms.join(" "), bounded);
      const rows = strict.length ? strict : await this.runSearch(client, terms.join(" OR "), bounded);
      if (!rows.length) return [];
      const best = Math.max(...rows.map((row) => Number(row.score)));
      const matches: ConversationMatch[] = [];
      for (const row of rows) {
        const conversation = await this.loadConversation(client, row.id);
        if (!conversation) continue;
        matches.push({
          ...conversationToSummary(conversation),
          relevance: best === 0 ? 1 : Number((Number(row.score) / best).toFixed(3)),
          snippet: row.snippet.replace(/\s+/g, " ").trim(),
        });
      }
      return matches;
    });
  }

  async createHandoff(options: HandoffOptions): Promise<HandoffIssue> {
    return this.transaction(async (client) => {
      const conversation = await this.loadConversation(client, options.conversationId);
      if (!conversation) throw new Error("Conversation not found.");
      const token = randomBytes(24).toString("base64url");
      const now = new Date();
      const ttlMinutes = Math.max(5, Math.min(options.ttlMinutes ?? 60, 10_080));
      const maxUses = Math.max(1, Math.min(options.maxUses ?? 25, 1_000));
      const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
      const id = randomUUID();

      await client.query(
        `insert into handoffs
          (id, workspace_id, conversation_id, token_hash, created_at, expires_at, max_uses, uses, audience, note, redact)
         values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10)`,
        [id, this.workspaceId, options.conversationId, hashToken(token), now.toISOString(), expiresAt, maxUses,
          options.audience ?? null, options.note ?? null, Boolean(options.redact)],
      );
      await this.recordEventWithClient(client, {
        kind: "handoff.created",
        conversationId: options.conversationId,
        handoffId: id,
        detail: { ttlMinutes, maxUses, redact: Boolean(options.redact), audience: options.audience },
      });
      return { id, token, expiresAt, maxUses, audience: options.audience, redact: Boolean(options.redact) };
    });
  }

  async redeemHandoff(token: string): Promise<HandoffPacket | null> {
    return this.transaction(async (client) => {
      const result = await client.query<HandoffRow>(
        `update handoffs
            set uses = uses + 1
          where token_hash = $1
            and revoked_at is null
            and expires_at > now()
            and uses < max_uses
        returning id, workspace_id, conversation_id, token_hash, created_at, expires_at,
                  max_uses, uses, revoked_at, audience, note, redact`,
        [hashToken(token)],
      );
      if (!result.rows.length) {
        await this.recordEventWithClient(client, {
          kind: "handoff.rejected",
          detail: { reason: "missing, expired, revoked, or exhausted token" },
        });
        return null;
      }
      const row = result.rows[0];
      const conversation = await this.loadConversation(client, row.conversation_id);
      if (!conversation) return null;
      await this.recordEventWithClient(client, {
        kind: "handoff.redeemed",
        conversationId: row.conversation_id,
        handoffId: row.id,
        detail: { use: row.uses, maxUses: row.max_uses },
      });
      const redacted = row.redact ? redactConversation(conversation, { aggressive: true }) : null;
      const payload = redacted?.conversation ?? conversation;
      return {
        format: "lnkz.conversation.v1",
        conversation: payload,
        transcriptMarkdown: conversationToMarkdown(payload),
        analysis: analyzeConversation(payload),
        redaction: redacted?.report ?? noRedaction(),
        handoff: {
          id: row.id,
          usesRemaining: row.max_uses - row.uses,
          expiresAt: row.expires_at,
          audience: row.audience ?? undefined,
        },
        exportedAt: new Date().toISOString(),
      };
    });
  }

  async revokeHandoff(handoffId: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `update handoffs set revoked_at = now()
          where id = $1 and revoked_at is null`,
        [handoffId],
      );
      if (!result.rowCount) return false;
      await this.recordEventWithClient(client, { kind: "handoff.revoked", handoffId });
      return true;
    });
  }

  async listHandoffs(conversationId?: string): Promise<HandoffSummary[]> {
    return this.transaction(async (client) => {
      const result = conversationId
        ? await client.query<HandoffRow>(
          `select id, workspace_id, conversation_id, token_hash, created_at, expires_at,
                  max_uses, uses, revoked_at, audience, note, redact
             from handoffs where conversation_id = $1 order by created_at desc`,
          [conversationId],
        )
        : await client.query<HandoffRow>(
          `select id, workspace_id, conversation_id, token_hash, created_at, expires_at,
                  max_uses, uses, revoked_at, audience, note, redact
             from handoffs order by created_at desc limit 200`,
        );
      const now = Date.now();
      return result.rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        maxUses: row.max_uses,
        uses: row.uses,
        revokedAt: row.revoked_at ?? undefined,
        audience: row.audience ?? undefined,
        note: row.note ?? undefined,
        redact: row.redact,
        active: !row.revoked_at && new Date(row.expires_at).getTime() > now && row.uses < row.max_uses,
      }));
    });
  }

  async recordEvent(event: Omit<AuditEvent, "id" | "at"> & { at?: string }): Promise<void> {
    await this.transaction((client) => this.recordEventWithClient(client, event));
  }

  async listEvents(limit: number): Promise<AuditEvent[]> {
    return this.transaction(async (client) => {
      const result = await client.query<EventRow>(
        `select id, at, kind, conversation_id, handoff_id, detail_json
           from events order by at desc, id desc limit $1`,
        [boundedLimit(limit, 500)],
      );
      return result.rows.map((row) => ({
        id: row.id,
        at: row.at,
        kind: row.kind,
        conversationId: row.conversation_id ?? undefined,
        handoffId: row.handoff_id ?? undefined,
        detail: row.detail_json ? parseJson<Record<string, unknown>>(row.detail_json) : undefined,
      }));
    });
  }

  async stats(): Promise<StoreStats> {
    return this.transaction(async (client) => {
      const conversations = await client.query<{ total: string }>("select count(*)::text as total from conversations");
      const messages = await client.query<{ total: string }>("select count(*)::text as total from messages");
      const events = await client.query<{ total: string }>("select count(*)::text as total from events");
      const handoffs = await client.query<{ total: string }>(
        "select count(*)::text as total from handoffs where revoked_at is null and expires_at > now() and uses < max_uses",
      );
      const providers = await client.query<{ provider: string; count: string }>(
        "select provider, count(*)::text as count from conversations group by provider order by count desc",
      );
      return {
        conversations: Number(conversations.rows[0]?.total ?? 0),
        messages: Number(messages.rows[0]?.total ?? 0),
        providers: providers.rows.map((row) => ({ provider: row.provider, count: Number(row.count) })),
        activeHandoffs: Number(handoffs.rows[0]?.total ?? 0),
        events: Number(events.rows[0]?.total ?? 0),
      };
    });
  }

  close(): void {
    void this.pool.end();
  }

  private async assertSchema(): Promise<void> {
    const result = await this.pool.query<{ version: number }>(
      "select version from schema_migrations order by version desc limit 1",
    );
    const version = Number(result.rows[0]?.version ?? 0);
    if (version < REQUIRED_POSTGRES_SCHEMA_VERSION) {
      throw new Error(
        `Postgres schema is behind (found ${version}, need ${REQUIRED_POSTGRES_SCHEMA_VERSION}); run npm run db:migrate before starting LNKZ.`,
      );
    }
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [this.workspaceId]);
      await client.query("select set_config('app.actor_id', '', true)");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadConversation(client: PoolClient, id: string): Promise<Conversation | null> {
    const conversation = await client.query<ConversationRow>(
      `select id, title, summary, provider, source_json, participants_json, tags_json,
              lineage_json, metadata_json, created_at, updated_at
         from conversations where id = $1`,
      [id],
    );
    const row = conversation.rows[0];
    if (!row) return null;
    const messages = await client.query<MessageRow>(
      `select conversation_id, seq, id, role, content, author, created_at, metadata_json
         from messages where conversation_id = $1 order by seq asc`,
      [id],
    );
    return rowToConversation(row, messages.rows);
  }

  private async writeConversation(client: PoolClient, conversation: Conversation): Promise<void> {
    const bodyText = [conversation.summary ?? "", ...conversation.messages.map((message) => message.content)]
      .filter(Boolean)
      .join("\n");
    const tagsText = conversation.tags.join(" ");
    const participantsText = conversation.participants.join(" ");
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
         title = excluded.title,
         summary = excluded.summary,
         provider = excluded.provider,
         source_json = excluded.source_json,
         participants_json = excluded.participants_json,
         tags_json = excluded.tags_json,
         lineage_json = excluded.lineage_json,
         metadata_json = excluded.metadata_json,
         search_text = excluded.search_text,
         search_vector = excluded.search_vector,
         updated_at = excluded.updated_at`,
      [
        conversation.id,
        this.workspaceId,
        conversation.title,
        conversation.summary ?? null,
        conversation.source.provider,
        JSON.stringify(conversation.source),
        JSON.stringify(conversation.participants),
        JSON.stringify(conversation.tags),
        conversation.lineage ? JSON.stringify(conversation.lineage) : null,
        conversation.metadata ? JSON.stringify(conversation.metadata) : null,
        bodyText,
        tagsText,
        participantsText,
        conversation.createdAt,
        conversation.updatedAt,
      ],
    );

    await client.query("delete from messages where conversation_id = $1", [conversation.id]);
    for (const [seq, message] of conversation.messages.entries()) {
      await client.query(
        `insert into messages
          (conversation_id, workspace_id, seq, id, role, content, author, created_at, metadata_json)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          conversation.id,
          this.workspaceId,
          seq,
          message.id,
          message.role,
          message.content,
          message.author ?? null,
          message.createdAt,
          message.metadata ? JSON.stringify(message.metadata) : null,
        ],
      );
    }
  }

  private async recordEventWithClient(
    client: PoolClient,
    event: Omit<AuditEvent, "id" | "at"> & { at?: string },
  ): Promise<void> {
    await client.query(
      `insert into events (id, workspace_id, at, kind, conversation_id, handoff_id, detail_json)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        randomUUID(),
        this.workspaceId,
        event.at ?? new Date().toISOString(),
        event.kind,
        event.conversationId ?? null,
        event.handoffId ?? null,
        event.detail ? JSON.stringify(event.detail) : null,
      ],
    );
  }

  private async messageCount(client: PoolClient, conversationId: string): Promise<number> {
    const result = await client.query<{ total: string }>(
      "select count(*)::text as total from messages where conversation_id = $1",
      [conversationId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private async runSearch(client: PoolClient, query: string, limit: number): Promise<SearchRow[]> {
    const result = await client.query<SearchRow>(
      `with q as (select websearch_to_tsquery('english', $1) as query)
       select c.id,
              ts_rank_cd(c.search_vector, q.query, 32) as score,
              ts_headline(
                'english',
                c.search_text,
                q.query,
                'MaxFragments=2,MaxWords=18,MinWords=8'
              ) as snippet
         from conversations c cross join q
        where c.search_vector @@ q.query
        order by score desc, c.updated_at desc
        limit $2`,
      [query, limit],
    );
    return result.rows;
  }
}

interface ConversationRow extends QueryResultRow {
  id: string;
  title: string;
  summary: string | null;
  provider: string;
  source_json: unknown;
  participants_json: unknown;
  tags_json: unknown;
  lineage_json: unknown;
  metadata_json: unknown;
  created_at: string;
  updated_at: string;
}

interface MessageRow extends QueryResultRow {
  conversation_id: string;
  seq: number;
  id: string;
  role: string;
  content: string;
  author: string | null;
  created_at: string;
  metadata_json: unknown;
}

interface HandoffRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  audience: string | null;
  note: string | null;
  redact: boolean;
}

interface EventRow extends QueryResultRow {
  id: string;
  at: string;
  kind: string;
  conversation_id: string | null;
  handoff_id: string | null;
  detail_json: unknown;
}

interface SearchRow extends QueryResultRow {
  id: string;
  score: number;
  snippet: string;
}

function rowToConversation(row: ConversationRow, messages: MessageRow[]): Conversation {
  return {
    id: row.id,
    version: 1,
    title: row.title,
    summary: row.summary ?? undefined,
    source: parseJson(row.source_json) as Conversation["source"],
    participants: parseJson(row.participants_json) as string[],
    tags: parseJson(row.tags_json) as string[],
    lineage: row.lineage_json ? (parseJson(row.lineage_json) as ConversationLineage) : undefined,
    metadata: row.metadata_json ? parseJson(row.metadata_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messages.map((message): ConversationMessage => ({
      id: message.id,
      role: message.role as MessageRole,
      content: message.content,
      author: message.author ?? undefined,
      createdAt: message.created_at,
      metadata: message.metadata_json ? parseJson(message.metadata_json) : undefined,
    })),
  };
}

function rowToSummary(row: ConversationRow, messageCount: number): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? undefined,
    source: parseJson(row.source_json) as Conversation["source"],
    participants: parseJson(row.participants_json) as string[],
    tags: parseJson(row.tags_json) as string[],
    lineage: row.lineage_json ? (parseJson(row.lineage_json) as ConversationLineage) : undefined,
    messageCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function conversationToSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    source: conversation.source,
    participants: conversation.participants,
    tags: conversation.tags,
    lineage: conversation.lineage,
    messageCount: conversation.messages.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function normalizeMessage(message: MessageInput, index: number, fallbackDate: string): ConversationMessage {
  return {
    id: message.id || randomUUID(),
    role: message.role,
    content: message.content.trim(),
    author: message.author?.trim() || undefined,
    createdAt: validDate(message.createdAt) || fallbackDate,
    metadata: message.metadata,
  };
}

function normalizeLineage(lineage: ConversationLineage | undefined, selfId?: string): ConversationLineage | undefined {
  if (!lineage) return undefined;
  const parentId = lineage.parentId?.trim() || undefined;
  return {
    parentId,
    rootId: lineage.rootId?.trim() || parentId || selfId,
    handoffId: lineage.handoffId?.trim() || undefined,
    continuedBy: lineage.continuedBy?.trim() || undefined,
  };
}

function parseJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function boundedLimit(limit: number, max: number): number {
  return Math.max(1, Math.min(Math.trunc(limit) || 1, max));
}

function boundedPoolSize(value: number): number {
  return Math.max(1, Math.min(Number.isFinite(value) ? Math.trunc(value) : 8, 32));
}

function validDate(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function postgresSsl(): false | { rejectUnauthorized: boolean } {
  return process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true };
}

export function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const secret = process.env.DATABASE_SECRET_JSON;
  if (!secret || !process.env.DATABASE_HOST) return undefined;
  try {
    const credentials = JSON.parse(secret) as { username?: string; password?: string };
    if (!credentials.username || !credentials.password) return undefined;
    const port = process.env.DATABASE_PORT ?? "5432";
    const database = process.env.DATABASE_NAME ?? "lnkz";
    return `postgresql://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@${process.env.DATABASE_HOST}:${port}/${database}`;
  } catch {
    return undefined;
  }
}