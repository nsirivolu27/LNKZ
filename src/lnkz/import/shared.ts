import type { ConversationInput, MessageInput, MessageRole } from "../types.js";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Vendors disagree about role names. Everything collapses to the LNKZ five. */
export function normalizeRole(value: unknown): MessageRole {
  const role = asString(value).toLowerCase();
  if (role === "user" || role === "human" || role === "prompt") return "user";
  if (role === "assistant" || role === "model" || role === "ai" || role === "bot") return "assistant";
  if (role === "system" || role === "developer") return "system";
  if (role === "tool" || role === "function" || role === "tool_result") return "tool";
  return "other";
}

/** Timestamps arrive as ISO strings, epoch seconds, or epoch milliseconds. */
export function normalizeDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e12 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

/**
 * Content is a string in some exports and a list of typed parts in others.
 * Text parts are joined; anything else is described so the reader knows a
 * non-text block was there rather than silently losing it.
 */
export function flattenContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenContent).filter(Boolean).join("\n").trim();
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.parts)) return flattenContent(record.parts);
  if (Array.isArray(record.content)) return flattenContent(record.content);
  if (typeof record.type === "string") {
    if (record.type === "image" || record.type === "image_url") return "[image]";
    if (record.type === "tool_use") return `[tool call: ${asString(record.name) || "unnamed"}]`;
    if (record.type === "tool_result") return `[tool result]${flattenContent(record.content) ? `\n${flattenContent(record.content)}` : ""}`;
  }
  return "";
}

export function buildConversation(options: {
  title: string;
  provider: string;
  app?: string;
  externalId?: string;
  url?: string;
  createdAt?: string;
  messages: MessageInput[];
  tags?: string[];
  participants?: string[];
  metadata?: Record<string, unknown>;
}): ConversationInput | null {
  const messages = options.messages.filter((message) => message.content.trim().length > 0);
  if (!messages.length) return null;
  return {
    title: options.title.trim().slice(0, 240) || "Untitled conversation",
    source: {
      provider: options.provider,
      app: options.app,
      externalConversationId: options.externalId,
      url: options.url,
    },
    participants: options.participants ?? [],
    tags: options.tags ?? [],
    messages,
    metadata: { importedAt: new Date().toISOString(), ...options.metadata },
  };
}

/**
 * Anything before the first attributed speaker is document furniture, not a turn.
 * A transcript usually opens with a title, and LNKZ's own exports add a source
 * line, a timestamp, participants, tags and a summary on top of that. A reader
 * that takes all of it literally hands back the conversation plus its own header,
 * which is how a document grows every time it is exported and imported again.
 *
 * The rule only applies when the document has at least one attributed speaker.
 * With none, the text is unattributed prose and its opening is the content.
 */
export function dropPreamble<T extends { attributed: boolean }>(messages: T[]): T[] {
  const first = messages.findIndex((message) => message.attributed);
  return first <= 0 ? messages : messages.slice(first);
}

/** A first line makes a better title than "Untitled" and costs nothing. */
export function titleFromMessages(messages: MessageInput[], fallback: string): string {
  const first = messages.find((message) => message.role === "user") ?? messages[0];
  if (!first) return fallback;
  const line = first.content.split("\n").map((value) => value.trim()).find(Boolean) ?? fallback;
  return line.replace(/^#+\s*/, "").slice(0, 120) || fallback;
}
