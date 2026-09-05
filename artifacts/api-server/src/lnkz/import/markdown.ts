import { buildConversation, dropPreamble, normalizeRole, titleFromMessages } from "./shared.js";
import type { ConversationInput, MessageInput } from "../types.js";

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const BOLD_SPEAKER = /^\*\*([^*]{1,60}?)\*\*\s*[:：]?\s*(.*)$/;
const PLAIN_SPEAKER = /^([A-Za-z][\w .'-]{0,40})\s*[:：]\s+(.*)$/;

const KNOWN_SPEAKERS = new Set([
  "user", "human", "me", "you", "assistant", "ai", "bot", "chatgpt", "claude",
  "gemini", "copilot", "grok", "system", "tool",
]);

/**
 * Words that introduce a fact about the document rather than a person speaking.
 * "Source: chatgpt" and "Tags: launch" match the same `Word: value` shape a
 * transcript uses for "Alice: hello", so without this list a document's own
 * header block reads back as a handful of messages from nobody. LNKZ writes most
 * of these itself when it exports Markdown, which is exactly how the problem was
 * found: a transcript exported and re-imported came back longer than it went out.
 */
const METADATA_KEYS = new Set([
  "source", "updated", "created", "date", "time", "participants", "tags", "summary",
  "title", "author", "authors", "model", "provider", "app", "device", "exported",
  "continued from", "id", "version", "status", "format", "note", "notes", "url",
  "link", "conversation", "workspace",
]);

/**
 * The most common way a chat actually moves between people today is a pasted
 * Markdown transcript, so LNKZ treats that as a first-class import rather than
 * dumping it into one undifferentiated blob.
 */
export function importMarkdown(payload: string): { conversations: ConversationInput[]; warnings: string[] } {
  const lines = payload.replace(/\r\n/g, "\n").split("\n");
  const warnings: string[] = [];
  let title = "";
  let inFence = false;

  const messages: (MessageInput & { attributed: boolean })[] = [];
  let current: { role: string; author?: string; buffer: string[]; attributed: boolean } | null = null;

  const flush = () => {
    if (!current) return;
    const content = current.buffer.join("\n").trim();
    if (content) {
      messages.push({
        role: normalizeRole(current.role),
        content,
        author: current.author && !KNOWN_SPEAKERS.has(current.author.toLowerCase()) ? current.author : undefined,
        attributed: current.attributed,
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) inFence = !inFence;

    if (!inFence) {
      const heading = HEADING.exec(line);
      if (heading) {
        const text = heading[2].trim();
        if (heading[1].length === 1 && !title) {
          title = text;
          continue;
        }
        // Level one and two headings are document structure: "Transcript",
        // "Decisions", "Open questions". Only an explicit speaker name is read as
        // a turn at that level, because a section title and a person's name look
        // identical to a pattern match and guessing wrong invents messages.
        const structural = heading[1].length <= 2;
        if (structural ? KNOWN_SPEAKERS.has(text.trim().toLowerCase()) : isSpeaker(text)) {
          flush();
          current = { role: text, author: text, buffer: [], attributed: true };
          continue;
        }
        if (structural) {
          flush();
          continue;
        }
      }

      const bold = BOLD_SPEAKER.exec(line);
      if (bold && isSpeaker(bold[1])) {
        flush();
        current = { role: bold[1], author: bold[1], buffer: bold[2] ? [bold[2]] : [], attributed: true };
        continue;
      }

      const plain = PLAIN_SPEAKER.exec(line);
      if (plain && isSpeaker(plain[1])) {
        flush();
        current = { role: plain[1], author: plain[1], buffer: plain[2] ? [plain[2]] : [], attributed: true };
        continue;
      }
    }

    if (current) current.buffer.push(line);
    else if (line.trim()) current = { role: "other", buffer: [line], attributed: false };
  }
  flush();

  const turns = dropPreamble(messages);

  if (!turns.length) {
    warnings.push("No speaker headings were found, so the document was kept as a single note.");
    return {
      conversations: asSingleNote(payload, title),
      warnings,
    };
  }

  const conversation = buildConversation({
    title: title || titleFromMessages(turns, "Pasted transcript"),
    provider: "markdown",
    app: "transcript",
    messages: turns.map(({ attributed, ...message }) => message),
    tags: ["imported", "markdown"],
  });
  return { conversations: conversation ? [conversation] : [], warnings };
}

function isSpeaker(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[:：]$/, "");
  if (KNOWN_SPEAKERS.has(normalized)) return true;
  if (METADATA_KEYS.has(normalized)) return false;
  return normalized.length <= 24 && /^[a-z][a-z .'-]*$/.test(normalized) && normalized.split(" ").length <= 3;
}

function asSingleNote(payload: string, title: string): ConversationInput[] {
  const conversation = buildConversation({
    title: title || "Pasted note",
    provider: "markdown",
    app: "note",
    messages: [{ role: "user", content: payload.trim() }],
    tags: ["imported", "markdown", "note"],
  });
  return conversation ? [conversation] : [];
}
