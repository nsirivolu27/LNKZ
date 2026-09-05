import { BRAND } from "./branding";

export interface ApiError extends Error {
  status: number;
}

const KEY_STORAGE = BRAND.apiKeyStorageKey;

export function getApiKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(value: string): void {
  try {
    if (value) sessionStorage.setItem(KEY_STORAGE, value);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Some private-mode browsers refuse storage; the key still works in memory.
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const key = getApiKey();
  if (key) headers.set("authorization", `Bearer ${key}`);

  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? safeJson(text) : {};
  if (!response.ok) {
    const message = (payload as { error?: string }).error
      ?? (response.status === 401 ? `Unauthorized. Set your ${BRAND.apiKeyLabel.toLowerCase()} above.` : `Request failed with ${response.status}.`);
    const error = new Error(message) as ApiError;
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 400) };
  }
}

export interface ConversationSummary {
  id: string;
  title: string;
  summary?: string;
  source: { provider: string; app?: string; url?: string };
  participants: string[];
  tags: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation extends ConversationSummary {
  messages: { id: string; role: string; content: string; author?: string; createdAt: string }[];
}

export interface Analysis {
  decisions: { text: string }[];
  openQuestions: { text: string }[];
  actionItems: { text: string }[];
  topics: string[];
  messageCount: number;
  approxTokens: number;
}

export interface HandoffSummary {
  id: string;
  conversationId: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt?: string;
  audience?: string;
  redact: boolean;
  active: boolean;
}

export interface ConnectorStatus {
  id: string;
  label: string;
  configured: boolean;
  detail: string;
}

export interface Stats {
  conversations: number;
  messages: number;
  providers: { provider: string; count: number }[];
  activeHandoffs: number;
  events: number;
}

export interface WorkspaceMembership {
  workspaceId: string;
  issuer: string;
  subject: string;
  actorId: string;
  scopes: ("mcp" | "read" | "write" | "admin")[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipAuditEvent {
  id: string;
  at: string;
  kind: "workspace_membership.created" | "workspace_membership.updated" | "workspace_membership.deactivated";
  actorId?: string;
  detail?: {
    membership: {
      issuer: string;
      subject: string;
      actorId: string;
      scopes: WorkspaceMembership["scopes"];
      active: boolean;
    };
    previous?: {
      issuer: string;
      subject: string;
      actorId: string;
      scopes: WorkspaceMembership["scopes"];
      active: boolean;
    };
  };
}

export interface Packet {
  budgetTokens: number;
  usedTokens: number;
  markdown: string;
  conversations: { id: string; title: string }[];
  conflicts: { reason: string; left: { title: string; text: string }; right: { title: string; text: string } }[];
}

export const client = {
  listConversations: (params: Record<string, string> = {}) =>
    api<{ conversations: ConversationSummary[] }>(`/api/conversations?${new URLSearchParams(params)}`),
  searchConversations: (query: string) =>
    api<{ matches: ConversationSummary[] }>("/api/conversations/search", {
      method: "POST",
      body: JSON.stringify({ query, limit: 20 }),
    }),
  getConversation: (id: string) =>
    api<{ conversation: Conversation; analysis: Analysis }>(`/api/conversations/${id}`),
  deleteConversation: (id: string) => api<void>(`/api/conversations/${id}`, { method: "DELETE" }),
  importPayload: (body: Record<string, unknown>) =>
    api<{ format: string; warnings: string[]; conversations?: ConversationSummary[]; preview?: unknown[] }>(
      "/api/conversations/import",
      { method: "POST", body: JSON.stringify(body) },
    ),
  createHandoff: (id: string, body: Record<string, unknown>) =>
    api<{ id: string; token: string; shareUrl: string; expiresAt: string; maxUses: number }>(
      `/api/conversations/${id}/handoffs`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  listHandoffs: () => api<{ handoffs: HandoffSummary[] }>("/api/handoffs"),
  revokeHandoff: (id: string) => api<void>(`/api/handoffs/${id}`, { method: "DELETE" }),
  buildPacket: (body: Record<string, unknown>) =>
    api<{ packet: Packet }>("/api/context/packet", { method: "POST", body: JSON.stringify(body) }),
  connectors: () => api<{ connectors: ConnectorStatus[] }>("/api/connectors"),
  stats: () => api<{ stats: Stats }>("/api/stats"),
  listMemberships: (includeInactive = false) =>
    api<{ memberships: WorkspaceMembership[] }>(`/api/admin/memberships?includeInactive=${includeInactive}`),
  listMembershipEvents: (limit = 50) =>
    api<{ events: MembershipAuditEvent[] }>(`/api/admin/membership-events?limit=${limit}`),
  addMembership: (body: { issuer: string; subject: string; scopes: WorkspaceMembership["scopes"] }) =>
    api<{ membership: WorkspaceMembership }>("/api/admin/memberships", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMembership: (body: {
    issuer: string;
    subject: string;
    scopes?: WorkspaceMembership["scopes"];
    active?: boolean;
  }) =>
    api<{ membership: WorkspaceMembership }>("/api/admin/memberships", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};