import { asArray, asRecord, asString, buildConversation, flattenContent, normalizeDate, normalizeRole } from "./shared.js";
import type { ConversationInput, MessageInput } from "../types.js";

export function looksLikeClaude(value: unknown): boolean {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.some((entry) => {
    const record = asRecord(entry);
    return Boolean(record && Array.isArray(record.chat_messages));
  });
}

/**
 * Claude's account export is a flat list per conversation, with the message body
 * in either `text` or a typed `content` array depending on export vintage.
 */
export function importClaude(value: unknown): { conversations: ConversationInput[]; warnings: string[] } {
  const entries = Array.isArray(value) ? value : [value];
  const conversations: ConversationInput[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record || !Array.isArray(record.chat_messages)) continue;

    const messages: MessageInput[] = [];
    for (const raw of asArray(record.chat_messages)) {
      const message = asRecord(raw);
      if (!message) continue;
      const content = asString(message.text).trim() || flattenContent(message.content);
      if (!content.trim()) continue;
      messages.push({
        id: asString(message.uuid) || undefined,
        role: normalizeRole(message.sender ?? message.role),
        content,
        createdAt: normalizeDate(message.created_at),
      });
    }

    const conversation = buildConversation({
      title: asString(record.name) || asString(record.title) || "Claude conversation",
      provider: "claude",
      app: "claude-export",
      externalId: asString(record.uuid) || undefined,
      messages,
      tags: ["imported", "claude"],
      metadata: { createdAt: normalizeDate(record.created_at) },
    });
    if (conversation) conversations.push(conversation);
    else warnings.push(`Skipped "${asString(record.name) || "untitled"}": every message was empty.`);
  }

  return { conversations, warnings };
}
