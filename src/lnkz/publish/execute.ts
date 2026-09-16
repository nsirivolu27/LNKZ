import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpContextHeaders } from "../context.js";
import { redactConversation } from "../intel/redact.js";
import type { ConversationStore } from "../store/index.js";
import type { Conversation } from "../types.js";
import { prepareCall, type PreparedCall, type PublishShape, type RemoteTool } from "./prepare.js";
import type { PublishTarget } from "./targets.js";

/**
 * Actually making the call that prepare.ts only describes.
 *
 * Reading Slack, Jira and Figma is safe in a way writing to them is not: a
 * read that goes wrong wastes a request, a write that goes wrong is a ticket
 * somebody has to close or a message somebody has to explain. So this half was
 * split out and left unbuilt until the rules around it could be built with it,
 * which is what this file is.
 *
 * Three of them, and none is a flag someone flips in passing.
 *
 * A target being configured does not make it publishable. LNKZ_MCP_TARGETS
 * says where LNKZ may read; LNKZ_PUBLISH_ALLOWLIST says what it may write, as
 * explicit `target:tool` pairs. Absent means nothing publishes, in every
 * environment, including development, because a rule that relaxes itself
 * locally is a rule you find out about in production.
 *
 * Redaction runs before the call, not after, and defaults on. The packet that
 * leaves here goes to a system LNKZ does not control and often cannot delete
 * from.
 *
 * Every attempt is recorded, including the refused and the failed. An audit
 * log that only holds successes answers the wrong question.
 */

export type RemoteCaller = (
  target: PublishTarget,
  tool: string,
  args: Record<string, unknown>,
) => Promise<{ isError: boolean; text: string }>;

export interface ExecuteOptions {
  conversation: Conversation;
  target: PublishTarget;
  tool: RemoteTool;
  shape?: PublishShape;
  /** Fields the mapping could not fill, supplied by the caller. */
  overrides?: Record<string, unknown>;
  redact?: boolean;
  actorId?: string;
}

export interface ExecuteResult {
  prepared: PreparedCall;
  sent: boolean;
  outcome: "sent" | "refused" | "failed";
  reason?: string;
  response?: string;
  redacted: boolean;
}

/** `target:tool` pairs, comma or whitespace separated. Absent means nothing. */
export function publishAllowlist(environment: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = (environment.LNKZ_PUBLISH_ALLOWLIST ?? "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.includes(":")),
  );
}

export function isPublishAllowed(
  target: string,
  tool: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return publishAllowlist(environment).has(`${target.toLowerCase()}:${tool.toLowerCase()}`);
}

export async function executePublish(
  store: ConversationStore,
  options: ExecuteOptions,
  call: RemoteCaller = callOverHttp,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ExecuteResult> {
  const redact = options.redact ?? true;
  const source = redact ? redactConversation(options.conversation, { aggressive: true }).conversation : options.conversation;
  const prepared = prepareCall(source, options.target.name, options.tool, options.shape ?? "summary");
  const args = { ...prepared.arguments, ...(options.overrides ?? {}) };

  const record = async (outcome: ExecuteResult["outcome"], reason?: string) => {
    // Never the arguments. The point of redacting on the way out is defeated
    // by writing the payload into the audit log on the way past.
    await store.recordEvent({
      kind: `publish.${outcome}`,
      conversationId: options.conversation.id,
      // Spread rather than assigned, so an unknown actor is an absent field
      // rather than a present one holding undefined.
      ...(options.actorId ? { actorId: options.actorId } : {}),
      detail: {
        target: options.target.name,
        tool: options.tool.name,
        shape: options.shape ?? "summary",
        redacted: redact,
        ...(reason ? { reason } : {}),
      },
    });
  };

  if (!isPublishAllowed(options.target.name, options.tool.name, environment)) {
    const reason = `${options.target.name}:${options.tool.name} is not in LNKZ_PUBLISH_ALLOWLIST.`;
    await record("refused", reason);
    return { prepared, sent: false, outcome: "refused", reason, redacted: redact };
  }

  // A required field the mapping could not fill and the caller did not supply
  // would be sent as absent, and a remote server's idea of a missing required
  // field is its own business. Refuse here where the message is useful.
  const unfilled = prepared.missing.filter((field) => !(field.name in args));
  if (unfilled.length) {
    const reason = `Missing required field(s): ${unfilled.map((field) => field.name).join(", ")}.`;
    await record("refused", reason);
    return { prepared, sent: false, outcome: "refused", reason, redacted: redact };
  }

  let result: { isError: boolean; text: string };
  try {
    result = await call(options.target, options.tool.name, args);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The target could not be reached.";
    await record("failed", reason);
    return { prepared, sent: false, outcome: "failed", reason, redacted: redact };
  }

  if (result.isError) {
    await record("failed", result.text.slice(0, 200));
    return { prepared, sent: false, outcome: "failed", reason: result.text, redacted: redact };
  }

  await record("sent");
  return { prepared, sent: true, outcome: "sent", response: result.text, redacted: redact };
}

async function callOverHttp(
  target: PublishTarget,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const client = new Client({ name: "lnkz", version: "0.2.0" });
  const headers = mcpContextHeaders(process.env.LNKZ_MCP_CONTEXT_SECRET);
  if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;
  const transport = new StreamableHTTPClientTransport(new URL(target.url), { requestInit: { headers } });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: tool, arguments: args });
    const text = Array.isArray(result.content)
      ? result.content
          .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
          .filter(Boolean)
          .join("\n")
      : "";
    return { isError: Boolean(result.isError), text: text || "The target accepted the call and returned no text." };
  } finally {
    await client.close().catch(() => undefined);
  }
}
