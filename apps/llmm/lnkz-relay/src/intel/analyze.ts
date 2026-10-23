import type { AnalysisClaim, Conversation, ConversationAnalysis, ConversationMessage } from "../types.js";

/**
 * LNKZ summarizes without calling a model. A relay that needed an API key to
 * describe its own payload would be useless offline, non-deterministic, and
 * impossible to test, so the extraction here is rule based and repeatable.
 */

const DECISION_CUES = [
  "we decided", "we've decided", "we have decided", "decision:", "decided to",
  "let's go with", "lets go with", "going with", "we'll use", "we will use",
  "we should use", "settled on", "agreed to", "agreed on", "the plan is",
  "final answer", "we chose", "i chose", "chosen approach", "approved",
  "locking in", "sticking with",
];

const QUESTION_CUES = [
  "open question", "still unclear", "not sure", "unsure", "tbd", "to be determined",
  "need to confirm", "needs confirmation", "unknown", "unresolved", "we don't know",
  "we do not know", "?",
];

const ACTION_CUES = [
  "i'll", "i will", "we'll", "we will", "next step", "next steps", "todo", "to do",
  "action item", "follow up", "follow-up", "assign", "let's ", "lets ",
  "we need to", "you need to", "please ", "must ", "should ",
];

const NEGATIVE_ACTION_CUES = ["i'll explain", "i will explain", "let's say", "lets say"];

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "has", "was", "were",
  "you", "your", "our", "are", "but", "not", "can", "will", "would", "could", "should",
  "what", "when", "where", "which", "there", "their", "then", "than", "into", "about",
  "just", "like", "some", "more", "most", "only", "also", "very", "much", "make", "made",
  "does", "did", "done", "get", "got", "how", "why", "who", "its", "it's", "one", "two",
  "use", "using", "used", "want", "need", "know", "think", "sure", "okay", "yeah", "yes",
  "let", "lets", "let's", "here", "over", "back", "well", "good", "same", "still", "now",
]);

export function analyzeConversation(conversation: Conversation): ConversationAnalysis {
  const decisions: AnalysisClaim[] = [];
  const openQuestions: AnalysisClaim[] = [];
  const actionItems: AnalysisClaim[] = [];
  const facts: AnalysisClaim[] = [];

  for (const message of conversation.messages) {
    if (message.role === "system") continue;
    for (const sentence of splitSentences(message.content)) {
      const lower = sentence.toLowerCase();
      const claim = toClaim(sentence, message);
      if (matchesAny(lower, DECISION_CUES)) push(decisions, claim);
      else if (isOpenQuestion(lower)) push(openQuestions, claim);
      else if (isActionItem(lower)) push(actionItems, claim);
      else if (isFact(sentence)) push(facts, claim);
    }
  }

  return {
    decisions: decisions.slice(0, 25),
    openQuestions: openQuestions.slice(0, 25),
    actionItems: actionItems.slice(0, 25),
    facts: facts.slice(0, 25),
    topics: extractTopics(conversation),
    participants: derivedParticipants(conversation),
    messageCount: conversation.messages.length,
    approxTokens: approxTokens(conversation.messages.map((message) => message.content).join(" ")),
    span: {
      start: conversation.messages[0]?.createdAt,
      end: conversation.messages[conversation.messages.length - 1]?.createdAt,
    },
  };
}

/** Rough token count. Good enough to budget a packet, and it costs nothing. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 12 && sentence.length <= 400);
}

export function extractTopics(conversation: Conversation, limit = 12): string[] {
  const counts = new Map<string, number>();
  const text = [
    conversation.title,
    conversation.summary ?? "",
    conversation.tags.join(" "),
    ...conversation.messages.map((message) => message.content),
  ].join(" ").toLowerCase();

  for (const word of text.split(/[^a-z0-9+#.-]+/)) {
    const term = word.replace(/^[.\-]+|[.\-]+$/g, "");
    if (term.length < 3 || term.length > 32 || STOPWORDS.has(term)) continue;
    if (/^\d+$/.test(term)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function derivedParticipants(conversation: Conversation): string[] {
  const names = new Set(conversation.participants);
  for (const message of conversation.messages) {
    if (message.author) names.add(message.author);
  }
  return [...names];
}

function toClaim(text: string, message: ConversationMessage): AnalysisClaim {
  return {
    text,
    messageId: message.id,
    author: message.author || message.role,
    createdAt: message.createdAt,
  };
}

function push(target: AnalysisClaim[], claim: AnalysisClaim): void {
  if (target.some((existing) => existing.text === claim.text)) return;
  target.push(claim);
}

function matchesAny(lower: string, cues: string[]): boolean {
  return cues.some((cue) => lower.includes(cue));
}

function isOpenQuestion(lower: string): boolean {
  if (lower.endsWith("?")) return true;
  return QUESTION_CUES.some((cue) => cue !== "?" && lower.includes(cue));
}

function isActionItem(lower: string): boolean {
  if (NEGATIVE_ACTION_CUES.some((cue) => lower.includes(cue))) return false;
  return ACTION_CUES.some((cue) => lower.includes(cue));
}

function isFact(sentence: string): boolean {
  return /\bhttps?:\/\//.test(sentence) || /\b\d[\d,.]*\s*(%|ms|s|kb|mb|gb|req|rps|users?|days?|weeks?)\b/i.test(sentence);
}
