import { analyzeConversation, approxTokens } from "./analyze.js";
import { detectConflicts } from "./conflict.js";
import { aggregateSearch } from "../search.js";
import type { ConversationStore } from "../store/index.js";
import type { Connector, ContextItem, ContextPacket, Conversation } from "../types.js";

export interface PacketRequest {
  query?: string;
  conversationIds?: string[];
  budgetTokens?: number;
  maxConversations?: number;
  includeExternal?: boolean;
}

/**
 * The handoff problem is not "send the chat", it is "send the chat in a form the
 * next model can act on without re-reading 40,000 tokens". A packet is that form:
 * what was decided, what is still open, what to do next, and a bounded excerpt,
 * assembled to fit whatever context budget the caller has.
 */
export async function buildContextPacket(
  store: ConversationStore,
  connectors: Connector[],
  request: PacketRequest,
): Promise<ContextPacket> {
  const budgetTokens = Math.max(500, Math.min(request.budgetTokens ?? 4_000, 60_000));
  const maxConversations = Math.max(1, Math.min(request.maxConversations ?? 5, 20));

  const selected = await selectConversations(store, request, maxConversations);
  const external = request.includeExternal !== false && request.query
    ? await externalContext(connectors, request.query)
    : [];

  const conflicts = detectConflicts(selected.map((entry) => entry.conversation));

  const packetConversations: ContextPacket["conversations"] = [];
  let usedTokens = 0;
  const reserve = approxTokens(external.map((item) => `${item.title}${item.text}`).join(" "));
  const conversationBudget = Math.max(400, budgetTokens - reserve);

  for (const entry of selected) {
    const analysis = analyzeConversation(entry.conversation);
    const decisions = analysis.decisions.map((claim) => claim.text).slice(0, 6);
    const openQuestions = analysis.openQuestions.map((claim) => claim.text).slice(0, 6);
    const actionItems = analysis.actionItems.map((claim) => claim.text).slice(0, 6);
    const fixed = approxTokens([...decisions, ...openQuestions, ...actionItems].join(" ")) + 40;
    const remaining = conversationBudget - usedTokens - fixed;
    if (remaining <= 0) break;

    const excerpt = clipToTokens(transcriptTail(entry.conversation), Math.min(remaining, Math.floor(conversationBudget / selected.length) + 200));
    usedTokens += fixed + approxTokens(excerpt);

    packetConversations.push({
      id: entry.conversation.id,
      title: entry.conversation.title,
      provider: entry.conversation.source.provider,
      updatedAt: entry.conversation.updatedAt,
      relevance: entry.relevance,
      decisions,
      openQuestions,
      actionItems,
      excerpt,
    });
  }

  usedTokens += reserve;

  const packet: ContextPacket = {
    query: request.query,
    generatedAt: new Date().toISOString(),
    budgetTokens,
    usedTokens,
    conversations: packetConversations,
    external,
    conflicts,
    markdown: "",
  };
  packet.markdown = packetToMarkdown(packet);
  return packet;
}

export function packetToMarkdown(packet: ContextPacket): string {
  const lines: string[] = ["# LNKZ context packet", ""];
  if (packet.query) lines.push(`Query: ${packet.query}`);
  lines.push(`Generated: ${packet.generatedAt}`, `Budget: ${packet.usedTokens} of ${packet.budgetTokens} approx tokens`, "");

  if (!packet.conversations.length && !packet.external.length) {
    lines.push("No stored conversation or connected source matched.");
    return lines.join("\n");
  }

  for (const conversation of packet.conversations) {
    lines.push(`## ${conversation.title}`, "");
    lines.push(`Source: ${conversation.provider} · updated ${conversation.updatedAt} · id ${conversation.id}`, "");
    if (conversation.decisions.length) lines.push("Decisions:", ...bullets(conversation.decisions), "");
    if (conversation.openQuestions.length) lines.push("Open questions:", ...bullets(conversation.openQuestions), "");
    if (conversation.actionItems.length) lines.push("Action items:", ...bullets(conversation.actionItems), "");
    if (conversation.excerpt) lines.push("Recent exchange:", "", conversation.excerpt, "");
  }

  if (packet.external.length) {
    lines.push("## Connected sources", "");
    for (const item of packet.external) {
      lines.push(`- [${item.source}] ${item.title}${item.url ? ` (${item.url})` : ""}`);
      if (item.text) lines.push(`  ${clipToTokens(item.text, 120).replace(/\n+/g, " ")}`);
    }
    lines.push("");
  }

  if (packet.conflicts.length) {
    lines.push("## Possible conflicts", "");
    for (const conflict of packet.conflicts.slice(0, 5)) {
      lines.push(`- ${conflict.reason}`);
      lines.push(`  - ${conflict.left.title}: ${conflict.left.text}`);
      lines.push(`  - ${conflict.right.title}: ${conflict.right.text}`);
    }
    lines.push("");
  }

  lines.push(
    "## How to use this",
    "",
    "Treat decisions as settled unless a conflict is listed above. Ask about open questions before assuming an answer. Cite conversation ids when you refer back to a claim.",
  );
  return lines.join("\n").trim();
}

async function selectConversations(
  store: ConversationStore,
  request: PacketRequest,
  maxConversations: number,
): Promise<{ conversation: Conversation; relevance: number }[]> {
  const selected: { conversation: Conversation; relevance: number }[] = [];
  const seen = new Set<string>();

  for (const id of request.conversationIds ?? []) {
    const conversation = await store.get(id);
    if (conversation && !seen.has(conversation.id)) {
      seen.add(conversation.id);
      selected.push({ conversation, relevance: 1 });
    }
  }

  if (request.query && selected.length < maxConversations) {
    for (const match of await store.search(request.query, maxConversations)) {
      if (seen.has(match.id)) continue;
      const conversation = await store.get(match.id);
      if (!conversation) continue;
      seen.add(conversation.id);
      selected.push({ conversation, relevance: match.relevance });
      if (selected.length >= maxConversations) break;
    }
  }

  if (!selected.length && !request.query) {
    for (const summary of await store.list({ limit: maxConversations })) {
      const conversation = await store.get(summary.id);
      if (conversation) selected.push({ conversation, relevance: 0 });
    }
  }

  return selected.slice(0, maxConversations);
}

async function externalContext(connectors: Connector[], query: string): Promise<ContextItem[]> {
  try {
    const result = await aggregateSearch(connectors, { query, limit: 8, excludeSources: ["lnkz"] });
    return result.items;
  } catch {
    return [];
  }
}

/** The end of a chat carries the current state; the beginning rarely does. */
function transcriptTail(conversation: Conversation, maxMessages = 8): string {
  return conversation.messages
    .slice(-maxMessages)
    .map((message) => `${message.author || message.role}: ${message.content}`)
    .join("\n\n");
}

export function clipToTokens(text: string, tokenBudget: number): string {
  const characterBudget = Math.max(0, tokenBudget) * 4;
  if (text.length <= characterBudget) return text;
  return `${text.slice(0, Math.max(0, characterBudget - 3))}...`;
}

function bullets(values: string[]): string[] {
  return values.map((value) => `- ${value}`);
}
