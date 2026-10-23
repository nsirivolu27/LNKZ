import { asArray, asRecord, asString, buildConversation, flattenContent, normalizeDate, normalizeRole } from "./shared.js";
import type { ConversationInput, MessageInput } from "../types.js";

export function looksLikeLnkz(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  if (asString(record.format) === "lnkz.conversation.v1") return true;
  const conversation = asRecord(record.conversation);
  if (conversation && Array.isArray(conversation.messages) && asRecord(conversation.source)) return true;
  return Boolean(Array.isArray(record.messages) && asRecord(record.source) && record.version === 1);
}

/** Re-importing a LNKZ packet is how a handoff becomes a conversation elsewhere. */
export function importLnkz(value: unknown): { conversations: ConversationInput[]; warnings: string[] } {
  const record = asRecord(value);
  const source = record ? (asRecord(record.conversation) ?? record) : null;
  if (!source) return { conversations: [], warnings: [] };

  const messages: MessageInput[] = [];
  for (const raw of asArray(source.messages)) {
    const message = asRecord(raw);
    if (!message) continue;
    const content = asString(message.content).trim() || flattenContent(message.content);
    if (!content.trim()) continue;
    messages.push({
      id: asString(message.id) || undefined,
      role: normalizeRole(message.role),
      content,
      author: asString(message.author) || undefined,
      createdAt: normalizeDate(message.createdAt),
    });
  }

  const origin = asRecord(source.source);
  const conversation = buildConversation({
    title: asString(source.title) || "LNKZ conversation",
    provider: asString(origin?.provider) || "lnkz",
    app: asString(origin?.app) || undefined,
    externalId: asString(source.id) || undefined,
    url: asString(origin?.url) || undefined,
    messages,
    participants: asArray(source.participants).map(asString).filter(Boolean),
    tags: [...asArray(source.tags).map(asString).filter(Boolean), "imported"],
    metadata: { relayedFrom: asString(source.id) || undefined },
  });

  return { conversations: conversation ? [conversation] : [], warnings: [] };
}
