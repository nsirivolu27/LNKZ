import { asArray, asRecord, asString, buildConversation, flattenContent, normalizeDate, normalizeRole } from "./shared.js";
import type { ConversationInput, MessageInput } from "../types.js";

interface MappingNode {
  id: string;
  parent?: string | null;
  message?: Record<string, unknown> | null;
}

export function looksLikeChatGpt(value: unknown): boolean {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.some((entry) => {
    const record = asRecord(entry);
    return Boolean(record && asRecord(record.mapping) && ("current_node" in record || "create_time" in record));
  });
}

/**
 * ChatGPT stores a conversation as a message tree, not a list, because edits
 * branch it. The export keeps every branch, so importing the whole mapping would
 * interleave abandoned drafts with the real chat. LNKZ walks back from
 * current_node to the root, which reconstructs exactly the thread the user saw.
 */
export function importChatGpt(value: unknown): { conversations: ConversationInput[]; warnings: string[] } {
  const entries = Array.isArray(value) ? value : [value];
  const conversations: ConversationInput[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    const mapping = record ? asRecord(record.mapping) : null;
    if (!record || !mapping) continue;

    const nodes = new Map<string, MappingNode>();
    for (const [id, raw] of Object.entries(mapping)) {
      const node = asRecord(raw);
      if (!node) continue;
      nodes.set(id, {
        id,
        parent: typeof node.parent === "string" ? node.parent : null,
        message: asRecord(node.message),
      });
    }

    const leaf = asString(record.current_node) || findDeepestLeaf(nodes);
    const branch = walkToRoot(nodes, leaf);
    if (!branch.length) {
      warnings.push(`Skipped "${asString(record.title) || "untitled"}": no reachable message branch.`);
      continue;
    }

    const messages: MessageInput[] = [];
    for (const node of branch) {
      const message = node.message;
      if (!message) continue;
      const metadata = asRecord(message.metadata) ?? {};
      if (metadata.is_visually_hidden_from_conversation === true) continue;
      const content = flattenContent(asRecord(message.content)?.parts ?? message.content);
      if (!content.trim()) continue;
      const role = normalizeRole(asRecord(message.author)?.role);
      if (role === "system" && !content.trim()) continue;
      messages.push({
        id: asString(message.id) || node.id,
        role,
        content,
        createdAt: normalizeDate(message.create_time),
        metadata: metadata.model_slug ? { model: metadata.model_slug } : undefined,
      });
    }

    const conversation = buildConversation({
      title: asString(record.title) || "ChatGPT conversation",
      provider: "chatgpt",
      app: "chatgpt-export",
      externalId: asString(record.conversation_id) || asString(record.id) || undefined,
      messages,
      tags: ["imported", "chatgpt"],
      metadata: { createdAt: normalizeDate(record.create_time), branchLength: branch.length },
    });
    if (conversation) conversations.push(conversation);
    else warnings.push(`Skipped "${asString(record.title) || "untitled"}": every message was empty.`);
  }

  return { conversations, warnings };
}

function walkToRoot(nodes: Map<string, MappingNode>, leafId: string): MappingNode[] {
  const branch: MappingNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = leafId;
  while (cursor && nodes.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const node: MappingNode = nodes.get(cursor)!;
    branch.push(node);
    cursor = node.parent ?? null;
  }
  return branch.reverse();
}

/** Exports occasionally lack current_node; the longest chain is the best guess. */
function findDeepestLeaf(nodes: Map<string, MappingNode>): string {
  const childCount = new Map<string, number>();
  for (const node of nodes.values()) {
    if (node.parent) childCount.set(node.parent, (childCount.get(node.parent) ?? 0) + 1);
  }
  let best = "";
  let bestDepth = -1;
  for (const node of nodes.values()) {
    if (childCount.has(node.id)) continue;
    const depth = walkToRoot(nodes, node.id).length;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = node.id;
    }
  }
  return best;
}
