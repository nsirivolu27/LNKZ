import { asArray, asRecord, asString, buildConversation, flattenContent, normalizeDate, normalizeRole, titleFromMessages } from "./shared.js";
import type { ConversationInput, MessageInput } from "../types.js";

export function looksLikeGemini(value: unknown): boolean {
  const record = asRecord(value);
  if (record && Array.isArray(record.contents)) return true;
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.some((entry) => {
    const item = asRecord(entry);
    if (!item) return false;
    if (Array.isArray(item.turns)) return true;
    return Boolean(Array.isArray(item.parts) && typeof item.role === "string");
  });
}

/**
 * Two shapes are common for Gemini: the API request body (`contents` with
 * `role` and `parts`) and takeout-style records that group `turns`. Both reduce
 * to the same normalized message list.
 */
export function importGemini(value: unknown): { conversations: ConversationInput[]; warnings: string[] } {
  const warnings: string[] = [];
  const conversations: ConversationInput[] = [];

  const record = asRecord(value);
  if (record && Array.isArray(record.contents)) {
    const messages = toMessages(record.contents);
    const conversation = buildConversation({
      title: asString(record.title) || titleFromMessages(messages, "Gemini conversation"),
      provider: "gemini",
      app: "gemini-api",
      messages,
      tags: ["imported", "gemini"],
    });
    if (conversation) conversations.push(conversation);
    return { conversations, warnings };
  }

  for (const entry of Array.isArray(value) ? value : [value]) {
    const item = asRecord(entry);
    if (!item) continue;
    const turns = Array.isArray(item.turns) ? item.turns : Array.isArray(item.contents) ? item.contents : null;
    if (!turns) continue;
    const messages = toMessages(turns);
    const conversation = buildConversation({
      title: asString(item.title) || asString(item.name) || titleFromMessages(messages, "Gemini conversation"),
      provider: "gemini",
      app: "gemini-export",
      externalId: asString(item.conversation_id) || asString(item.id) || undefined,
      messages,
      tags: ["imported", "gemini"],
      metadata: { createdAt: normalizeDate(item.create_time ?? item.created_at) },
    });
    if (conversation) conversations.push(conversation);
    else warnings.push("Skipped a Gemini record with no readable turns.");
  }

  return { conversations, warnings };
}

function toMessages(turns: unknown): MessageInput[] {
  const messages: MessageInput[] = [];
  for (const raw of asArray(turns)) {
    const turn = asRecord(raw);
    if (!turn) continue;
    const content = flattenContent(turn.parts ?? turn.text ?? turn.content);
    if (!content.trim()) continue;
    messages.push({
      role: normalizeRole(turn.role ?? turn.author),
      content,
      createdAt: normalizeDate(turn.create_time ?? turn.created_at ?? turn.timestamp),
    });
  }
  return messages;
}
