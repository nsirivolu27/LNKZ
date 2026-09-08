import { redactSensitiveText } from '@/services/redaction';

export type ImportFormat =
  | 'auto'
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'openai'
  | 'lnkz'
  | 'generic'
  | 'markdown'
  | 'text';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'other';

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  author?: string;
  createdAt: string;
}

export interface ConversationSource {
  provider: string;
  app?: string;
  deviceId?: string;
  externalConversationId?: string;
  url?: string;
}

export interface ConversationLineage {
  parentId?: string;
  rootId?: string;
  handoffId?: string;
  continuedBy?: string;
  originInstance?: string;
  originInstanceName?: string;
  originVerification?: 'verified' | 'unverified';
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
}

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
  relevance: number;
  snippet: string;
}

export interface AnalysisClaim {
  text: string;
  messageId: string;
  author: string;
  createdAt: string;
}

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

export interface HandoffSummary {
  id: string;
  conversationId: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt?: string;
  audience?: string;
  note?: string;
  redact: boolean;
  active: boolean;
}

export interface HandoffIssue {
  id: string;
  token: string;
  expiresAt: string;
  maxUses: number;
  audience?: string;
  redact: boolean;
  shareUrl: string;
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
  external: unknown[];
  conflicts: unknown[];
  markdown: string;
}

export interface DryRunPreview {
  format?: string;
  warnings: string[];
  preview: {
    title: string;
    provider: string;
    messages: number;
  }[];
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  connectors?: { id: string; configured: boolean }[];
}

export interface StoreStats {
  conversations: number;
  messages: number;
  providers: { provider: string; count: number }[];
  activeHandoffs: number;
  events: number;
}

export interface ConnectorStatus {
  id: string;
  label: string;
  configured: boolean;
  detail: string;
}

export interface ConversationResponse {
  conversation: Conversation;
  analysis?: ConversationAnalysis;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

export function buildConversationQuery(options: {
  provider?: string;
  tag?: string;
  participant?: string;
}): string {
  const params = new URLSearchParams({ limit: '100' });
  Object.entries(options).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

export class LnkzApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: { serverUrl: string; apiKey: string; timeoutMs?: number }) {
    this.baseUrl = normalizeBaseUrl(config.serverUrl);
    this.apiKey = config.apiKey.trim();
    this.timeoutMs = config.timeoutMs ?? 12_000;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    if (!this.baseUrl) throw new ApiError('Enter a relay URL first.', 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    headers.set('authorization', `Bearer ${this.apiKey}`);
    if (options.body) headers.set('content-type', 'application/json');

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: options.signal ?? controller.signal,
      });
      const text = await response.text();
      let body: unknown = undefined;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!response.ok) {
        const message =
          typeof body === 'object' && body && 'error' in body && typeof body.error === 'string'
            ? body.error
            : `Request failed with status ${response.status}.`;
        throw new ApiError(redactSensitiveText(message), response.status, response.status >= 500);
      }
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('The relay took too long to respond.', 408, true);
      }
      throw new ApiError(
        error instanceof Error ? redactSensitiveText(error.message) : 'Unable to reach the relay.',
        0,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  stats() {
    return this.request<{ stats: StoreStats }>('/api/stats');
  }

  connectors() {
    return this.request<{ connectors: ConnectorStatus[] }>('/api/connectors');
  }

  listConversations(options: { provider?: string; tag?: string; participant?: string } = {}) {
    return this.request<{ conversations: ConversationSummary[] }>(
      `/api/conversations?${buildConversationQuery(options)}`,
    );
  }

  searchConversations(query: string) {
    return this.request<{ matches: ConversationMatch[] }>('/api/conversations/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit: 50 }),
    });
  }

  getConversation(id: string) {
    return this.request<ConversationResponse>(`/api/conversations/${encodeURIComponent(id)}`);
  }

  importPayload(payload: string, format: ImportFormat, dryRun: boolean) {
    return this.request<DryRunPreview | { format: string; warnings: string[]; conversations: Conversation[] }>(
      '/api/conversations/import',
      { method: 'POST', body: JSON.stringify({ payload, format, dryRun }) },
    );
  }

  importUrl(url: string, dryRun: boolean) {
    return this.request<
      | { origin: { url: string; name?: string; verification?: string }; warnings: string[]; preview: DryRunPreview['preview'][number] }
      | { conversation: Conversation; origin: { url: string; name?: string; verification?: string }; warnings: string[] }
    >('/api/conversations/import-url', {
      method: 'POST',
      body: JSON.stringify({ url, dryRun }),
    });
  }

  buildPacket(input: { query?: string; conversationIds?: string[]; budgetTokens: number }) {
    return this.request<{ packet: ContextPacket }>('/api/context/packet', {
      method: 'POST',
      body: JSON.stringify({ ...input, includeExternal: true, maxConversations: 8 }),
    });
  }

  listHandoffs(conversationId?: string) {
    const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
    return this.request<{ handoffs: HandoffSummary[] }>(`/api/handoffs${query}`);
  }

  createHandoff(
    conversationId: string,
    options: { ttlMinutes: number; maxUses: number; audience?: string; note?: string; redact: boolean },
  ) {
    return this.request<HandoffIssue>(`/api/conversations/${encodeURIComponent(conversationId)}/handoffs`, {
      method: 'POST',
      body: JSON.stringify({ conversationId, ...options }),
    });
  }

  revokeHandoff(id: string) {
    return this.request<void>(`/api/handoffs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}