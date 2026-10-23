export type ConnectorId = "lnkz" | "slack" | "jira" | "figma" | "documents" | "fantasy";

export type MessageRole = "system" | "user" | "assistant" | "tool" | "other";

/** Providers LNKZ can normalize automatically. Any other string is still accepted. */
export type KnownProvider = "chatgpt" | "claude" | "gemini" | "copilot" | "grok" | "local" | "unknown";

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  author?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationSource {
  provider: string;
  app?: string;
  deviceId?: string;
  externalConversationId?: string;
  url?: string;
}

/**
 * Where this conversation came from when it was continued somewhere else.
 * A chat started in ChatGPT, handed off, and continued in Claude keeps the
 * chain so a reader can walk back to the original.
 */
export interface ConversationLineage {
  parentId?: string;
  rootId?: string;
  handoffId?: string;
  continuedBy?: string;
}

export interface Conversation {
  id: string;
  version: 1;
  title: string;
  summary?: string;
  source: ConversationSource;
  participants: string[];
  tags: string[];
  messages: ConversationMessage[];
  lineage?: ConversationLineage;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type MessageInput =
  & Partial<Pick<ConversationMessage, "id" | "author" | "createdAt" | "metadata">>
  & Pick<ConversationMessage, "role" | "content">;

export interface ConversationInput {
  id?: string;
  title: string;
  summary?: string;
  source: ConversationSource;
  participants?: string[];
  tags?: string[];
  messages: MessageInput[];
  lineage?: ConversationLineage;
  metadata?: Record<string, unknown>;
}

/** A stored conversation without its message bodies, for listings and search hits. */
export interface ConversationSummary {
  id: string;
  title: string;
  summary?: string;
  source: ConversationSource;
  participants: string[];
  tags: string[];
  messageCount: number;
  lineage?: ConversationLineage;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMatch extends ConversationSummary {
  /** Lower is a better BM25 match. Normalized to a 0-1 relevance for callers. */
  relevance: number;
  snippet: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  provider?: string;
  tag?: string;
  participant?: string;
}

export interface HandoffOptions {
  conversationId: string;
  ttlMinutes?: number;
  maxUses?: number;
  audience?: string;
  note?: string;
  redact?: boolean;
}

export interface HandoffRecord {
  id: string;
  conversationId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt?: string;
  audience?: string;
  note?: string;
  redact: boolean;
}

export type HandoffSummary = Omit<HandoffRecord, "tokenHash"> & { active: boolean };

export interface HandoffIssue {
  id: string;
  token: string;
  expiresAt: string;
  maxUses: number;
  audience?: string;
  redact: boolean;
}

export interface RedactionReport {
  applied: boolean;
  removed: { kind: string; count: number }[];
}

export interface HandoffPacket {
  format: "lnkz.conversation.v1";
  conversation: Conversation;
  transcriptMarkdown: string;
  analysis: ConversationAnalysis;
  redaction: RedactionReport;
  handoff: { id: string; usesRemaining: number | null; expiresAt: string; audience?: string };
  exportedAt: string;
}

/** Deterministic, model-free reading of what a conversation actually settled. */
export interface ConversationAnalysis {
  decisions: AnalysisClaim[];
  openQuestions: AnalysisClaim[];
  actionItems: AnalysisClaim[];
  facts: AnalysisClaim[];
  topics: string[];
  participants: string[];
  messageCount: number;
  approxTokens: number;
  span: { start?: string; end?: string };
}

export interface AnalysisClaim {
  text: string;
  messageId: string;
  author: string;
  createdAt: string;
}

export interface ContextPacket {
  query?: string;
  generatedAt: string;
  budgetTokens: number;
  usedTokens: number;
  conversations: {
    id: string;
    title: string;
    provider: string;
    updatedAt: string;
    relevance: number;
    decisions: string[];
    openQuestions: string[];
    actionItems: string[];
    excerpt: string;
  }[];
  external: ContextItem[];
  conflicts: ConflictPair[];
  markdown: string;
}

export interface ConflictPair {
  left: { conversationId: string; title: string; text: string };
  right: { conversationId: string; title: string; text: string };
  reason: string;
  similarity: number;
}

export interface DuplicatePair {
  left: { conversationId: string; title: string };
  right: { conversationId: string; title: string };
  similarity: number;
}

export interface AuditEvent {
  id: string;
  at: string;
  kind: string;
  conversationId?: string;
  handoffId?: string;
  detail?: Record<string, unknown>;
}

export interface StoreStats {
  conversations: number;
  messages: number;
  providers: { provider: string; count: number }[];
  activeHandoffs: number;
  events: number;
}

export interface ContextItem {
  source: ConnectorId;
  id: string;
  title: string;
  text: string;
  url?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorStatus {
  id: ConnectorId;
  label: string;
  configured: boolean;
  detail: string;
}

export interface Connector {
  id: ConnectorId;
  label: string;
  status(): ConnectorStatus;
  search(query: string, limit: number): Promise<ContextItem[]>;
}

export interface SearchRequest {
  query: string;
  limit?: number;
  sources?: ConnectorId[];
  excludeSources?: ConnectorId[];
}

export interface SearchResponse {
  items: ContextItem[];
  errors: { source: ConnectorId; message: string }[];
  searchedSources: ConnectorId[];
}
