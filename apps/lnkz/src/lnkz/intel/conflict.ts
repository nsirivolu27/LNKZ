import { analyzeConversation } from "./analyze.js";
import { cosineSimilarity, normalizeForCompare, textSimilarity } from "./similarity.js";
import type { ConflictPair, Conversation, DuplicatePair } from "../types.js";

const NEGATIONS = [
  "not", "never", "won't", "wont", "isn't", "isnt", "aren't", "arent", "no longer",
  "instead of", "rather than", "avoid", "drop", "dropping", "reject", "rejected",
  "abandon", "abandoned", "revert", "reverting", "stop", "against",
];

const CUE_WORDS = new Set([
  "we", "i", "decided", "decide", "decision", "go", "going", "with", "let", "lets",
  "use", "using", "chose", "choose", "chosen", "agreed", "settled", "on", "the", "plan",
  "is", "to", "final", "answer", "approved", "locking", "in", "sticking", "will", "well",
]);

/**
 * Flags pairs of decisions that talk about the same thing but land differently.
 * This is a heuristic and it says so: the tool reports candidates for a human or
 * a model to adjudicate, it does not claim one side is wrong.
 */
export function detectConflicts(conversations: Conversation[], threshold = 0.45): ConflictPair[] {
  const decisions = conversations.flatMap((conversation) =>
    analyzeConversation(conversation).decisions.map((claim) => ({
      conversationId: conversation.id,
      title: conversation.title,
      text: claim.text,
      subject: subjectOf(claim.text),
      negated: isNegated(claim.text),
      options: optionTokens(claim.text),
    })),
  );

  const conflicts: ConflictPair[] = [];
  for (let i = 0; i < decisions.length; i += 1) {
    for (let j = i + 1; j < decisions.length; j += 1) {
      const left = decisions[i];
      const right = decisions[j];
      if (left.conversationId === right.conversationId) continue;
      const similarity = cosineSimilarity(left.subject, right.subject);
      if (similarity < threshold) continue;

      let reason = "";
      if (left.negated !== right.negated) {
        reason = "One conversation affirms this decision and the other rejects it.";
      } else {
        const divergent = symmetricDifference(left.options, right.options);
        if (divergent.length >= 1 && similarity < 0.95) {
          reason = `Same decision area, different choice: ${divergent.slice(0, 4).join(" vs ")}.`;
        }
      }
      if (!reason) continue;

      conflicts.push({
        left: { conversationId: left.conversationId, title: left.title, text: left.text },
        right: { conversationId: right.conversationId, title: right.title, text: right.text },
        reason,
        similarity: Number(similarity.toFixed(3)),
      });
    }
  }

  return conflicts.sort((a, b) => b.similarity - a.similarity).slice(0, 25);
}

/** Near-duplicate conversations, which relays accumulate quickly. */
export function detectDuplicates(conversations: Conversation[], threshold = 0.6): DuplicatePair[] {
  const bodies = conversations.map((conversation) => ({
    conversation,
    body: conversation.messages.map((message) => message.content).join("\n"),
  }));

  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const similarity = textSimilarity(bodies[i].body, bodies[j].body);
      if (similarity < threshold) continue;
      pairs.push({
        left: { conversationId: bodies[i].conversation.id, title: bodies[i].conversation.title },
        right: { conversationId: bodies[j].conversation.id, title: bodies[j].conversation.title },
        similarity: Number(similarity.toFixed(3)),
      });
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity).slice(0, 25);
}

function subjectOf(sentence: string): string {
  return normalizeForCompare(sentence)
    .split(" ")
    .filter((term) => term.length > 2 && !CUE_WORDS.has(term) && !NEGATIONS.includes(term))
    .join(" ");
}

function isNegated(sentence: string): boolean {
  const lower = ` ${normalizeForCompare(sentence)} `;
  return NEGATIONS.some((negation) => lower.includes(` ${normalizeForCompare(negation)} `));
}

/** Distinctive tokens that usually name the thing chosen (postgres, redis, plan b). */
function optionTokens(sentence: string): Set<string> {
  return new Set(
    normalizeForCompare(sentence)
      .split(" ")
      .filter((term) => term.length >= 3 && !CUE_WORDS.has(term) && !NEGATIONS.includes(term)),
  );
}

function symmetricDifference(left: Set<string>, right: Set<string>): string[] {
  const result: string[] = [];
  for (const value of left) if (!right.has(value)) result.push(value);
  for (const value of right) if (!left.has(value)) result.push(value);
  return result;
}
