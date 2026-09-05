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
import type {
  AccountRecord,
  Actor,
  ApiTokenIssue,
  ApiTokenSummary,
  InviteIssue,
  MembershipRecord,
  SessionRecord,
  TokenScope,
  WorkspaceRecord,
} from "../types.js";

/**
 * Every transport in LNKZ talks to this interface, never to a concrete database.
 * The MVP ships a SQLite implementation; a Postgres one can replace it without
 * the MCP server, the REST API, or the web client noticing.
 */
export interface ConversationStore {
  save(input: ConversationInput, actor: Actor): Promise<Conversation>;
  get(id: string, actor: Actor): Promise<Conversation | null>;
  list(options: ListOptions, actor: Actor): Promise<ConversationSummary[]>;
  remove(id: string, actor: Actor): Promise<boolean>;
  appendMessages(id: string, messages: MessageInput[], actor: Actor): Promise<Conversation | null>;
  search(query: string, limit: number, actor: Actor): Promise<ConversationMatch[]>;
  createHandoff(options: HandoffOptions, actor: Actor): Promise<HandoffIssue>;
  redeemHandoff(token: string, actor: Actor): Promise<HandoffPacket | null>;
  revokeHandoff(handoffId: string, actor: Actor): Promise<boolean>;
  listHandoffs(conversationId: string | undefined, actor: Actor): Promise<HandoffSummary[]>;
  recordEvent(event: Omit<AuditEvent, "id" | "at"> & { at?: string }, actor: Actor): Promise<void>;
  listEvents(limit: number, actor: Actor): Promise<AuditEvent[]>;
  stats(actor: Actor): Promise<StoreStats>;
  createAccount(email: string, passwordHash: string): Promise<AccountRecord>;
  findAccount(email: string): Promise<AccountRecord | null>;
  findAccountById(id: string): Promise<AccountRecord | null>;
  loginBlocked(email: string): Promise<boolean>;
  recordLoginAttempt(email: string, success: boolean): Promise<void>;
  createSession(account: AccountRecord, tokenHash: string, expiresAt: string, idleExpiresAt: string): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  findApiToken(tokenHash: string): Promise<{ actor: Actor; scope: TokenScope } | null>;
  createApiToken(actor: Actor, scope: TokenScope, expiresAt?: string): Promise<ApiTokenIssue>;
  listApiTokens(actor: Actor): Promise<ApiTokenSummary[]>;
  revokeApiToken(actor: Actor, tokenId: string): Promise<boolean>;
  createInvite(actor: Actor, email: string, role: Actor["role"], expiresAt: string): Promise<InviteIssue>;
  acceptInvite(token: string, actor: Actor): Promise<boolean>;
  listMembers(actor: Actor): Promise<MembershipRecord[]>;
  changeMemberRole(actor: Actor, userId: string, role: Actor["role"]): Promise<boolean>;
  removeMember(actor: Actor, userId: string): Promise<boolean>;
  switchWorkspace(actor: Actor, workspaceId: string): Promise<Actor | null>;
  listWorkspaces(actor: Actor): Promise<WorkspaceRecord[]>;
  close(): void;
}

export { SqliteConversationStore } from "./sqlite.js";
export { conversationToMarkdown, conversationToMarkdownWithAnalysis } from "./markdown.js";
