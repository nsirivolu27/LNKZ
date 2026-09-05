import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { connectorStatuses } from "./connectors/index.js";
import { importConversations } from "./import/index.js";
import { analyzeConversation } from "./intel/analyze.js";
import { detectConflicts, detectDuplicates } from "./intel/conflict.js";
import { buildContextPacket } from "./intel/packet.js";
import { registerSurfaces } from "./surfaces.js";
import {
  analyzeSchema,
  appendMessagesSchema,
  auditSchema,
  conflictSchema,
  contextPacketSchema,
  contextSearchSchema,
  continueConversationSchema,
  conversationInputSchema,
  createHandoffSchema,
  duplicateSchema,
  importSchema,
  listConversationsSchema,
  redeemHandoffSchema,
  revokeHandoffSchema,
  searchConversationsSchema,
} from "./schemas.js";
import { aggregateSearch } from "./search.js";
import { conversationToMarkdownWithAnalysis, type ConversationStore } from "./store/index.js";
import type { Connector, Conversation, ConversationInput } from "./types.js";

export const LNKZ_VERSION = "0.2.0";

export function createLnkzMcpServer(
  store: ConversationStore,
  connectors: Connector[],
  publicBaseUrl = process.env.LNKZ_PUBLIC_BASE_URL || "http://localhost:3100",
): McpServer {
  const server = new McpServer(
    { name: "lnkz", version: LNKZ_VERSION },
    {
      instructions: [
        "LNKZ carries conversation context between people, devices, and LLM clients.",
        "Save or import a chat, build a context packet when another model needs the gist,",
        "and create a handoff when a human or a different client needs the whole thread.",
        "Treat handoff tokens as bearer secrets and never echo them into shared output.",
      ].join(" "),
    },
  );
  const coreConnector = connectors.find((connector) => connector.id === "lnkz");
  const shareUrl = (token: string) => `${publicBaseUrl.replace(/\/$/, "")}/share/${token}`;

  // ---------------------------------------------------------------- conversations

  server.registerTool(
    "save_conversation",
    {
      title: "Save portable conversation",
      description: "Stores a normalized conversation from any LLM client or device so it can be searched, packaged, or handed off.",
      inputSchema: conversationInputSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      const conversation = await store.save(conversationInputSchema.parse(input) as ConversationInput);
      return ok(
        `Saved "${conversation.title}" with ${conversation.messages.length} messages as ${conversation.id}.`,
        { conversation },
      );
    },
  );

  server.registerTool(
    "import_conversation",
    {
      title: "Import a chat from another client",
      description: "Normalizes a ChatGPT, Claude, Gemini, LNKZ, Markdown, or plain-text transcript into LNKZ conversations. Format is detected automatically unless one is given.",
      inputSchema: importSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      const parsed = importSchema.parse(input);
      let result;
      try {
        result = importConversations(parsed.payload, parsed.format);
      } catch (error) {
        return toolError(error instanceof Error ? error.message : "Import failed.");
      }

      if (parsed.dryRun) {
        return ok(
          `Detected ${result.format}: ${result.conversations.length} conversation(s), ${countMessages(result.conversations)} messages. Nothing was written.`,
          { format: result.format, warnings: result.warnings, preview: result.conversations.map(previewOf) },
        );
      }

      const saved: Conversation[] = [];
      for (const candidate of result.conversations) {
        saved.push(await store.save({
          ...candidate,
          tags: [...new Set([...(candidate.tags ?? []), ...(parsed.tags ?? [])])],
        }));
      }

      const lines = [
        `Imported ${saved.length} conversation(s) as ${result.format}.`,
        ...saved.map((conversation) => `${conversation.id} — ${conversation.title} (${conversation.messages.length} messages)`),
        ...result.warnings.map((warning) => `Warning: ${warning}`),
      ];
      return ok(lines.join("\n"), {
        format: result.format,
        warnings: result.warnings,
        conversations: saved.map(summaryOf),
      });
    },
  );

  server.registerTool(
    "get_conversation",
    {
      title: "Get conversation",
      description: "Loads a stored conversation with its messages, lineage, extracted decisions, and a portable Markdown transcript.",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const conversation = await store.get(id);
      if (!conversation) return toolError("Conversation not found.");
      const analysis = analyzeConversation(conversation);
      return ok(conversationToMarkdownWithAnalysis(conversation, analysis), { conversation, analysis });
    },
  );

  server.registerTool(
    "list_conversations",
    {
      title: "List conversations",
      description: "Lists stored conversations newest first, optionally filtered by provider, tag, or participant.",
      inputSchema: listConversationsSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const options = listConversationsSchema.parse(input);
      const conversations = await store.list(options);
      const text = conversations.length
        ? conversations.map((item) => `${item.id} — ${item.title} [${item.source.provider}] ${item.messageCount} messages, updated ${item.updatedAt}`).join("\n")
        : "No conversations stored yet.";
      return ok(text, { conversations });
    },
  );

  server.registerTool(
    "search_conversations",
    {
      title: "Search LNKZ conversations",
      description: "Full-text ranked search across saved chats by title, summary, participant, tag, or message content.",
      inputSchema: searchConversationsSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const { query, limit } = searchConversationsSchema.parse(input);
      const matches = await store.search(query, limit);
      const text = matches.length
        ? matches.map((match) => `${match.id} — ${match.title} (relevance ${match.relevance})\n    ${match.snippet}`).join("\n")
        : "No saved conversations matched.";
      return ok(text, { matches });
    },
  );

  server.registerTool(
    "append_messages",
    {
      title: "Append messages to a conversation",
      description: "Adds new turns to an existing conversation, which is how a thread continued in a second client stays one thread.",
      inputSchema: appendMessagesSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      const { conversationId, messages } = appendMessagesSchema.parse(input);
      const conversation = await store.appendMessages(conversationId, messages);
      if (!conversation) return toolError("Conversation not found.");
      return ok(`Appended ${messages.length} message(s); ${conversation.messages.length} total.`, { conversation });
    },
  );

  registerSurfaces(server, store);

  server.registerTool(
    "delete_conversation",
    {
      title: "Delete conversation",
      description: "Permanently removes a conversation, its messages, and its handoffs.",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const removed = await store.remove(id);
      return removed ? ok(`Deleted ${id}.`, { id }) : toolError("Conversation not found.");
    },
  );

  // -------------------------------------------------------------------- handoffs

  server.registerTool(
    "create_handoff",
    {
      title: "Create conversation handoff",
      description: "Mints an expiring, use-limited bearer link that another person, device, or LLM client can redeem for portable context. Optionally redacts secrets before the packet leaves.",
      inputSchema: createHandoffSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      const options = createHandoffSchema.parse(input);
      try {
        const handoff = await store.createHandoff(options);
        return ok(
          `Handoff ${handoff.id} expires ${handoff.expiresAt} after up to ${handoff.maxUses} use(s): ${shareUrl(handoff.token)}`,
          { ...handoff, shareUrl: shareUrl(handoff.token) },
        );
      } catch (error) {
        return toolError(error instanceof Error ? error.message : "Could not create handoff.");
      }
    },
  );

  server.registerTool(
    "redeem_handoff",
    {
      title: "Redeem conversation handoff",
      description: "Loads the portable packet behind an unexpired LNKZ handoff token, including the transcript and the extracted decisions and open questions.",
      inputSchema: redeemHandoffSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      const { token } = redeemHandoffSchema.parse(input);
      const packet = await store.redeemHandoff(token);
      if (!packet) return toolError("Handoff is invalid, revoked, exhausted, or expired.");
      return ok(conversationToMarkdownWithAnalysis(packet.conversation, packet.analysis), { packet });
    },
  );

  server.registerTool(
    "continue_handoff",
    {
      title: "Continue a handed-off conversation",
      description: "Redeems a handoff and stores the continuation as a new conversation in this client, linked back to the original so the chain stays walkable.",
      inputSchema: continueConversationSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      const options = continueConversationSchema.parse(input);
      const packet = await store.redeemHandoff(options.token);
      if (!packet) return toolError("Handoff is invalid, revoked, exhausted, or expired.");

      const parent = packet.conversation;
      const continuation = await store.save({
        title: options.title || `${parent.title} (continued in ${options.provider})`,
        summary: parent.summary,
        source: { provider: options.provider, app: options.app },
        participants: parent.participants,
        tags: [...new Set([...parent.tags, "continuation"])],
        messages: [...parent.messages, ...options.messages],
        lineage: {
          parentId: parent.id,
          rootId: parent.lineage?.rootId ?? parent.id,
          handoffId: packet.handoff.id,
          continuedBy: options.provider,
        },
      });

      return ok(
        `Continued ${parent.id} as ${continuation.id} in ${options.provider}, carrying ${parent.messages.length} prior message(s).`,
        { conversation: continuation, parentId: parent.id },
      );
    },
  );

  server.registerTool(
    "revoke_handoff",
    {
      title: "Revoke handoff",
      description: "Immediately invalidates a handoff link that has already been shared.",
      inputSchema: revokeHandoffSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (input) => {
      const { handoffId } = revokeHandoffSchema.parse(input);
      const revoked = await store.revokeHandoff(handoffId);
      return revoked ? ok(`Revoked ${handoffId}.`, { handoffId }) : toolError("Handoff not found or already revoked.");
    },
  );

  server.registerTool(
    "list_handoffs",
    {
      title: "List handoffs",
      description: "Shows issued handoffs with their expiry, remaining uses, audience, and revocation state. Tokens are never returned.",
      inputSchema: { conversationId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ conversationId }) => {
      const handoffs = await store.listHandoffs(conversationId);
      const text = handoffs.length
        ? handoffs.map((handoff) => `${handoff.id} — ${handoff.active ? "active" : "inactive"}, ${handoff.uses}/${handoff.maxUses} uses, expires ${handoff.expiresAt}${handoff.audience ? `, for ${handoff.audience}` : ""}`).join("\n")
        : "No handoffs issued.";
      return ok(text, { handoffs });
    },
  );

  // ---------------------------------------------------------------- intelligence

  server.registerTool(
    "build_context_packet",
    {
      title: "Build a context packet",
      description: "Assembles a token-budgeted brief from stored conversations and connected sources: decisions, open questions, action items, a recent excerpt, and any contradictions between chats. Use this instead of pasting a whole transcript.",
      inputSchema: contextPacketSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const request = contextPacketSchema.parse(input);
      if (!request.query && !request.conversationIds?.length) {
        return toolError("Provide a query, one or more conversationIds, or both.");
      }
      const packet = await buildContextPacket(store, connectors, request);
      return ok(packet.markdown, { packet });
    },
  );

  server.registerTool(
    "analyze_conversation",
    {
      title: "Analyze a conversation",
      description: "Extracts decisions, open questions, action items, cited facts, and topics from one stored conversation without calling a model.",
      inputSchema: analyzeSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const { conversationId } = analyzeSchema.parse(input);
      const conversation = await store.get(conversationId);
      if (!conversation) return toolError("Conversation not found.");
      const analysis = analyzeConversation(conversation);
      const lines = [
        `${conversation.title} — ${analysis.messageCount} messages, roughly ${analysis.approxTokens} tokens.`,
        section("Decisions", analysis.decisions.map((claim) => claim.text)),
        section("Open questions", analysis.openQuestions.map((claim) => claim.text)),
        section("Action items", analysis.actionItems.map((claim) => claim.text)),
        section("Topics", analysis.topics),
      ].filter(Boolean);
      return ok(lines.join("\n\n"), { analysis });
    },
  );

  server.registerTool(
    "find_conflicts",
    {
      title: "Find contradicting decisions",
      description: "Compares decisions across recent conversations and reports pairs that appear to disagree. Heuristic: it surfaces candidates for review, it does not adjudicate them.",
      inputSchema: conflictSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const { limit, threshold } = conflictSchema.parse(input);
      const conversations = await loadRecent(store, limit);
      const conflicts = detectConflicts(conversations, threshold);
      const text = conflicts.length
        ? conflicts.map((conflict) => `${conflict.reason}\n  - ${conflict.left.title}: ${conflict.left.text}\n  - ${conflict.right.title}: ${conflict.right.text}`).join("\n\n")
        : `No contradicting decisions found across ${conversations.length} conversation(s).`;
      return ok(text, { conflicts, scanned: conversations.length });
    },
  );

  server.registerTool(
    "find_duplicates",
    {
      title: "Find near-duplicate conversations",
      description: "Reports conversations whose transcripts overlap heavily, which happens whenever the same chat is relayed through more than one client.",
      inputSchema: duplicateSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const { limit, threshold } = duplicateSchema.parse(input);
      const conversations = await loadRecent(store, limit);
      const duplicates = detectDuplicates(conversations, threshold);
      const text = duplicates.length
        ? duplicates.map((pair) => `${pair.similarity}: ${pair.left.title} (${pair.left.conversationId}) ~ ${pair.right.title} (${pair.right.conversationId})`).join("\n")
        : `No near-duplicates found across ${conversations.length} conversation(s).`;
      return ok(text, { duplicates, scanned: conversations.length });
    },
  );

  // ------------------------------------------------------------------ federation

  server.registerTool(
    "search_context",
    {
      title: "Search connected context",
      description: "Searches LNKZ conversations plus every configured connector (Slack, Jira, Figma, documentation feeds, and any federated MCP server) in one call, reporting per-source failures instead of hiding them.",
      inputSchema: contextSearchSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const request = contextSearchSchema.parse(input);
      const result = await aggregateSearch(connectors, request);
      const lines = result.items.length
        ? result.items.map((item) => `[${item.source}] ${item.title}: ${item.text}${item.url ? ` (${item.url})` : ""}`)
        : ["No connected source returned a match."];
      if (result.errors.length) {
        lines.push(`Connector errors: ${result.errors.map((error) => `${error.source}: ${error.message}`).join("; ")}`);
      }
      return ok(lines.join("\n\n"), { ...result });
    },
  );

  server.registerTool(
    "list_connectors",
    {
      title: "List connector status",
      description: "Shows which context sources are configured and which are disabled, with the reason.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const statuses = connectorStatuses(coreConnector);
      const text = statuses
        .map((status) => `${status.label}: ${status.configured ? "configured" : "disabled"}. ${status.detail}`)
        .join("\n");
      return ok(text, { connectors: statuses });
    },
  );

  server.registerTool(
    "workspace_stats",
    {
      title: "Workspace statistics",
      description: "Counts stored conversations and messages, the providers they came from, and active handoffs.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const stats = await store.stats();
      const providers = stats.providers.map((entry) => `${entry.provider} (${entry.count})`).join(", ") || "none";
      return ok(
        `${stats.conversations} conversations, ${stats.messages} messages, ${stats.activeHandoffs} active handoffs.\nProviders: ${providers}`,
        { stats },
      );
    },
  );

  server.registerTool(
    "audit_log",
    {
      title: "Read the audit log",
      description: "Returns recent LNKZ events: saves, imports, handoff creation, redemption, rejection, and revocation.",
      inputSchema: auditSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const { limit } = auditSchema.parse(input);
      const events = await store.listEvents(limit);
      const text = events.length
        ? events.map((event) => `${event.at} ${event.kind}${event.conversationId ? ` conversation=${event.conversationId}` : ""}${event.handoffId ? ` handoff=${event.handoffId}` : ""}`).join("\n")
        : "No events recorded.";
      return ok(text, { events });
    },
  );

  // ------------------------------------------------------------------- resources

  server.registerResource(
    "connector-status",
    "lnkz://connectors",
    { title: "LNKZ connector status", description: "Configured and disabled connector inventory.", mimeType: "application/json" },
    async () => jsonResource("lnkz://connectors", { connectors: connectorStatuses(coreConnector) }),
  );

  server.registerResource(
    "workspace-stats",
    "lnkz://stats",
    { title: "LNKZ workspace statistics", description: "Conversation, message, provider, and handoff counts.", mimeType: "application/json" },
    async () => jsonResource("lnkz://stats", await store.stats()),
  );

  server.registerResource(
    "recent-conversations",
    "lnkz://conversations",
    { title: "Recent LNKZ conversations", description: "The 25 most recently updated conversations.", mimeType: "application/json" },
    async () => jsonResource("lnkz://conversations", { conversations: await store.list({ limit: 25 }) }),
  );

  server.registerResource(
    "conversation",
    new ResourceTemplate("lnkz://conversation/{id}", { list: undefined }),
    { title: "LNKZ conversation", description: "One conversation as a portable Markdown transcript.", mimeType: "text/markdown" },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const conversation = id ? await store.get(id) : null;
      if (!conversation) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Conversation not found." }] };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/markdown",
          text: conversationToMarkdownWithAnalysis(conversation, analyzeConversation(conversation)),
        }],
      };
    },
  );

  // --------------------------------------------------------------------- prompts

  server.registerPrompt(
    "continue_shared_conversation",
    {
      title: "Continue shared conversation",
      description: "Resume a LNKZ handoff while preserving facts, decisions, sources, and unanswered questions.",
      argsSchema: { token: z.string().min(20), goal: z.string().min(1).optional() },
    },
    async ({ token, goal }) => userPrompt(
      `Call redeem_handoff with token ${token}. Continue from that context${goal ? ` toward this goal: ${goal}` : ""}. `
      + "Preserve source attribution, distinguish facts from assumptions, restate the open questions before answering them, "
      + "and when you are done call continue_handoff so the thread stays linked to the original.",
    ),
  );

  server.registerPrompt(
    "research_brief",
    {
      title: "Cross-source research brief",
      description: "Builds a sourced brief from conversations and connected work systems.",
      argsSchema: { topic: z.string().min(1) },
    },
    async ({ topic }) => userPrompt(
      `Call build_context_packet with query "${topic}". Write a brief that separates verified facts, decisions, assumptions, and open questions. `
      + "Cite conversation ids and source URLs, and report unavailable connectors rather than filling the gap.",
    ),
  );

  server.registerPrompt(
    "prepare_handoff",
    {
      title: "Prepare a conversation for handoff",
      description: "Summarize a conversation, then mint a scoped handoff for a named recipient.",
      argsSchema: { conversationId: z.string().uuid(), audience: z.string().min(1), ttlMinutes: z.string().optional() },
    },
    async ({ conversationId, audience, ttlMinutes }) => userPrompt(
      `Call analyze_conversation for ${conversationId} and summarize what the recipient needs: the decision, the reason, and what is still open. `
      + `Then call create_handoff for that conversation with audience "${audience}"`
      + `${ttlMinutes ? `, ttlMinutes ${ttlMinutes}` : ""}, redact true, and maxUses 3. `
      + "Give the recipient the share URL and the summary together, and say when it expires.",
    ),
  );

  server.registerPrompt(
    "reconcile_conflicts",
    {
      title: "Reconcile contradicting decisions",
      description: "Review flagged contradictions and propose which decision stands.",
      argsSchema: {},
    },
    async () => userPrompt(
      "Call find_conflicts. For each pair, read both conversations with get_conversation, decide which decision is more recent and better supported, "
      + "and propose a single reconciled statement. Say plainly where the evidence is too thin to choose.",
    ),
  );

  return server;
}

async function loadRecent(store: ConversationStore, limit: number): Promise<Conversation[]> {
  const summaries = await store.list({ limit });
  const conversations: Conversation[] = [];
  for (const summary of summaries) {
    const conversation = await store.get(summary.id);
    if (conversation) conversations.push(conversation);
  }
  return conversations;
}

function countMessages(conversations: ConversationInput[]): number {
  return conversations.reduce((total, conversation) => total + conversation.messages.length, 0);
}

function previewOf(conversation: ConversationInput) {
  return {
    title: conversation.title,
    provider: conversation.source.provider,
    messages: conversation.messages.length,
    firstMessage: conversation.messages[0]?.content.slice(0, 200),
  };
}

function summaryOf(conversation: Conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    provider: conversation.source.provider,
    messageCount: conversation.messages.length,
    updatedAt: conversation.updatedAt,
  };
}

function section(heading: string, values: string[]): string {
  if (!values.length) return "";
  return `${heading}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function ok(text: string, structuredContent: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

function jsonResource(uri: string, payload: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }] };
}

function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}
