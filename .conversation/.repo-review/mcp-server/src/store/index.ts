import type {
  AuditEvent,
  Conversation,
  ConversationInput,
  ConversationMatch,
  ConversationSummary,
  HandoffIssue,
  HandoffOptions,
  HandoffPacket,
  HandoffSummary,
  ListOptions,
  MessageInput,
  StoreStats,
} from "../types.js";

/**
 * Every transport in LNKZ talks to this interface, never to a concrete database.
 * The MVP ships a SQLite implementation; a Postgres one can replace it without
 * the MCP server, the REST API, or the web client noticing.
 */
export interface ConversationStore {
  save(input: ConversationInput): Promise<Conversation>;
  get(id: string): Promise<Conversation | null>;
  list(options?: ListOptions): Promise<ConversationSummary[]>;
  remove(id: string): Promise<boolean>;
  appendMessages(id: string, messages: MessageInput[]): Promise<Conversation | null>;
  search(query: string, limit: number): Promise<ConversationMatch[]>;
  createHandoff(options: HandoffOptions): Promise<HandoffIssue>;
  redeemHandoff(token: string): Promise<HandoffPacket | null>;
  revokeHandoff(handoffId: string): Promise<boolean>;
  listHandoffs(conversationId?: string): Promise<HandoffSummary[]>;
  recordEvent(event: Omit<AuditEvent, "id" | "at"> & { at?: string }): Promise<void>;
  listEvents(limit: number): Promise<AuditEvent[]>;
  stats(): Promise<StoreStats>;
  close(): void;
}

export { SqliteConversationStore } from "./sqlite.js";
export { conversationToMarkdown, conversationToMarkdownWithAnalysis } from "./markdown.js";
