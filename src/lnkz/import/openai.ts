import { asArray, asRecord, asString, buildConversation, flattenContent, normalizeDate, normalizeRole, titleFromMessages } from "./shared.js";
import type { ConversationInput, MessageInput } from "../types.js";

/**
 * The chat-completions message array. This is not just the OpenAI API: it is the
 * de facto interchange shape, so LangChain traces, agent frameworks, prompt
 * playgrounds, evaluation harnesses, and a great many homegrown apps store their
 * conversations in it. Supporting it covers far more ground than its name suggests.
 *
 * Accepted:
 *   { "messages": [...] }                       a single request or a saved thread
 *   { "model": "...", "messages": [...] }       a captured request body
 *   [ { "messages": [...] }, ... ]              a batch, one conversation each
 *   [ { "role": "user", "content": "..." } ]    a bare message array
 *   JSONL, one object per line                  how batch and eval files are written
 */
export function looksLikeOpenAi(value: unknown): boolean {
  const record = asRecord(value);
  if (record && Array.isArray(record.messages) && record.messages.some(isMessageLike)) return true;
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isMessageLike)) return true;
    return value.some((entry) => {
      const item = asRecord(entry);
      return Boolean(item && Array.isArray(item.messages) && item.messages.some(isMessageLike));
    });
  }
  return false;
}

export function importOpenAi(value: unknown): { conversations: ConversationInput[]; warnings: string[] } {
  const conversations: ConversationInput[] = [];
  const warnings: string[] = [];

  for (const thread of threadsIn(value)) {
    const messages = toMessages(thread.messages);
    const conversation = buildConversation({
      title: thread.title || titleFromMessages(messages, "OpenAI conversation"),
      provider: "openai",
      app: thread.model ? `chat-completions/${thread.model}` : "chat-completions",
      externalId: thread.id,
      messages,
      tags: ["imported", "openai"],
      metadata: thread.model ? { model: thread.model } : undefined,
    });
    if (conversation) conversations.push(conversation);
    else warnings.push("Skipped a message array with no readable content.");
  }

  return { conversations, warnings };
}

interface Thread {
  messages: unknown[];
  title?: string;
  model?: string;
  id?: string;
}

function threadsIn(value: unknown): Thread[] {
  const record = asRecord(value);
  if (record && Array.isArray(record.messages)) return [threadFrom(record)];

  if (Array.isArray(value)) {
    // A bare message array is one conversation, not many empty ones.
    if (value.length > 0 && value.every(isMessageLike)) return [{ messages: value }];
    const threads: Thread[] = [];
    for (const entry of value) {
      const item = asRecord(entry);
      if (item && Array.isArray(item.messages)) threads.push(threadFrom(item));
    }
    return threads;
  }

  return [];
}

function threadFrom(record: Record<string, unknown>): Thread {
  return {
    messages: asArray(record.messages),
    title: asString(record.title) || asString(record.name) || undefined,
    model: asString(record.model) || undefined,
    id: asString(record.id) || asString(record.conversation_id) || undefined,
  };
}

function toMessages(raw: unknown[]): MessageInput[] {
  const messages: MessageInput[] = [];
  for (const entry of raw) {
    const message = asRecord(entry);
    if (!message) continue;

    // Assistant turns that only carry tool calls have null content. Keeping a
    // marker preserves the shape of the exchange without inventing text.
    const toolCalls = asArray(message.tool_calls)
      .map((call) => asString(asRecord(call)?.function ? asRecord(asRecord(call)!.function)?.name : undefined))
      .filter(Boolean);
    const content = flattenContent(message.content)
      || (toolCalls.length ? `[tool call: ${toolCalls.join(", ")}]` : "");
    if (!content.trim()) continue;

    messages.push({
      role: normalizeRole(message.role),
      content,
      author: asString(message.name) || undefined,
      createdAt: normalizeDate(message.created_at ?? message.timestamp ?? message.created),
    });
  }
  return messages;
}

function isMessageLike(value: unknown): boolean {
  const record = asRecord(value);
  if (!record || typeof record.role !== "string") return false;
  return "content" in record || "tool_calls" in record;
}
