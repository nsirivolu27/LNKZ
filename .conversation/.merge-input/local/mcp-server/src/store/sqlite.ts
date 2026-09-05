import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeConversation } from "../intel/analyze.js";
import { noRedaction, redactConversation } from "../intel/redact.js";
import { conversationToMarkdown } from "./markdown.js";
import type { ConversationStore } from "./index.js";
import type {
  AuditEvent,
  AccountRecord,
  Actor,
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
  SessionRecord,
  ApiTokenIssue,
  ApiTokenSummary,
  InviteIssue,
  MembershipRecord,
  TokenScope,
  WorkspaceRecord,
} from "../types.js";
import { can, type Capability } from "../capabilities.js";

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE conversations (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL DEFAULT 'default',
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
  workspace_id UNINDEXED,
  title,
  body,
  tags,
  participants,
  tokenize = 'porter unicode61'
);

CREATE TABLE handoffs (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL DEFAULT 'default',
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
  workspace_id     TEXT NOT NULL DEFAULT 'default',
  actor_id        TEXT,
  at              TEXT NOT NULL,
  kind            TEXT NOT NULL,
  conversation_id TEXT,
  handoff_id      TEXT,
  detail_json     TEXT
);
CREATE INDEX idx_events_at ON events(at DESC);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE memberships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','member','viewer')),
  PRIMARY KEY (user_id, workspace_id)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read','write','admin')),
  created_at TEXT NOT NULL
  ,expires_at TEXT
  ,revoked_at TEXT
);
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  at TEXT NOT NULL,
  success INTEGER NOT NULL
);
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
      this.ensureBootstrapWorkspace();
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    } else if (current === 1) {
      if (this.filePath !== ":memory:" && existsSync(this.filePath)) {
        this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        const backup = `${this.filePath}.v1-backup-${Date.now()}`;
        copyFileSync(this.filePath, backup);
        console.log(`[store] backed up v1 database to ${backup}`);
      }
      this.db.exec("ALTER TABLE conversations ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default'");
      this.db.exec("ALTER TABLE handoffs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default'");
      this.db.exec("ALTER TABLE events ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default'");
      this.db.exec("DROP TABLE conversation_search");
      this.db.exec(`CREATE VIRTUAL TABLE conversation_search USING fts5(
        conversation_id UNINDEXED, workspace_id UNINDEXED, title, body, tags, participants,
        tokenize = 'porter unicode61'
      )`);
      this.createAuthTables();
      this.ensureColumn("events", "actor_id", "TEXT");
      this.ensureBootstrapWorkspace();
      this.rebuildSearchIndex();
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  }

  private createAuthTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member','viewer')), PRIMARY KEY(user_id, workspace_id));
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, idle_expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT 'read', expires_at TEXT, revoked_at TEXT);
      CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL, expires_at TEXT NOT NULL, redeemed_at TEXT);
      CREATE TABLE IF NOT EXISTS login_attempts (id TEXT PRIMARY KEY, email TEXT NOT NULL, at TEXT NOT NULL, success INTEGER NOT NULL);
    `);
    this.ensureColumn("api_tokens", "prefix", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("api_tokens", "created_at", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("api_tokens", "scope", "TEXT NOT NULL DEFAULT 'read'");
    this.ensureColumn("api_tokens", "expires_at", "TEXT");
    this.ensureColumn("api_tokens", "revoked_at", "TEXT");
    this.ensureColumn("invites", "created_at", "TEXT NOT NULL DEFAULT ''");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private ensureBootstrapWorkspace(): void {
    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('default', 'Default workspace', ?)")
      .run(now);
  }

  private rebuildSearchIndex(): void {
    this.db.exec("DELETE FROM conversation_search");
    const conversations = this.db.prepare("SELECT * FROM conversations").all() as unknown as ConversationRow[];
    for (const row of conversations) {
      const messages = this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq").all(row.id) as unknown as MessageRow[];
      this.indexConversation(row, messages);
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
        this.writeConversation({ ...conversation, version: 1 }, { id: "legacy-import", workspaceId: "default", role: "owner", auth: "legacy" });
      }
      this.recordEventSync({ kind: "legacy.import", detail: { conversations: snapshot.conversations?.length ?? 0 } });
    } catch {
      // A malformed legacy file must not stop the server from starting.
    }
  }

  async save(input: ConversationInput, actor: Actor): Promise<Conversation> {
    if (input.id) {
      const visible = this.db.prepare("SELECT 1 FROM conversations WHERE workspace_id = ? AND id = ?")
        .get(actor.workspaceId, input.id);
      const exists = this.db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(input.id);
      if (!visible && exists) throw new Error("Conversation not found.");
    }
    requireCapability(actor, "conversation:write");
    const now = new Date().toISOString();
    const existing = input.id ? await this.get(input.id, actor) : null;
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
    this.writeConversation(conversation, actor);
    this.recordEventSync({
      kind: existing ? "conversation.updated" : "conversation.saved",
      conversationId: conversation.id,
      detail: { provider: conversation.source.provider, messages: conversation.messages.length },
    }, actor);
    return conversation;
  }

  async get(id: string, actor: Actor): Promise<Conversation | null> {
    requireCapability(actor, "conversation:read");
    const row = this.db.prepare("SELECT * FROM conversations WHERE workspace_id = ? AND id = ?").get(actor.workspaceId, id) as unknown as ConversationRow | undefined;
    if (!row) return null;
    const messages = this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC")
      .all(id) as unknown as MessageRow[];
    return rowToConversation(row, messages);
  }

  async list(options: ListOptions, actor: Actor): Promise<ConversationSummary[]> {
    requireCapability(actor, "conversation:read");
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
      .prepare(`SELECT * FROM conversations WHERE workspace_id = ?${where ? ` AND ${where.slice(6)}` : ""} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(actor.workspaceId, ...params, limit, offset) as unknown as ConversationRow[];
    return rows.map((row) => rowToSummary(row, this.messageCount(row.id)));
  }

  async remove(id: string, actor: Actor): Promise<boolean> {
    const visible = this.db.prepare("SELECT 1 FROM conversations WHERE workspace_id = ? AND id = ?")
      .get(actor.workspaceId, id);
    if (!visible) return false;
    requireCapability(actor, "conversation:delete");
    const result = this.db.prepare("DELETE FROM conversations WHERE workspace_id = ? AND id = ?").run(actor.workspaceId, id);
    if (!result.changes) return false;
    this.db.prepare("DELETE FROM conversation_search WHERE workspace_id = ? AND conversation_id = ?")
      .run(actor.workspaceId, id);
    this.recordEventSync({ kind: "conversation.deleted", conversationId: id }, actor);
    return true;
  }

  async appendMessages(id: string, messages: MessageInput[], actor: Actor): Promise<Conversation | null> {
    const existing = await this.get(id, actor);
    if (!existing) return null;
    requireCapability(actor, "conversation:write");
    const now = new Date().toISOString();
    const merged: Conversation = {
      ...existing,
      messages: [...existing.messages, ...messages.map((message, index) => normalizeMessage(message, existing.messages.length + index, now))],
      updatedAt: now,
    };
    this.writeConversation(merged, actor);
    this.recordEventSync({
      kind: "conversation.appended",
      conversationId: id,
      detail: { added: messages.length, total: merged.messages.length },
    }, actor);
    return merged;
  }

  async search(query: string, limit: number, actor: Actor): Promise<ConversationMatch[]> {
    requireCapability(actor, "conversation:read");
    const bounded = boundedLimit(limit, 50);
    const strict = toMatchExpression(query, "AND");
    let rows = strict ? this.runSearch(strict, bounded, actor.workspaceId) : [];
    if (!rows.length) {
      const loose = toMatchExpression(query, "OR");
      rows = loose ? this.runSearch(loose, bounded, actor.workspaceId) : [];
    }
    if (!rows.length) return [];

    // bm25() is negative and lower is better; flip it into a 0-1 relevance.
    const best = Math.min(...rows.map((row) => row.score));
    return rows
      .map((row) => {
        const conversation = this.db
          .prepare("SELECT * FROM conversations WHERE workspace_id = ? AND id = ?")
          .get(actor.workspaceId, row.conversation_id) as unknown as ConversationRow | undefined;
        if (!conversation) return null;
        return {
          ...rowToSummary(conversation, this.messageCount(conversation.id)),
          relevance: best === 0 ? 1 : Number((row.score / best).toFixed(3)),
          snippet: row.snippet.replace(/\s+/g, " ").trim(),
        } satisfies ConversationMatch;
      })
      .filter((match): match is ConversationMatch => match != null);
  }

  async createHandoff(options: HandoffOptions, actor: Actor): Promise<HandoffIssue> {
    const conversation = this.db
      .prepare("SELECT id FROM conversations WHERE workspace_id = ? AND id = ?")
      .get(actor.workspaceId, options.conversationId) as { id: string } | undefined;
    if (!conversation) throw new Error("Conversation not found.");
    requireCapability(actor, "handoff:create");

    const token = randomBytes(24).toString("base64url");
    const now = new Date();
    const ttlMinutes = Math.max(5, Math.min(options.ttlMinutes ?? 60, 10_080));
    const maxUses = Math.max(1, Math.min(options.maxUses ?? 25, 1_000));
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO handoffs (id, workspace_id, conversation_id, token_hash, created_at, expires_at, max_uses, uses, audience, note, redact)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      actor.workspaceId,
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
    }, actor);

    return { id, token, expiresAt, maxUses, audience: options.audience, redact: Boolean(options.redact) };
  }

  async redeemHandoff(token: string, actor: Actor): Promise<HandoffPacket | null> {
    const now = new Date().toISOString();
    const row = this.db
      .prepare(actor.auth === "share"
        ? "SELECT * FROM handoffs WHERE token_hash = ?"
        : "SELECT * FROM handoffs WHERE workspace_id = ? AND token_hash = ?")
      .get(...(actor.auth === "share" ? [hashToken(token)] : [actor.workspaceId, hashToken(token)])) as unknown as HandoffRow | undefined;
    if (!row) return null;
    const auditActor = actor.auth === "share" ? { ...actor, workspaceId: row.workspace_id } : actor;
    if (row.revoked_at || row.expires_at <= now || row.uses >= row.max_uses) {
      this.recordEventSync({
        kind: "handoff.rejected",
        conversationId: row.conversation_id,
        handoffId: row.id,
        detail: { reason: row.revoked_at ? "revoked" : row.expires_at <= now ? "expired" : "exhausted" },
      }, auditActor);
      return null;
    }

    const conversation = actor.auth === "share"
      ? await this.get(row.conversation_id, auditActor)
      : await this.get(row.conversation_id, actor);
    if (!conversation) return null;

    this.db.prepare("UPDATE handoffs SET uses = uses + 1 WHERE id = ?").run(row.id);
    this.recordEventSync({
      kind: "handoff.redeemed",
      conversationId: row.conversation_id,
      handoffId: row.id,
      detail: { use: row.uses + 1, maxUses: row.max_uses },
    }, auditActor);

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

  async revokeHandoff(handoffId: string, actor: Actor): Promise<boolean> {
    const visible = this.db.prepare("SELECT 1 FROM handoffs WHERE workspace_id = ? AND id = ?")
      .get(actor.workspaceId, handoffId);
    if (!visible) return false;
    requireCapability(actor, "handoff:revoke");
    const result = this.db
      .prepare("UPDATE handoffs SET revoked_at = ? WHERE workspace_id = ? AND id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), actor.workspaceId, handoffId);
    if (!result.changes) return false;
    this.recordEventSync({ kind: "handoff.revoked", handoffId }, actor);
    return true;
  }

  async listHandoffs(conversationId: string | undefined, actor: Actor): Promise<HandoffSummary[]> {
    requireCapability(actor, "conversation:read");
    const rows = conversationId
        ? this.db.prepare("SELECT * FROM handoffs WHERE workspace_id = ? AND conversation_id = ? ORDER BY created_at DESC").all(actor.workspaceId, conversationId) as unknown as HandoffRow[]
       : this.db.prepare("SELECT * FROM handoffs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200").all(actor.workspaceId) as unknown as HandoffRow[];
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

  async recordEvent(event: Omit<AuditEvent, "id" | "at"> & { at?: string }, actor: Actor): Promise<void> {
    this.recordEventSync(event, actor);
  }

  async listEvents(limit: number, actor: Actor): Promise<AuditEvent[]> {
    requireCapability(actor, "audit:read");
    const rows = this.db
      .prepare("SELECT * FROM events WHERE workspace_id = ? ORDER BY at DESC, rowid DESC LIMIT ?")
      .all(actor.workspaceId, boundedLimit(limit, 500)) as unknown as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id ?? undefined,
      at: row.at,
      kind: row.kind,
      conversationId: row.conversation_id ?? undefined,
      handoffId: row.handoff_id ?? undefined,
      detail: row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : undefined,
    }));
  }

  async stats(actor: Actor): Promise<StoreStats> {
    requireCapability(actor, "conversation:read");
    const now = new Date().toISOString();
    const conversations = this.db.prepare("SELECT COUNT(*) AS total FROM conversations WHERE workspace_id = ?").get(actor.workspaceId) as { total: number };
    const messages = this.db.prepare("SELECT COUNT(*) AS total FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE workspace_id = ?)").get(actor.workspaceId) as { total: number };
    const events = this.db.prepare("SELECT COUNT(*) AS total FROM events WHERE workspace_id = ?").get(actor.workspaceId) as { total: number };
    const handoffs = this.db
      .prepare("SELECT COUNT(*) AS total FROM handoffs WHERE workspace_id = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses")
      .get(actor.workspaceId, now) as { total: number };
    const providers = this.db
      .prepare("SELECT provider, COUNT(*) AS count FROM conversations WHERE workspace_id = ? GROUP BY provider ORDER BY count DESC")
      .all(actor.workspaceId) as { provider: string; count: number }[];
    return {
      conversations: conversations.total,
      messages: messages.total,
      providers,
      activeHandoffs: handoffs.total,
      events: events.total,
    };
  }

  async createAccount(email: string, passwordHash: string): Promise<AccountRecord> {
    const normalized = email.trim().toLowerCase();
    const id = randomUUID();
    const workspaceId = randomUUID();
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)").run(id, normalized, passwordHash, now);
      this.db.prepare("INSERT INTO workspaces (id,name,created_at) VALUES (?,?,?)").run(workspaceId, "Personal workspace", now);
      this.db.prepare("INSERT INTO memberships (user_id,workspace_id,role) VALUES (?,?,?)").run(id, workspaceId, "owner");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { id, email: normalized, passwordHash, workspaceId, role: "owner" };
  }

  async findAccount(email: string): Promise<AccountRecord | null> {
    const row = this.db.prepare(`
      SELECT u.id, u.email, u.password_hash, m.workspace_id, m.role
      FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE u.email = ? ORDER BY m.role = 'owner' DESC LIMIT 1
    `).get(email.trim().toLowerCase()) as { id: string; email: string; password_hash: string; workspace_id: string; role: AccountRecord["role"] } | undefined;
    return row ? { id: row.id, email: row.email, passwordHash: row.password_hash, workspaceId: row.workspace_id, role: row.role } : null;
  }

  async findAccountById(id: string): Promise<AccountRecord | null> {
    const row = this.db.prepare(`
      SELECT u.id, u.email, u.password_hash, m.workspace_id, m.role
      FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE u.id = ? ORDER BY m.role = 'owner' DESC LIMIT 1
    `).get(id) as { id: string; email: string; password_hash: string; workspace_id: string; role: AccountRecord["role"] } | undefined;
    return row ? { id: row.id, email: row.email, passwordHash: row.password_hash, workspaceId: row.workspace_id, role: row.role } : null;
  }

  async loginBlocked(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) AS failures, MAX(at) AS last_failure
      FROM login_attempts WHERE email = ? AND success = 0 AND at > ?
    `).get(normalized, since) as { failures: number; last_failure: string | null };
    if (row.failures < 5 || !row.last_failure) return false;
    const backoff = Math.min(15 * 60_000, 1_000 * (2 ** Math.min(row.failures - 5, 10)));
    return Date.parse(row.last_failure) + backoff > Date.now();
  }

  async recordLoginAttempt(email: string, success: boolean): Promise<void> {
    this.db.prepare("INSERT INTO login_attempts (id, email, at, success) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), email.trim().toLowerCase(), new Date().toISOString(), success ? 1 : 0);
    this.db.prepare("DELETE FROM login_attempts WHERE at < ?")
      .run(new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  }

  async createSession(account: AccountRecord, tokenHash: string, expiresAt: string, idleExpiresAt: string): Promise<void> {
    this.db.prepare("INSERT INTO sessions (id,user_id,workspace_id,role,token_hash,expires_at,idle_expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), account.id, account.workspaceId, account.role, tokenHash, expiresAt, idleExpiresAt, new Date().toISOString());
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const row = this.db.prepare(`
      SELECT s.*, m.role FROM sessions s
      JOIN memberships m ON m.user_id = s.user_id AND m.workspace_id = s.workspace_id
      WHERE s.token_hash=? AND s.expires_at>? AND s.idle_expires_at>?
    `).get(tokenHash, new Date().toISOString(), new Date().toISOString()) as { id: string; user_id: string; workspace_id: string; role: Actor["role"]; expires_at: string; idle_expires_at: string } | undefined;
    if (!row) return null;
    const idle = new Date(Date.now() + 30 * 60_000).toISOString();
    this.db.prepare("UPDATE sessions SET idle_expires_at = ?, role = ? WHERE id = ?").run(idle, row.role, row.id);
    return { id: row.id, actor: { id: row.user_id, workspaceId: row.workspace_id, role: row.role, auth: "session" }, expiresAt: row.expires_at, idleExpiresAt: idle };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash);
  }

  async findApiToken(tokenHash: string): Promise<{ actor: Actor; scope: TokenScope } | null> {
    const row = this.db.prepare(`
      SELECT t.id, t.user_id, t.workspace_id, t.scope, m.role
      FROM api_tokens t
      JOIN memberships m ON m.user_id = t.user_id AND m.workspace_id = t.workspace_id
      WHERE t.token_hash = ?
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > ?)
    `).get(tokenHash, new Date().toISOString()) as
      { id: string; user_id: string; workspace_id: string; scope: TokenScope; role: Actor["role"] } | undefined;
    if (!row) return null;
    return {
      scope: row.scope,
      actor: { id: row.user_id, workspaceId: row.workspace_id, role: row.role, auth: "api_token", scope: row.scope },
    };
  }

  async createApiToken(actor: Actor, scope: TokenScope, expiresAt?: string): Promise<ApiTokenIssue> {
    requireCapability(actor, "token:manage");
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const prefix = token.slice(0, 8);
    this.db.prepare(`
      INSERT INTO api_tokens (id, user_id, workspace_id, token_hash, prefix, scope, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, actor.id, actor.workspaceId, hashToken(token), prefix, scope, new Date().toISOString(), expiresAt ?? null);
    this.recordEventSync({ kind: "token.created", detail: { tokenId: id, prefix, scope } }, actor);
    return { id, token, prefix, scope, expiresAt };
  }

  async listApiTokens(actor: Actor): Promise<ApiTokenSummary[]> {
    requireCapability(actor, "token:manage");
    const rows = this.db.prepare(`
      SELECT id, prefix, scope, created_at, expires_at, revoked_at
      FROM api_tokens
      WHERE workspace_id = ?
      ORDER BY created_at DESC
    `).all(actor.workspaceId) as {
      id: string; prefix: string; scope: TokenScope; created_at: string; expires_at: string | null; revoked_at: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id, prefix: row.prefix, scope: row.scope, createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined, revokedAt: row.revoked_at ?? undefined,
    }));
  }

  async revokeApiToken(actor: Actor, tokenId: string): Promise<boolean> {
    requireCapability(actor, "token:manage");
    const result = this.db.prepare(`
      UPDATE api_tokens SET revoked_at = ?
      WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), tokenId, actor.workspaceId);
    if (result.changes) this.recordEventSync({ kind: "token.revoked", detail: { tokenId } }, actor);
    return Boolean(result.changes);
  }

  async createInvite(actor: Actor, email: string, role: Actor["role"], expiresAt: string): Promise<InviteIssue> {
    requireCapability(actor, "workspace:manage");
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const normalizedEmail = email.trim().toLowerCase();
    this.db.prepare(`
      INSERT INTO invites (id, workspace_id, email, token_hash, role, expires_at, redeemed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(id, actor.workspaceId, normalizedEmail, hashToken(token), role, expiresAt, new Date().toISOString());
    this.recordEventSync({ kind: "invite.created", detail: { inviteId: id, email: normalizedEmail, role } }, actor);
    return { id, token, email: normalizedEmail, role, expiresAt };
  }

  async acceptInvite(token: string, actor: Actor): Promise<boolean> {
    const row = this.db.prepare(`
      SELECT id, workspace_id, email, role
      FROM invites
      WHERE token_hash = ? AND redeemed_at IS NULL AND expires_at > ?
    `).get(hashToken(token), new Date().toISOString()) as
      { id: string; workspace_id: string; email: string; role: Actor["role"] } | undefined;
    if (!row || row.email !== this.accountEmail(actor.id)) return false;
    this.db.prepare("INSERT OR REPLACE INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)")
      .run(actor.id, row.workspace_id, row.role);
    this.db.prepare("UPDATE invites SET redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL")
      .run(new Date().toISOString(), row.id);
    this.recordEventSync({ kind: "invite.accepted", detail: { inviteId: row.id, userId: actor.id } }, { ...actor, workspaceId: row.workspace_id });
    return true;
  }

  async listMembers(actor: Actor): Promise<MembershipRecord[]> {
    requireCapability(actor, "workspace:manage");
    const rows = this.db.prepare(`
      SELECT m.user_id, u.email, m.workspace_id, m.role
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ? ORDER BY u.email
    `).all(actor.workspaceId) as { user_id: string; email: string; workspace_id: string; role: Actor["role"] }[];
    return rows.map((row) => ({ userId: row.user_id, email: row.email, workspaceId: row.workspace_id, role: row.role }));
  }

  async changeMemberRole(actor: Actor, userId: string, role: Actor["role"]): Promise<boolean> {
    requireCapability(actor, "workspace:manage");
    if (userId === actor.id && role !== "owner") return false;
    const current = this.db.prepare("SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?")
      .get(userId, actor.workspaceId) as { role: Actor["role"] } | undefined;
    if (!current) return false;
    if (current.role === "owner" && role !== "owner") {
      const owners = this.db.prepare("SELECT COUNT(*) AS total FROM memberships WHERE workspace_id = ? AND role = 'owner'")
        .get(actor.workspaceId) as { total: number };
      if (owners.total <= 1) return false;
    }
    const result = this.db.prepare(`
      UPDATE memberships SET role = ? WHERE user_id = ? AND workspace_id = ?
    `).run(role, userId, actor.workspaceId);
    if (result.changes) {
      this.recordEventSync({ kind: "member.role_changed", detail: { userId, role } }, actor);
    }
    return Boolean(result.changes);
  }

  async removeMember(actor: Actor, userId: string): Promise<boolean> {
    requireCapability(actor, "workspace:manage");
    if (userId === actor.id) return false;
    const target = this.db.prepare("SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?")
      .get(userId, actor.workspaceId) as { role: Actor["role"] } | undefined;
    if (!target) return false;
    if (target.role === "owner") {
      const owners = this.db.prepare("SELECT COUNT(*) AS total FROM memberships WHERE workspace_id = ? AND role = 'owner'")
        .get(actor.workspaceId) as { total: number };
      if (owners.total <= 1) return false;
    }
    const result = this.db.prepare("DELETE FROM memberships WHERE user_id = ? AND workspace_id = ?")
      .run(userId, actor.workspaceId);
    if (result.changes) {
      this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND workspace_id = ?")
        .run(userId, actor.workspaceId);
      this.recordEventSync({ kind: "member.removed", detail: { userId } }, actor);
    }
    return Boolean(result.changes);
  }

  async switchWorkspace(actor: Actor, workspaceId: string): Promise<Actor | null> {
    const row = this.db.prepare(`
      SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?
    `).get(actor.id, workspaceId) as { role: Actor["role"] } | undefined;
    return row ? { ...actor, workspaceId, role: row.role } : null;
  }

  async listWorkspaces(actor: Actor): Promise<WorkspaceRecord[]> {
    const rows = this.db.prepare(`
      SELECT w.id, w.name, m.role
      FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ? ORDER BY w.created_at
    `).all(actor.id) as { id: string; name: string; role: Actor["role"] }[];
    return rows;
  }

  private accountEmail(userId: string): string | null {
    const row = this.db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string } | undefined;
    return row?.email ?? null;
  }

  close(): void {
    this.db.close();
  }

  private runSearch(expression: string, limit: number, workspaceId: string): SearchRow[] {
    try {
      return this.db.prepare(`
        SELECT conversation_id,
               bm25(conversation_search, 8.0, 1.0, 2.0, 2.0) AS score,
               snippet(conversation_search, 2, '', '', '...', 18) AS snippet
        FROM conversation_search
        WHERE conversation_search MATCH ? AND workspace_id = ?
        ORDER BY score
        LIMIT ?
      `).all(expression, workspaceId, limit) as unknown as SearchRow[];
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

  private writeConversation(conversation: Conversation, actor: Actor): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        INSERT INTO conversations (id, workspace_id, title, summary, provider, source_json, participants_json, tags_json, lineage_json, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         WHERE conversations.workspace_id = excluded.workspace_id
      `).run(
        conversation.id,
        actor.workspaceId,
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

      this.db.prepare("DELETE FROM messages WHERE conversation_id = ? AND conversation_id IN (SELECT id FROM conversations WHERE workspace_id = ?)").run(conversation.id, actor.workspaceId);
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

      this.db.prepare("DELETE FROM conversation_search WHERE conversation_id = ? AND workspace_id = ?")
        .run(conversation.id, actor.workspaceId);
      this.indexConversation({
        id: conversation.id,
        workspace_id: actor.workspaceId,
        title: conversation.title,
        summary: conversation.summary ?? null,
        provider: conversation.source.provider,
        source_json: JSON.stringify(conversation.source),
        participants_json: JSON.stringify(conversation.participants),
        tags_json: JSON.stringify(conversation.tags),
        lineage_json: conversation.lineage ? JSON.stringify(conversation.lineage) : null,
        metadata_json: conversation.metadata ? JSON.stringify(conversation.metadata) : null,
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
      }, conversation.messages.map((message, index) => ({
        conversation_id: conversation.id,
        seq: index,
        id: message.id,
        role: message.role,
        content: message.content,
        author: message.author ?? null,
        created_at: message.createdAt,
        metadata_json: message.metadata ? JSON.stringify(message.metadata) : null,
      })));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private indexConversation(row: ConversationRow, messages: MessageRow[]): void {
    const participants = JSON.parse(row.participants_json) as string[];
    const tags = JSON.parse(row.tags_json) as string[];
    this.db.prepare(`
      INSERT INTO conversation_search (conversation_id, workspace_id, title, body, tags, participants)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.workspace_id,
      row.title,
      [row.summary ?? "", ...messages.map((message) => message.content)].join("\n"),
      tags.join(" "),
      participants.join(" "),
    );
  }

  private recordEventSync(event: Omit<AuditEvent, "id" | "at"> & { at?: string }, actor?: Actor): void {
    this.db.prepare(`
      INSERT INTO events (id, workspace_id, actor_id, at, kind, conversation_id, handoff_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      actor?.workspaceId ?? "default",
      actor?.id ?? null,
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
  workspace_id: string;
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
  redact: number;
}

interface EventRow {
  id: string;
  actor_id: string | null;
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

function requireCapability(actor: Actor, capability: Capability): void {
  if (!can(actor.role, capability)) throw new Error("Forbidden.");
  if (actor.scope === "read" && capability !== "conversation:read") throw new Error("Forbidden.");
  if (actor.scope === "write" && (capability === "workspace:manage" || capability === "token:manage")) {
    throw new Error("Forbidden.");
  }
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
