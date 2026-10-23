import { analyzeConversation } from "../intel/analyze.js";
import { conversationToMarkdown, conversationToMarkdownWithAnalysis } from "../store/markdown.js";
import { toLatex } from "./latex.js";
import type { Conversation, ConversationMessage } from "../types.js";

/**
 * Import without export is a roach motel, not a relay. If a conversation can
 * come in from any client but can only leave in LNKZ's own shape, LNKZ has
 * replaced the lock-in it exists to remove.
 *
 * Every writer here is a pure function of one conversation, which is what makes
 * the round-trip tests possible: import a vendor export, write it back out in
 * that vendor's shape, re-import it, and the messages must survive.
 */
export type ExportFormat =
  | "markdown"
  | "markdown-brief"
  | "openai"
  | "chatgpt"
  | "claude"
  | "lnkz"
  | "latex"
  | "text";

export const EXPORT_FORMATS: ExportFormat[] = [
  "markdown", "markdown-brief", "openai", "chatgpt", "claude", "lnkz", "latex", "text",
];

/**
 * Formats LNKZ can read back. LaTeX is a one-way door: it is a typesetting
 * language, and parsing one back into a conversation would be a compiler, not an
 * importer. The flag is on the result so a caller can tell the difference rather
 * than discovering it when a re-import fails.
 */
export const REIMPORTABLE_FORMATS: ExportFormat[] = EXPORT_FORMATS.filter((format) => format !== "latex");

export interface ExportResult {
  format: ExportFormat;
  mimeType: string;
  filename: string;
  body: string;
  /** True when the output can be fed straight back into `import_conversation`. */
  reimportable: boolean;
}

export function exportConversation(conversation: Conversation, format: ExportFormat): ExportResult {
  switch (format) {
    case "markdown":
      return result(conversation, format, "text/markdown", "md", conversationToMarkdown(conversation), true);
    case "markdown-brief":
      return result(
        conversation,
        format,
        "text/markdown",
        "md",
        conversationToMarkdownWithAnalysis(conversation, analyzeConversation(conversation)),
        true,
      );
    case "openai":
      return result(conversation, format, "application/json", "json", JSON.stringify(toOpenAi(conversation), null, 2), true);
    case "chatgpt":
      return result(conversation, format, "application/json", "json", JSON.stringify(toChatGpt(conversation), null, 2), true);
    case "claude":
      return result(conversation, format, "application/json", "json", JSON.stringify(toClaude(conversation), null, 2), true);
    case "lnkz":
      return result(conversation, format, "application/json", "json", JSON.stringify(toPacket(conversation), null, 2), true);
    case "latex":
      return result(conversation, format, "application/x-tex", "tex", toLatex(conversation), false);
    default:
      return result(conversation, "text", "text/plain", "txt", toPlainText(conversation), true);
  }
}

/** The chat-completions message array, ready to paste into an API call. */
export function toOpenAi(conversation: Conversation): { model?: string; messages: { role: string; content: string; name?: string }[] } {
  const model = typeof conversation.metadata?.model === "string" ? conversation.metadata.model : undefined;
  return {
    ...(model ? { model } : {}),
    messages: conversation.messages.map((message) => ({
      role: openAiRole(message.role),
      content: message.content,
      ...(message.author ? { name: safeName(message.author) } : {}),
    })),
  };
}

/**
 * ChatGPT's export is a message tree keyed by node id, with `current_node`
 * pointing at the leaf of the active branch. A linear conversation is the
 * degenerate case: a single spine from root to leaf.
 */
export function toChatGpt(conversation: Conversation): Record<string, unknown> {
  const mapping: Record<string, unknown> = {
    root: { id: "root", message: null, parent: null, children: conversation.messages.length ? [conversation.messages[0].id] : [] },
  };

  conversation.messages.forEach((message, index) => {
    const previous = index === 0 ? "root" : conversation.messages[index - 1].id;
    const next = conversation.messages[index + 1];
    mapping[message.id] = {
      id: message.id,
      parent: previous,
      children: next ? [next.id] : [],
      message: {
        id: message.id,
        author: { role: openAiRole(message.role), name: message.author ?? null, metadata: {} },
        create_time: toEpochSeconds(message.createdAt),
        content: { content_type: "text", parts: [message.content] },
        status: "finished_successfully",
        metadata: {},
      },
    };
  });

  return {
    title: conversation.title,
    create_time: toEpochSeconds(conversation.createdAt),
    update_time: toEpochSeconds(conversation.updatedAt),
    conversation_id: conversation.id,
    current_node: conversation.messages.at(-1)?.id ?? "root",
    mapping,
  };
}

/** Claude's account export: one record per conversation, messages in a flat list. */
export function toClaude(conversation: Conversation): Record<string, unknown> {
  return {
    uuid: conversation.id,
    name: conversation.title,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    chat_messages: conversation.messages.map((message) => ({
      uuid: message.id,
      sender: message.role === "assistant" ? "assistant" : "human",
      text: message.content,
      created_at: message.createdAt,
      content: [{ type: "text", text: message.content }],
    })),
  };
}

/** LNKZ's own portable packet, which re-imports with full fidelity. */
export function toPacket(conversation: Conversation): Record<string, unknown> {
  return {
    format: "lnkz.conversation.v1",
    conversation,
    analysis: analyzeConversation(conversation),
    exportedAt: new Date().toISOString(),
  };
}

export function toPlainText(conversation: Conversation): string {
  const lines = [conversation.title, ""];
  for (const message of conversation.messages) {
    lines.push(`${message.author || labelFor(message)}: ${message.content}`, "");
  }
  return lines.join("\n").trim();
}

function result(
  conversation: Conversation,
  format: ExportFormat,
  mimeType: string,
  extension: string,
  body: string,
  reimportable: boolean,
): ExportResult {
  return { format, mimeType, filename: `${slug(conversation.title)}.${format}.${extension}`, body, reimportable };
}

/**
 * LNKZ has five roles; the chat-completions shape has four and no "other".
 * Anything unmapped becomes a user turn, because dropping it would lose content
 * and inventing a system turn would change how a model reads the thread.
 */
function openAiRole(role: ConversationMessage["role"]): string {
  if (role === "assistant" || role === "system" || role === "tool") return role;
  return "user";
}

function labelFor(message: ConversationMessage): string {
  return message.role === "assistant" ? "Assistant" : message.role === "system" ? "System" : "User";
}

/** `name` in the chat-completions shape is restricted; strip what is not allowed. */
function safeName(author: string): string {
  return author.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

function toEpochSeconds(value: string): number | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime() / 1000;
}

function slug(title: string): string {
  const cleaned = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return cleaned || "conversation";
}
