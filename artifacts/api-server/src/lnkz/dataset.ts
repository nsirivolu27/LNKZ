import { createHash } from "node:crypto";
import type { Conversation } from "./types.js";

export interface DatasetOptions { seed: string; maxExamples: number; acknowledgeRights: boolean; approvalTag?: string }
export interface DatasetResult {
  manifest: { format: "lnkz.dataset.v1"; datasetId: string; workspaceId: string; seed: string; examples: { train: number; validation: number; duplicates: number }; sources: unknown[]; skipped: unknown[]; redactions: Record<string, number>; checksums: Record<string, string>; limitations: string[] };
  trainJsonl: string; validationJsonl: string;
}

const patterns: Array<[string, RegExp]> = [
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ["card", /\b(?:\d[ -]*?){13,19}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g],
  ["privateKey", /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g],
  ["connectionString", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi],
  ["token", /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g],
  ["secret", /\b(?:password|passwd|secret|api[_ -]?key)\s*[:=]\s*\S+/gi],
];

export function exportDataset(conversations: Conversation[], workspaceId: string, options: DatasetOptions): DatasetResult {
  const skipped: unknown[] = [], sources: unknown[] = [], redactions: Record<string, number> = {};
  const unique = new Map<string, { conversation: Conversation; text: string; group: string }>();
  for (const conversation of conversations) {
    if (conversation.messages.length < 2 || conversation.messages.some((message) => message.role === "tool")) {
      skipped.push({ id: conversation.id, reason: "incomplete-or-tool-transcript" }); continue;
    }
    const messages = conversation.messages.map((message) => {
      let content = message.content;
      for (const [kind, pattern] of patterns) {
        const matches = content.match(pattern) ?? [];
        content = content.replace(pattern, `[REDACTED_${kind.toUpperCase()}]`);
        const count = matches.length;
        if (count) redactions[kind] = (redactions[kind] ?? 0) + count;
      }
      return { role: message.role, content };
    });
    const text = JSON.stringify({ messages });
    const digest = createHash("sha256").update(text).digest("hex");
    if (unique.has(digest)) { skipped.push({ id: conversation.id, reason: "exact-duplicate", checksum: digest }); continue; }
    unique.set(digest, { conversation, text, group: conversation.lineage?.rootId ?? conversation.lineage?.parentId ?? conversation.id });
    sources.push({ id: conversation.id, createdAt: conversation.createdAt, checksum: digest });
  }
  const groups = [...new Set([...unique.values()].map((entry) => entry.group))].sort((a, b) => hash(options.seed + a).localeCompare(hash(options.seed + b)));
  const validationGroups = new Set(groups.filter((group) => hash(options.seed + group).charCodeAt(0) % 5 === 0));
  const train: string[] = [], validation: string[] = [];
  for (const entry of unique.values()) {
    const record = JSON.stringify({ sourceId: entry.conversation.id, messages: JSON.parse(entry.text).messages });
    (validationGroups.has(entry.group) ? validation : train).push(record);
    if (train.length + validation.length >= options.maxExamples) break;
  }
  const trainJsonl = train.join("\n") + (train.length ? "\n" : ""), validationJsonl = validation.join("\n") + (validation.length ? "\n" : "");
  const checksums = { train: sha(trainJsonl), validation: sha(validationJsonl) };
  return {
    manifest: { format: "lnkz.dataset.v1", datasetId: sha(workspaceId + options.seed + trainJsonl + validationJsonl).slice(0, 32), workspaceId, seed: options.seed, examples: { train: train.length, validation: validation.length, duplicates: skipped.filter((item) => (item as { reason?: string }).reason === "exact-duplicate").length }, sources, skipped, redactions, checksums, limitations: ["Dataset preparation only; no model was trained."] },
    trainJsonl, validationJsonl,
  };
}
function hash(value: string): string { return sha(value); }
function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }