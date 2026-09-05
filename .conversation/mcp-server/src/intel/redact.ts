import type { Conversation, RedactionReport } from "../types.js";

/**
 * A handoff link leaves the owner's control the moment it is shared, so LNKZ
 * can strip the obvious secrets out of a conversation before it travels.
 * The patterns are conservative on purpose: a false negative is a leak, but a
 * false positive silently destroys context, so nothing here matches bare words.
 */
const PATTERNS: { kind: string; pattern: RegExp; replacement: string }[] = [
  { kind: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: "[redacted:openai-key]" },
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, replacement: "[redacted:anthropic-key]" },
  { kind: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: "[redacted:github-token]" },
  { kind: "slack-token", pattern: /\bxox[abporsz]-[A-Za-z0-9-]{10,}\b/g, replacement: "[redacted:slack-token]" },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: "[redacted:aws-access-key]" },
  { kind: "google-api-key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g, replacement: "[redacted:google-api-key]" },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: "[redacted:jwt]" },
  { kind: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[redacted:private-key]" },
  { kind: "bearer-header", pattern: /\b[Bb]earer\s+[A-Za-z0-9._-]{20,}\b/g, replacement: "Bearer [redacted]" },
  { kind: "connection-string", pattern: /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@]+@[^\s]+/gi, replacement: "[redacted:connection-string]" },
  { kind: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "[redacted:email]" },
  { kind: "credit-card", pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: "[redacted:card-number]" },
];

/** Patterns that are too aggressive to run unless the caller opts in. */
const OPTIONAL_KINDS = new Set(["email", "credit-card"]);

export interface RedactOptions {
  /** Also strip email addresses and card-shaped digit runs. */
  aggressive?: boolean;
}

export function redactText(value: string, options: RedactOptions = {}): { text: string; removed: Map<string, number> } {
  const removed = new Map<string, number>();
  let text = value;
  for (const rule of PATTERNS) {
    if (OPTIONAL_KINDS.has(rule.kind) && !options.aggressive) continue;
    let hits = 0;
    text = text.replace(rule.pattern, (match) => {
      if (rule.kind === "credit-card" && !looksLikeCard(match)) return match;
      hits += 1;
      return rule.replacement;
    });
    if (hits) removed.set(rule.kind, (removed.get(rule.kind) ?? 0) + hits);
  }
  return { text, removed };
}

export function redactConversation(
  conversation: Conversation,
  options: RedactOptions = {},
): { conversation: Conversation; report: RedactionReport } {
  const totals = new Map<string, number>();
  const collect = (value: string | undefined): string | undefined => {
    if (!value) return value;
    const result = redactText(value, options);
    for (const [kind, count] of result.removed) totals.set(kind, (totals.get(kind) ?? 0) + count);
    return result.text;
  };

  const redacted: Conversation = {
    ...conversation,
    title: collect(conversation.title) ?? conversation.title,
    summary: collect(conversation.summary),
    messages: conversation.messages.map((message) => ({
      ...message,
      content: collect(message.content) ?? message.content,
    })),
  };

  return {
    conversation: redacted,
    report: {
      applied: true,
      removed: [...totals.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    },
  };
}

export function noRedaction(): RedactionReport {
  return { applied: false, removed: [] };
}

/** Luhn check, so version numbers and long ID runs survive redaction. */
function looksLikeCard(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}
