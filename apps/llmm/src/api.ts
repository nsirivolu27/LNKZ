/**
 * The console talks to the same REST surface any other client would. There is no
 * private browser-only endpoint, which is the point: the web app is one client
 * among several, not the product.
 */

export interface ApiError extends Error {
  status: number;
}

const KEY_STORAGE = "lnkz.apiKey";

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
    // Private-mode browsers refuse storage; the key still works for this page.
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const key = getApiKey();
  if (key) headers.set("authorization", `Bearer ${key}`);

  const response = await fetch(path, { ...init, headers });
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? safeJson(text) : {};
  if (!response.ok) {
    const message = (payload as { error?: string }).error
      ?? (response.status === 401 ? "Unauthorized. Set your API key above." : `Request failed with ${response.status}.`);
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
  lineage?: { parentId?: string };
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMatch extends ConversationSummary {
  relevance: number;
  snippet: string;
}

export interface Analysis {
  decisions: { text: string }[];
  openQuestions: { text: string }[];
  actionItems: { text: string }[];
  topics: string[];
  messageCount: number;
  approxTokens: number;
}

export interface Conversation extends ConversationSummary {
  messages: { id: string; role: string; content: string; author?: string; createdAt: string }[];
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

export interface AuditEvent {
  id: string;
  at: string;
  kind: string;
  conversationId?: string;
  handoffId?: string;
}

export interface Packet {
  query?: string;
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
    api<{ matches: ConversationMatch[] }>("/api/conversations/search", {
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
  events: () => api<{ events: AuditEvent[] }>("/api/events?limit=40"),
};
