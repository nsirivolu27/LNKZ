import { analyzeConversation } from "../intel/analyze.js";
import { conversationToMarkdown } from "../store/markdown.js";
import type { Conversation } from "../types.js";

/**
 * Preparing a conversation to be written into another system, without writing it.
 *
 * LNKZ can already read Slack, Jira, Figma and any federated MCP server. The
 * obvious next step is writing back: turn a decision into a Jira issue, post a
 * packet into a channel. That step is also where a context relay stops being
 * harmless, so it is split in two. This half maps a conversation onto a remote
 * tool's input schema and shows the exact call. Nothing here sends anything, and
 * nothing here can: there is no client, no transport and no network in this file.
 *
 * Actually invoking the call is a separate decision, and it should be an explicit
 * allowlist plus an audit entry, not a flag someone flips in passing.
 */

export type PublishShape = "summary" | "decisions" | "transcript" | "brief";

export interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
}

export interface PreparedCall {
  target: string;
  tool: string;
  arguments: Record<string, unknown>;
  /** Required fields the mapping could not fill. The caller has to supply these. */
  missing: { name: string; type: string; description?: string }[];
  /** Fields that were filled, and what they were filled from. */
  filled: { name: string; from: string }[];
  notes: string[];
  sent: false;
}

/** Field names that usually mean "the short thing a human reads first". */
const TITLE_FIELDS = ["title", "summary", "subject", "name", "heading", "headline"];
/** Field names that usually mean "the long thing". */
const BODY_FIELDS = ["body", "text", "content", "description", "message", "comment", "markdown", "details", "note"];

export function prepareCall(
  conversation: Conversation,
  target: string,
  tool: RemoteTool,
  shape: PublishShape = "summary",
): PreparedCall {
  const analysis = analyzeConversation(conversation);
  const title = conversation.title;
  const body = renderBody(conversation, shape);

  const properties = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const args: Record<string, unknown> = {};
  const filled: PreparedCall["filled"] = [];
  const notes: string[] = [];

  for (const [name, schema] of Object.entries(properties)) {
    const lower = name.toLowerCase();
    if (schema.type && schema.type !== "string") continue;

    if (TITLE_FIELDS.some((candidate) => lower.includes(candidate)) && !BODY_FIELDS.some((candidate) => lower.includes(candidate))) {
      args[name] = title;
      filled.push({ name, from: "conversation title" });
      continue;
    }
    if (BODY_FIELDS.some((candidate) => lower.includes(candidate))) {
      args[name] = body;
      filled.push({ name, from: `${shape} of the conversation` });
      continue;
    }
    if (lower.includes("url") || lower.includes("link")) {
      if (conversation.source.url) {
        args[name] = conversation.source.url;
        filled.push({ name, from: "the conversation's source URL" });
      }
    }
  }

  const missing = [...required]
    .filter((name) => !(name in args))
    .map((name) => ({
      name,
      type: properties[name]?.type ?? "unknown",
      description: properties[name]?.description,
    }));

  if (!Object.keys(properties).length) {
    notes.push("The remote tool advertises no input schema, so nothing could be mapped automatically.");
  }
  if (missing.length) {
    notes.push(`${missing.length} required field(s) could not be inferred and must be supplied by hand.`);
  }
  if (analysis.decisions.length === 0 && (shape === "decisions" || shape === "brief")) {
    notes.push("This conversation has no extractable decisions, so the payload leans on the transcript instead.");
  }
  notes.push("Nothing was sent. This is the call that would be made.");

  return { target, tool: tool.name, arguments: args, missing, filled, notes, sent: false };
}

/** How much of the conversation goes into the payload. */
export function renderBody(conversation: Conversation, shape: PublishShape): string {
  const analysis = analyzeConversation(conversation);

  if (shape === "transcript") return conversationToMarkdown(conversation);

  if (shape === "decisions") {
    const decisions = analysis.decisions.map((claim) => `- ${claim.text}`);
    return decisions.length
      ? `Decisions from "${conversation.title}":\n\n${decisions.join("\n")}`
      : `No decisions were extracted from "${conversation.title}".`;
  }

  if (shape === "brief") {
    const sections = [
      `From the conversation "${conversation.title}" (${conversation.source.provider}).`,
      section("Decisions", analysis.decisions.map((claim) => claim.text)),
      section("Open questions", analysis.openQuestions.map((claim) => claim.text)),
      section("Action items", analysis.actionItems.map((claim) => claim.text)),
    ].filter(Boolean);
    return sections.join("\n\n");
  }

  const summary = conversation.summary
    ?? analysis.decisions[0]?.text
    ?? conversation.messages[0]?.content.slice(0, 400)
    ?? conversation.title;
  return `${summary}\n\nFrom "${conversation.title}" (${conversation.messages.length} messages, ${conversation.source.provider}).`;
}

function section(heading: string, values: string[]): string {
  if (!values.length) return "";
  return `${heading}:\n${values.slice(0, 8).map((value) => `- ${value}`).join("\n")}`;
}

/**
 * Tools whose names suggest they change something. Discovery reports this so a
 * reader can see at a glance which half of a remote server's surface is writes,
 * without having to trust an annotation the remote server sets about itself.
 */
export function looksLikeWrite(tool: RemoteTool): boolean {
  const name = tool.name.toLowerCase();
  const verbs = ["create", "add", "post", "send", "write", "update", "set", "put", "delete", "remove", "publish", "comment", "assign", "close", "merge"];
  return verbs.some((verb) => name.startsWith(verb) || name.includes(`_${verb}`));
}
