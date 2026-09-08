import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE conversations (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  summary           TEXT,
  provider          TEXT NOT NULL,
  source_json       TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  tags_json         TEXT NOT NULL,
  lineage_json      TEXT,
  metadata_json     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_conversations_updated  ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_provider ON conversations(provider);

CREATE TABLE messages (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  id              TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  author          TEXT,
  created_at      TEXT NOT NULL,
  metadata_json   TEXT,
  PRIMARY KEY (conversation_id, seq)
);

CREATE VIRTUAL TABLE conversation_search USING fts5(
  conversation_id UNINDEXED,
  title,
  body,
  tags,
  participants,
  tokenize = 'porter unicode61'
);

CREATE TABLE handoffs (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  max_uses        INTEGER NOT NULL,
  uses            INTEGER NOT NULL DEFAULT 0,
  revoked_at      TEXT,
  audience        TEXT,
  note            TEXT,
  redact          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_handoffs_conversation ON handoffs(conversation_id);

CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  at              TEXT NOT NULL,
  kind            TEXT NOT NULL,
  conversation_id TEXT,
  handoff_id      TEXT,
  detail_json     TEXT
);
CREATE INDEX idx_events_at ON events(at DESC);
`;

/**
 * SQLite via node:sqlite. No native module to compile, which matters because
 * LNKZ is meant to be self-hosted by one person on whatever machine they have.
 */
export class SqliteConversationStore implements ConversationStore {
  readonly filePath: string;
  private readonly db: DatabaseSync;

  constructor(filePath = process.env.LNKZ_DB_FILE || ".data/lnkz.db") {
    this.filePath = filePath === ":memory:" ? filePath : resolve(filePath);
    if (this.filePath !== ":memory:") mkdirSync(dirname(this.filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.importLegacyJsonOnce();
  }

  private migrate(): void {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
    const current = Number(row?.user_version ?? 0);
    if (current >= SCHEMA_VERSION) return;
    if (current === 0) {
      this.db.exec(SCHEMA);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  }

  /**
   * Anyone running the pre-SQLite build has a .data/lnkz.json file. Importing it
   * once on first boot means upgrading does not silently orphan their history.
   */
  private importLegacyJsonOnce(): void {
    const legacyPath = process.env.LNKZ_DATA_FILE || ".data/lnkz.json";
    if (this.filePath === ":memory:" || !existsSync(legacyPath)) return;
    const count = this.db.prepare("SELECT COUNT(*) AS total FROM conversations").get() as { total: number };
    if (count.total > 0) return;
    try {
      const snapshot = JSON.parse(readFileSync(legacyPath, "utf8")) as { conversations?: Conversation[] };
      for (const conversation of snapshot.conversations ?? []) {
        this.writeConversation({ ...conversation, version: 1 });
      }
      this.recordEventSync({ kind: "legacy.import", detail: { conversations: snapshot.conversations?.length ?? 0 } });
    } catch {
      // A malformed legacy file must not stop the server from starting.
    }
  }

  async save(input: ConversationInput): Promise<Conversation> {
    const now = new Date().toISOString();
    const existing = input.id ? await this.get(input.id) : null;
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
    this.writeConversation(conversation);
    this.recordEventSync({
      kind: existing ? "conversation.updated" : "conversation.saved",
      conversationId: conversation.id,
      detail: { provider: conversation.source.provider, messages: conversation.messages.length },
    });
    return conversation;
  }

  async get(id: string): Promise<Conversation | null> {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as unknown as ConversationRow | undefined;
    if (!row) return null;
    const messages = this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC")
      .all(id) as unknown as MessageRow[];
    return rowToConversation(row, messages);
  }

  async list(options: ListOptions = {}): Promise<ConversationSummary[]> {
    const limit = boundedLimit(options.limit ?? 25, 200);
    const offset = Math.max(0, options.offset ?? 0);
    const filters: string[] = [];
    const params: (string | number)[] = [];
    if (options.provider) {
      filters.push("provider = ?");
      params.push(options.provider.toLowerCase());
    }
    if (options.tag) {
      filters.push("tags_json LIKE ?");
      params.push(`%"${options.tag}"%`);
    }
    if (options.participant) {
      filters.push("participants_json LIKE ?");
      params.push(`%${options.participant}%`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM conversations ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as ConversationRow[];
    return rows.map((row) => rowToSummary(row, this.messageCount(row.id)));
  }

  async remove(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    if (!result.changes) return false;
    this.db.prepare("DELETE FROM conversation_search WHERE conversation_id = ?").run(id);
    this.recordEventSync({ kind: "conversation.deleted", conversationId: id });
    return true;
  }

  async appendMessages(id: string, messages: MessageInput[]): Promise<Conversation | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const merged: Conversation = {
      ...existing,
      messages: [...existing.messages, ...messages.map((message, index) => normalizeMessage(message, existing.messages.length + index, now))],
      updatedAt: now,
    };
    this.writeConversation(merged);
    this.recordEventSync({
      kind: "conversation.appended",
      conversationId: id,
      detail: { added: messages.length, total: merged.messages.length },
    });
    return merged;
  }

  async search(query: string, limit: number): Promise<ConversationMatch[]> {
    const bounded = boundedLimit(limit, 50);
    const strict = toMatchExpression(query, "AND");
    let rows = strict ? this.runSearch(strict, bounded) : [];
    if (!rows.length) {
      const loose = toMatchExpression(query, "OR");
      rows = loose ? this.runSearch(loose, bounded) : [];
    }
    if (!rows.length) return [];

    // bm25() is negative and lower is better; flip it into a 0-1 relevance.
    const best = Math.min(...rows.map((row) => row.score));
    return rows
      .map((row) => {
        const conversation = this.db
          .prepare("SELECT * FROM conversations WHERE id = ?")
          .get(row.conversation_id) as unknown as ConversationRow | undefined;
        if (!conversation) return null;
        return {
          ...rowToSummary(conversation, this.messageCount(conversation.id)),
          relevance: best === 0 ? 1 : Number((row.score / best).toFixed(3)),
          snippet: row.snippet.replace(/\s+/g, " ").trim(),
        } satisfies ConversationMatch;
      })
      .filter((match): match is ConversationMatch => match != null);
  }

  async createHandoff(options: HandoffOptions): Promise<HandoffIssue> {
    const conversation = this.db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(options.conversationId) as { id: string } | undefined;
    if (!conversation) throw new Error("Conversation not found.");

    const token = randomBytes(24).toString("base64url");
    const now = new Date();
    const ttlMinutes = Math.max(5, Math.min(options.ttlMinutes ?? 60, 10_080));
    const maxUses = Math.max(1, Math.min(options.maxUses ?? 25, 1_000));
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO handoffs (id, conversation_id, token_hash, created_at, expires_at, max_uses, uses, audience, note, redact)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      options.conversationId,
      hashToken(token),
      now.toISOString(),
      expiresAt,
      maxUses,
      options.audience ?? null,
      options.note ?? null,
      options.redact ? 1 : 0,
    );

    this.purgeExpiredHandoffs(now.toISOString());
    this.recordEventSync({
      kind: "handoff.created",
      conversationId: options.conversationId,
      handoffId: id,
      detail: { ttlMinutes, maxUses, redact: Boolean(options.redact), audience: options.audience },
    });

    return { id, token, expiresAt, maxUses, audience: options.audience, redact: Boolean(options.redact) };
  }

  async redeemHandoff(token: string): Promise<HandoffPacket | null> {
    const now = new Date().toISOString();
    const row = this.db
      .prepare("SELECT * FROM handoffs WHERE token_hash = ?")
      .get(hashToken(token)) as unknown as HandoffRow | undefined;
    if (!row) return null;
    if (row.revoked_at || row.expires_at <= now || row.uses >= row.max_uses) {
      this.recordEventSync({
        kind: "handoff.rejected",
        conversationId: row.conversation_id,
        handoffId: row.id,
        detail: { reason: row.revoked_at ? "revoked" : row.expires_at <= now ? "expired" : "exhausted" },
      });
      return null;
    }

    const conversation = await this.get(row.conversation_id);
    if (!conversation) return null;

    this.db.prepare("UPDATE handoffs SET uses = uses + 1 WHERE id = ?").run(row.id);
    this.recordEventSync({
      kind: "handoff.redeemed",
      conversationId: row.conversation_id,
      handoffId: row.id,
      detail: { use: row.uses + 1, maxUses: row.max_uses },
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
        usesRemaining: row.max_uses - (row.uses + 1),
        expiresAt: row.expires_at,
        audience: row.audience ?? undefined,
      },
      exportedAt: new Date().toISOString(),
    };
  }

  async revokeHandoff(handoffId: string): Promise<boolean> {
    const result = this.db
      .prepare("UPDATE handoffs SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), handoffId);
    if (!result.changes) return false;
    this.recordEventSync({ kind: "handoff.revoked", handoffId });
    return true;
  }

  async listHandoffs(conversationId?: string): Promise<HandoffSummary[]> {
    const rows = conversationId
      ? this.db.prepare("SELECT * FROM handoffs WHERE conversation_id = ? ORDER BY created_at DESC").all(conversationId) as unknown as HandoffRow[]
      : this.db.prepare("SELECT * FROM handoffs ORDER BY created_at DESC LIMIT 200").all() as unknown as HandoffRow[];
    const now = new Date().toISOString();
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      uses: row.uses,
      revokedAt: row.revoked_at ?? undefined,
      audience: row.audience ?? undefined,
      note: row.note ?? undefined,
      redact: Boolean(row.redact),
      active: !row.revoked_at && row.expires_at > now && row.uses < row.max_uses,
    }));
  }

  async recordEvent(event: Omit<AuditEvent, "id" | "at"> & { at?: string }): Promise<void> {
    this.recordEventSync(event);
  }

  async listEvents(limit: number): Promise<AuditEvent[]> {
    const rows = this.db
      .prepare("SELECT * FROM events ORDER BY at DESC, rowid DESC LIMIT ?")
      .all(boundedLimit(limit, 500)) as unknown as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      kind: row.kind,
      conversationId: row.conversation_id ?? undefined,
      handoffId: row.handoff_id ?? undefined,
      detail: row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : undefined,
    }));
  }

  async stats(): Promise<StoreStats> {
    const now = new Date().toISOString();
    const conversations = this.db.prepare("SELECT COUNT(*) AS total FROM conversations").get() as { total: number };
    const messages = this.db.prepare("SELECT COUNT(*) AS total FROM messages").get() as { total: number };
    const events = this.db.prepare("SELECT COUNT(*) AS total FROM events").get() as { total: number };
    const handoffs = this.db
      .prepare("SELECT COUNT(*) AS total FROM handoffs WHERE revoked_at IS NULL AND expires_at > ? AND uses < max_uses")
      .get(now) as { total: number };
    const providers = this.db
      .prepare("SELECT provider, COUNT(*) AS count FROM conversations GROUP BY provider ORDER BY count DESC")
      .all() as { provider: string; count: number }[];
    return {
      conversations: conversations.total,
      messages: messages.total,
      providers,
      activeHandoffs: handoffs.total,
      events: events.total,
    };
  }

  close(): void {
    this.db.close();
  }

  private runSearch(expression: string, limit: number): SearchRow[] {
    try {
      return this.db.prepare(`
        SELECT conversation_id,
               bm25(conversation_search, 8.0, 1.0, 2.0, 2.0) AS score,
               snippet(conversation_search, 2, '', '', '...', 18) AS snippet
        FROM conversation_search
        WHERE conversation_search MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(expression, limit) as unknown as SearchRow[];
    } catch {
      return [];
    }
  }

  private messageCount(conversationId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?")
      .get(conversationId) as { total: number };
    return row.total;
  }

  private purgeExpiredHandoffs(now: string): void {
    this.db.prepare("DELETE FROM handoffs WHERE expires_at <= ?").run(now);
  }

  private writeConversation(conversation: Conversation): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        INSERT INTO conversations (id, title, summary, provider, source_json, participants_json, tags_json, lineage_json, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          summary = excluded.summary,
          provider = excluded.provider,
          source_json = excluded.source_json,
          participants_json = excluded.participants_json,
          tags_json = excluded.tags_json,
          lineage_json = excluded.lineage_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(
        conversation.id,
        conversation.title,
        conversation.summary ?? null,
        conversation.source.provider,
        JSON.stringify(conversation.source),
        JSON.stringify(conversation.participants),
        JSON.stringify(conversation.tags),
        conversation.lineage ? JSON.stringify(conversation.lineage) : null,
        conversation.metadata ? JSON.stringify(conversation.metadata) : null,
        conversation.createdAt,
        conversation.updatedAt,
      );

      this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversation.id);
      const insertMessage = this.db.prepare(`
        INSERT INTO messages (conversation_id, seq, id, role, content, author, created_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      conversation.messages.forEach((message, index) => {
        insertMessage.run(
          conversation.id,
          index,
          message.id,
          message.role,
          message.content,
          message.author ?? null,
          message.createdAt,
          message.metadata ? JSON.stringify(message.metadata) : null,
        );
      });

      this.db.prepare("DELETE FROM conversation_search WHERE conversation_id = ?").run(conversation.id);
      this.db.prepare(`
        INSERT INTO conversation_search (conversation_id, title, body, tags, participants)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        conversation.id,
        conversation.title,
        [conversation.summary ?? "", ...conversation.messages.map((message) => message.content)].join("\n"),
        conversation.tags.join(" "),
        conversation.participants.join(" "),
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private recordEventSync(event: Omit<AuditEvent, "id" | "at"> & { at?: string }): void {
    this.db.prepare(`
      INSERT INTO events (id, at, kind, conversation_id, handoff_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      event.at ?? new Date().toISOString(),
      event.kind,
      event.conversationId ?? null,
      event.handoffId ?? null,
      event.detail ? JSON.stringify(event.detail) : null,
    );
  }
}

interface ConversationRow {
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

interface MessageRow {
  conversation_id: string;
  seq: number;
  id: string;
  role: string;
  content: string;
  author: string | null;
  created_at: string;
  metadata_json: string | null;
}

interface HandoffRow {
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

interface EventRow {
  id: string;
  at: string;
  kind: string;
  conversation_id: string | null;
  handoff_id: string | null;
  detail_json: string | null;
}

interface SearchRow {
  conversation_id: string;
  score: number;
  snippet: string;
}

function rowToConversation(row: ConversationRow, messages: MessageRow[]): Conversation {
  return {
    ...rowToBase(row),
    messages: messages.map((message): ConversationMessage => ({
      id: message.id,
      role: message.role as MessageRole,
      content: message.content,
      author: message.author ?? undefined,
      createdAt: message.created_at,
      metadata: message.metadata_json ? (JSON.parse(message.metadata_json) as Record<string, unknown>) : undefined,
    })),
  };
}

function rowToSummary(row: ConversationRow, messageCount: number): ConversationSummary {
  const base = rowToBase(row);
  return {
    id: base.id,
    title: base.title,
    summary: base.summary,
    source: base.source,
    participants: base.participants,
    tags: base.tags,
    lineage: base.lineage,
    messageCount,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  };
}

function rowToBase(row: ConversationRow): Omit<Conversation, "messages"> {
  return {
    id: row.id,
    version: 1,
    title: row.title,
    summary: row.summary ?? undefined,
    source: JSON.parse(row.source_json) as Conversation["source"],
    participants: JSON.parse(row.participants_json) as string[],
    tags: JSON.parse(row.tags_json) as string[],
    lineage: row.lineage_json ? (JSON.parse(row.lineage_json) as ConversationLineage) : undefined,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

/**
 * FTS5 has its own query grammar, and user text routinely contains characters
 * that make it throw. Everything is reduced to quoted terms joined by one operator.
 */
export function toMatchExpression(query: string, operator: "AND" | "OR"): string | null {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2)
    .slice(0, 12);
  if (!terms.length) return null;
  return terms.map((term) => `"${term}"`).join(` ${operator} `);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function boundedLimit(limit: number, max: number): number {
  return Math.max(1, Math.min(Math.trunc(limit) || 1, max));
}

function validDate(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
