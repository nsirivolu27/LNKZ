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

export interface Packet {
  query?: string;
  budgetTokens: number;
  usedTokens: number;
  markdown: string;
  conversations: { id: string; title: string }[];
  conflicts: { reason: string; left: { title: string; text: string }; right: { title: string; text: string } }[];
}

export interface IssuedHandoff {
  id: string;
  token: string;
  shareUrl: string;
  expiresAt: string;
  maxUses: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a complete server URL, such as https://lnkz.example.com.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The server URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Do not put credentials in the server URL.");
  }
  return trimmed;
}

function userMessage(status: number, payload: unknown): string {
  const serverMessage = payload && typeof payload === "object" && "error" in payload
    ? String((payload as { error?: unknown }).error ?? "")
    : "";
  if (status === 401) return "The API key was rejected. Check it and try again.";
  if (status === 403) return serverMessage || "This API key does not have permission for that action.";
  if (status === 404) return serverMessage || "The requested LNKZ item was not found.";
  if (status === 409) return serverMessage || "That change conflicts with the current server state.";
  if (status === 429) return "LNKZ is receiving too many requests. Wait a moment and retry.";
  if (status >= 500) return "The LNKZ server could not complete the request.";
  return serverMessage || `The request failed (${status}).`;
}

export class LnkzClient {
  readonly baseUrl: string;

  constructor(baseUrl: string, private readonly apiKey: string, private readonly timeoutMs = 10_000) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (this.apiKey.trim()) headers.set("authorization", `Bearer ${this.apiKey.trim()}`);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      let payload: unknown = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = {};
        }
      }
      if (!response.ok) throw new ApiError(userMessage(response.status, payload), response.status);
      return payload as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("The server took too long to respond.");
      }
      throw new Error("Could not reach the LNKZ server. Check the URL and your connection.");
    } finally {
      clearTimeout(timeout);
    }
  }

  stats() {
    return this.request<{ stats: Stats }>("/api/stats");
  }

  connectors() {
    return this.request<{ connectors: ConnectorStatus[] }>("/api/connectors");
  }

  listConversations(limit = 50) {
    return this.request<{ conversations: ConversationSummary[] }>(`/api/conversations?limit=${limit}`);
  }

  searchConversations(query: string) {
    return this.request<{ matches: ConversationMatch[] }>("/api/conversations/search", {
      method: "POST",
      body: JSON.stringify({ query, limit: 30 }),
    });
  }

  getConversation(id: string) {
    return this.request<{ conversation: Conversation; analysis: Analysis }>(`/api/conversations/${encodeURIComponent(id)}`);
  }

  importText(payload: string, format = "auto", tags: string[] = []) {
    return this.request<{ format: string; warnings: string[]; conversations: ConversationSummary[] }>(
      "/api/conversations/import",
      { method: "POST", body: JSON.stringify({ payload, format, tags, dryRun: false }) },
    );
  }

  buildPacket(conversationIds: string[], budgetTokens = 4_000) {
    return this.request<{ packet: Packet }>("/api/context/packet", {
      method: "POST",
      body: JSON.stringify({ conversationIds, budgetTokens, includeExternal: true }),
    });
  }

  createHandoff(
    conversationId: string,
    input: { ttlMinutes: number; maxUses: number; audience?: string; redact: boolean },
  ) {
    return this.request<IssuedHandoff>(`/api/conversations/${encodeURIComponent(conversationId)}/handoffs`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listHandoffs() {
    return this.request<{ handoffs: HandoffSummary[] }>("/api/handoffs");
  }

  revokeHandoff(id: string) {
    return this.request<void>(`/api/handoffs/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
