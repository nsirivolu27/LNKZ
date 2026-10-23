import type { Conversation, ConversationAnalysis } from "../types.js";

/**
 * The portable transcript. Any LLM client can paste this straight into a prompt,
 * so it has to stay readable without the JSON packet next to it.
 */
export function conversationToMarkdown(conversation: Conversation): string {
  const lines = [`# ${conversation.title}`, ""];
  lines.push(...metadataLines(conversation));
  if (conversation.summary) lines.push("", "## Summary", "", conversation.summary);
  lines.push("", "## Transcript", "");
  for (const message of conversation.messages) {
    lines.push(`### ${message.author || roleLabel(message.role)}`, "", message.content, "");
  }
  return lines.join("\n").trim();
}

export function conversationToMarkdownWithAnalysis(
  conversation: Conversation,
  analysis: ConversationAnalysis,
): string {
  const lines = [`# ${conversation.title}`, ""];
  lines.push(...metadataLines(conversation));
  if (conversation.summary) lines.push("", "## Summary", "", conversation.summary);
  lines.push(...analysisSection("Decisions", analysis.decisions.map((claim) => claim.text)));
  lines.push(...analysisSection("Open questions", analysis.openQuestions.map((claim) => claim.text)));
  lines.push(...analysisSection("Action items", analysis.actionItems.map((claim) => claim.text)));
  lines.push("", "## Transcript", "");
  for (const message of conversation.messages) {
    lines.push(`### ${message.author || roleLabel(message.role)}`, "", message.content, "");
  }
  return lines.join("\n").trim();
}

function metadataLines(conversation: Conversation): string[] {
  const lines = [
    `Source: ${conversation.source.provider}${conversation.source.app ? ` / ${conversation.source.app}` : ""}`,
    `Updated: ${conversation.updatedAt}`,
  ];
  if (conversation.participants.length) lines.push(`Participants: ${conversation.participants.join(", ")}`);
  if (conversation.tags.length) lines.push(`Tags: ${conversation.tags.join(", ")}`);
  if (conversation.lineage?.parentId) lines.push(`Continued from: ${conversation.lineage.parentId}`);
  return lines;
}

function analysisSection(heading: string, values: string[]): string[] {
  if (!values.length) return [];
  return ["", `## ${heading}`, "", ...values.map((value) => `- ${value}`)];
}

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
