import { importChatGpt, looksLikeChatGpt } from "./chatgpt.js";
import { importClaude, looksLikeClaude } from "./claude.js";
import { importGemini, looksLikeGemini } from "./gemini.js";
import { importGeneric, looksLikeGeneric } from "./generic.js";
import { importLnkz, looksLikeLnkz } from "./lnkz.js";
import { importMarkdown } from "./markdown.js";
import { importOpenAi, looksLikeOpenAi } from "./openai.js";
import { importPlainText } from "./plain.js";
import type { ConversationInput } from "../types.js";

export type ImportFormat =
  | "auto"
  | "chatgpt"
  | "claude"
  | "gemini"
  | "openai"
  | "lnkz"
  | "generic"
  | "markdown"
  | "text";

export interface ImportResult {
  format: Exclude<ImportFormat, "auto">;
  conversations: ConversationInput[];
  warnings: string[];
}

/**
 * The point of LNKZ is that a chat does not belong to the client it started in.
 * That promise only holds if the ugly part - every vendor's export shape - is
 * handled here, once, instead of by whoever is trying to move their context.
 */
export function importConversations(payload: string, format: ImportFormat = "auto"): ImportResult {
  const trimmed = payload.trim();
  if (!trimmed) throw new Error("Nothing to import.");

  const resolved = format === "auto" ? detectFormat(trimmed) : format;
  switch (resolved) {
    case "lnkz": return withFormat("lnkz", importLnkz(parseJson(trimmed)));
    case "chatgpt": return withFormat("chatgpt", importChatGpt(parseJson(trimmed)));
    case "claude": return withFormat("claude", importClaude(parseJson(trimmed)));
    case "gemini": return withFormat("gemini", importGemini(parseJson(trimmed)));
    case "openai": return withFormat("openai", importOpenAi(parseJson(trimmed)));
    case "generic": return withFormat("generic", importGeneric(parseJson(trimmed)));
    case "markdown": return withFormat("markdown", importMarkdown(trimmed));
    default: return withFormat("text", importPlainText(trimmed));
  }
}

/**
 * Detection runs most specific first. The named vendor formats identify
 * themselves by structures nothing else has; `openai` is the widely reused
 * interchange shape; `generic` is the structural fallback that finds a
 * conversation in an export nobody has taught LNKZ about yet. Only when all of
 * those decline does the payload get treated as prose.
 */
export function detectFormat(payload: string): Exclude<ImportFormat, "auto"> {
  if (payload.startsWith("{") || payload.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return looksLikeMarkdown(payload) ? "markdown" : "text";
    }
    if (looksLikeLnkz(parsed)) return "lnkz";
    if (looksLikeChatGpt(parsed)) return "chatgpt";
    if (looksLikeClaude(parsed)) return "claude";
    if (looksLikeGemini(parsed)) return "gemini";
    if (looksLikeOpenAi(parsed)) return "openai";
    if (looksLikeGeneric(parsed)) return "generic";
    return "text";
  }
  return looksLikeMarkdown(payload) ? "markdown" : "text";
}

/** Every format LNKZ can be asked for explicitly, for a client building a picker. */
export const SUPPORTED_FORMATS: Exclude<ImportFormat, "auto">[] = [
  "chatgpt", "claude", "gemini", "openai", "lnkz", "generic", "markdown", "text",
];

function looksLikeMarkdown(payload: string): boolean {
  return /^#{1,3}\s/m.test(payload) || /^\*\*(user|assistant|human|ai)\*\*/im.test(payload);
}

function withFormat(
  format: Exclude<ImportFormat, "auto">,
  result: { conversations: ConversationInput[]; warnings: string[] },
): ImportResult {
  if (!result.conversations.length) throw new Error(`No conversations found in the ${format} payload.`);
  return { format, ...result };
}

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(`Payload is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`);
  }
}

export {
  importChatGpt,
  importClaude,
  importGemini,
  importGeneric,
  importLnkz,
  importMarkdown,
  importOpenAi,
  importPlainText,
};
