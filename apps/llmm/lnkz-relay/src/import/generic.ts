import { asArray, asRecord, asString, buildConversation, flattenContent, normalizeDate, normalizeRole, titleFromMessages } from "./shared.js";
import type { ConversationInput, MessageInput } from "../types.js";

/**
 * A structural importer for exports LNKZ has never seen.
 *
 * The alternative is a bespoke parser per vendor, which ages badly: every export
 * format changes without notice, there are more of them every month, and a parser
 * written from a guess about a shape nobody here has actually held is worse than
 * no parser, because it fails silently and half-imports.
 *
 * So instead of asking "is this Grok, or Perplexity, or Copilot", this asks a
 * structural question: somewhere in this JSON there is an array that holds a
 * conversation. Find the best candidate and read it. Two shapes cover nearly
 * everything in practice:
 *
 *   message arrays    [{ role: "user", text: "..." }, ...]   one element, one turn
 *   exchange arrays   [{ prompt: "...", response: "..." }]   one element, two turns
 *
 * When it cannot find either, it says so rather than guessing.
 */

const ROLE_KEYS = ["role", "sender", "author", "speaker", "from", "participant", "actor", "type"];
const TEXT_KEYS = ["content", "text", "message", "body", "value", "parts", "markdown", "display_text"];
const PROMPT_KEYS = ["prompt", "question", "query", "request", "input", "user_message", "usermessage", "human", "user"];
const ANSWER_KEYS = ["response", "answer", "completion", "output", "assistant", "reply", "ai", "model_response", "result"];
const TITLE_KEYS = ["title", "name", "subject", "topic", "summary", "label"];
const TIME_KEYS = ["timestamp", "created_at", "createdat", "created", "time", "date", "sent_at", "updated_at"];

const MAX_NODES = 50_000;
const MAX_DEPTH = 12;

export function looksLikeGeneric(value: unknown): boolean {
  return findCandidates(value).length > 0;
}

export function importGeneric(value: unknown): { conversations: ConversationInput[]; warnings: string[] } {
  const warnings: string[] = [];
  const candidates = findCandidates(value).sort((a, b) => b.score - a.score);
  if (!candidates.length) return { conversations: [], warnings };

  // Several sibling candidates of comparable quality usually means a file of many
  // conversations. One clear winner means a single conversation with noise around it.
  const best = candidates[0];
  const chosen = candidates.filter((candidate) => candidate.score >= best.score * 0.6).slice(0, 200);

  const conversations: ConversationInput[] = [];
  for (const candidate of chosen) {
    const messages = candidate.kind === "messages"
      ? readMessageArray(candidate.items)
      : readExchangeArray(candidate.items);
    if (messages.length < 1) continue;

    const conversation = buildConversation({
      title: candidate.title || titleFromMessages(messages, "Imported conversation"),
      provider: "unknown",
      app: `generic/${candidate.kind}`,
      messages,
      tags: ["imported", "generic"],
      metadata: { discoveredAt: candidate.path, shape: candidate.kind },
    });
    if (conversation) conversations.push(conversation);
  }

  if (conversations.length) {
    warnings.push(
      `The export format was not recognized, so the conversation was located structurally `
      + `(${best.kind === "messages" ? "message array" : "prompt and response pairs"} at ${best.path || "the document root"}). `
      + `Check the result before relying on it.`,
    );
  }

  return { conversations, warnings };
}

interface Candidate {
  items: Record<string, unknown>[];
  kind: "messages" | "exchanges";
  score: number;
  path: string;
  title?: string;
}

function findCandidates(root: unknown): Candidate[] {
  const found: Candidate[] = [];
  let visited = 0;

  const walk = (node: unknown, path: string, depth: number, parent: Record<string, unknown> | null): void => {
    if (depth > MAX_DEPTH || visited > MAX_NODES) return;
    visited += 1;

    if (Array.isArray(node)) {
      const objects = node.filter((entry): entry is Record<string, unknown> => asRecord(entry) != null);
      if (objects.length >= 1 && objects.length === node.length) {
        const asMessages = objects.filter(isMessageShaped).length / objects.length;
        const asExchanges = objects.filter(isExchangeShaped).length / objects.length;

        // An exchange array is the stronger claim, so it wins ties: an element
        // holding both a question and an answer is unambiguous, while "has a role
        // and some text" matches plenty of things that are not conversations.
        if (asExchanges >= 0.6) {
          found.push({
            items: objects,
            kind: "exchanges",
            score: objects.length * asExchanges * 1.2,
            path,
            title: parent ? titleNear(parent) : undefined,
          });
        } else if (asMessages >= 0.6 && objects.length >= 2) {
          found.push({
            items: objects,
            kind: "messages",
            score: objects.length * asMessages,
            path,
            title: parent ? titleNear(parent) : undefined,
          });
        }
      }
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`, depth + 1, parent));
      return;
    }

    const record = asRecord(node);
    if (!record) return;
    for (const [key, child] of Object.entries(record)) {
      walk(child, path ? `${path}.${key}` : key, depth + 1, record);
    }
  };

  walk(root, "", 0, null);
  return found;
}

function readMessageArray(items: Record<string, unknown>[]): MessageInput[] {
  const messages: MessageInput[] = [];
  for (const item of items) {
    const content = textOf(item);
    if (!content.trim()) continue;
    messages.push({
      role: normalizeRole(valueForAny(item, ROLE_KEYS)),
      content,
      author: authorOf(item),
      createdAt: normalizeDate(valueForAny(item, TIME_KEYS)),
    });
  }
  return messages;
}

function readExchangeArray(items: Record<string, unknown>[]): MessageInput[] {
  const messages: MessageInput[] = [];
  for (const item of items) {
    const createdAt = normalizeDate(valueForAny(item, TIME_KEYS));
    const prompt = flattenLoose(valueForAny(item, PROMPT_KEYS));
    const answer = flattenLoose(valueForAny(item, ANSWER_KEYS));
    if (prompt.trim()) messages.push({ role: "user", content: prompt, createdAt });
    if (answer.trim()) messages.push({ role: "assistant", content: answer, createdAt });
  }
  return messages;
}

function isMessageShaped(item: Record<string, unknown>): boolean {
  const hasRole = ROLE_KEYS.some((key) => typeof lower(item)[key] === "string");
  return hasRole && textOf(item).trim().length > 0;
}

function isExchangeShaped(item: Record<string, unknown>): boolean {
  const keys = lower(item);
  const hasPrompt = PROMPT_KEYS.some((key) => key in keys && flattenLoose(keys[key]).trim().length > 0);
  const hasAnswer = ANSWER_KEYS.some((key) => key in keys && flattenLoose(keys[key]).trim().length > 0);
  return hasPrompt && hasAnswer;
}

function textOf(item: Record<string, unknown>): string {
  return flattenLoose(valueForAny(item, TEXT_KEYS));
}

function authorOf(item: Record<string, unknown>): string | undefined {
  const keys = lower(item);
  for (const key of ["author", "speaker", "name", "username", "display_name"]) {
    const value = asString(keys[key]);
    if (value && value.length <= 80) return value;
  }
  return undefined;
}

/**
 * `flattenContent` handles the common typed-block shapes. This adds the loose
 * ones seen in ad hoc exports: a `value` field, a bare array of strings, or an
 * object whose only useful content is one nested string.
 */
function flattenLoose(value: unknown): string {
  const direct = flattenContent(value);
  if (direct.trim()) return direct;
  if (Array.isArray(value)) return value.map(flattenLoose).filter(Boolean).join("\n").trim();
  const record = asRecord(value);
  if (!record) return "";
  for (const key of ["value", "markdown", "display_text", "answer", "output", "result"]) {
    const nested = flattenLoose(record[key]);
    if (nested.trim()) return nested;
  }
  return "";
}

function valueForAny(item: Record<string, unknown>, keys: string[]): unknown {
  const normalized = lower(item);
  for (const key of keys) {
    if (key in normalized && normalized[key] != null) return normalized[key];
  }
  return undefined;
}

function titleNear(record: Record<string, unknown>): string | undefined {
  const normalized = lower(record);
  for (const key of TITLE_KEYS) {
    const value = asString(normalized[key]).trim();
    if (value && value.length <= 200) return value;
  }
  return undefined;
}

/** Exports disagree about casing, so every lookup goes through a lowercased view. */
function lower(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) result[key.toLowerCase()] = value;
  return result;
}

export const __testing = { findCandidates, flattenLoose };
