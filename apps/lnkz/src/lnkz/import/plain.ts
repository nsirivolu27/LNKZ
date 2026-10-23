import { buildConversation, dropPreamble, normalizeRole, titleFromMessages } from "./shared.js";
import type { ConversationInput, MessageInput } from "../types.js";

const SPEAKER_LINE = /^\s*(user|human|me|you|assistant|ai|bot|chatgpt|claude|gemini|copilot|grok|system|tool)\s*[:：]\s*(.*)$/i;

/**
 * The lowest common denominator: someone copied a chat out of a window. If the
 * lines are labeled, LNKZ splits on the labels; otherwise the text is stored
 * whole so nothing is lost to a guess.
 */
export function importPlainText(payload: string): { conversations: ConversationInput[]; warnings: string[] } {
  const lines = payload.replace(/\r\n/g, "\n").split("\n");
  const messages: (MessageInput & { attributed: boolean })[] = [];
  let current: { role: string; buffer: string[]; attributed: boolean } | null = null;
  const warnings: string[] = [];

  const flush = () => {
    if (!current) return;
    const content = current.buffer.join("\n").trim();
    if (content) messages.push({ role: normalizeRole(current.role), content, attributed: current.attributed });
    current = null;
  };

  for (const line of lines) {
    const speaker = SPEAKER_LINE.exec(line);
    if (speaker) {
      flush();
      current = { role: speaker[1], buffer: speaker[2] ? [speaker[2]] : [], attributed: true };
      continue;
    }
    if (current) current.buffer.push(line);
    else if (line.trim()) current = { role: "user", buffer: [line], attributed: false };
  }
  flush();

  const turns = dropPreamble(messages);

  if (turns.length < 2) {
    warnings.push("No speaker labels were found, so the text was stored as one message.");
  }

  const stripped = turns.map(({ attributed, ...message }) => message);
  const conversation = buildConversation({
    title: titleFromMessages(stripped, "Pasted conversation"),
    provider: "text",
    app: "paste",
    messages: stripped.length ? stripped : [{ role: "user", content: payload.trim() }],
    tags: ["imported", "text"],
  });

  return { conversations: conversation ? [conversation] : [], warnings };
}
