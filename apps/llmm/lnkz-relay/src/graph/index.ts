import { analyzeConversation, extractTopics } from "../intel/analyze.js";
import { detectConflicts, detectDuplicates } from "../intel/conflict.js";
import type { Conversation } from "../types.js";

/**
 * A graph over the conversation corpus.
 *
 * Search answers "which chat mentioned this". It cannot answer "what does this
 * corpus know", "which decision does everything else depend on", or "where did
 * this conclusion actually come from". Those are questions about structure, and
 * structure needs a graph.
 *
 * Everything here is derived from the deterministic extraction in intel/, so the
 * graph is reproducible: the same conversations always produce the same graph,
 * with no model call and no embedding service. Every edge carries the reason it
 * exists, because an edge you cannot explain is an edge you cannot trust.
 */

export type NodeKind = "conversation" | "decision" | "question" | "topic";
export type EdgeKind = "decided" | "asks" | "about" | "continues" | "similar" | "contradicts";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** The conversation this node belongs to. Absent on topics, which are shared. */
  conversationId?: string;
  weight: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  /** Why this edge exists, in words. */
  reason: string;
}

export interface GraphStats {
  conversations: number;
  decisions: number;
  questions: number;
  topics: number;
  edges: number;
  /** Nodes with the most connections. These are what the corpus is actually about. */
  hubs: { id: string; label: string; kind: NodeKind; degree: number }[];
  /** Conversations connected to nothing else. Usually one-offs, sometimes orphans worth linking. */
  isolated: { id: string; label: string }[];
}

export interface ConversationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  generatedAt: string;
}

export interface GraphOptions {
  /** Topics appearing in fewer conversations than this are noise, not structure. */
  minTopicConversations?: number;
  /** Jaccard floor for calling two conversations near-duplicates. */
  duplicateThreshold?: number;
  /** Cosine floor for calling two decisions contradictory. */
  conflictThreshold?: number;
  /** Cap on topic nodes, highest shared first. */
  maxTopics?: number;
}

export function buildConversationGraph(
  conversations: Conversation[],
  options: GraphOptions = {},
): ConversationGraph {
  const minTopicConversations = Math.max(2, options.minTopicConversations ?? 2);
  const maxTopics = Math.max(1, options.maxTopics ?? 40);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const claimNodeByText = new Map<string, string>();

  // Conversations, and the claims each one made.
  for (const conversation of conversations) {
    const analysis = analyzeConversation(conversation);
    nodes.push({
      id: conversationNode(conversation.id),
      kind: "conversation",
      label: conversation.title,
      conversationId: conversation.id,
      weight: conversation.messages.length,
      metadata: {
        provider: conversation.source.provider,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        approxTokens: analysis.approxTokens,
      },
    });

    analysis.decisions.forEach((claim, index) => {
      const id = `decision:${conversation.id}:${index}`;
      claimNodeByText.set(claim.text, id);
      nodes.push({
        id,
        kind: "decision",
        label: claim.text,
        conversationId: conversation.id,
        weight: 1,
        metadata: { messageId: claim.messageId, author: claim.author },
      });
      edges.push({
        from: conversationNode(conversation.id),
        to: id,
        kind: "decided",
        weight: 1,
        reason: "This conversation settled this.",
      });
    });

    analysis.openQuestions.slice(0, 10).forEach((claim, index) => {
      const id = `question:${conversation.id}:${index}`;
      nodes.push({
        id,
        kind: "question",
        label: claim.text,
        conversationId: conversation.id,
        weight: 1,
        metadata: { messageId: claim.messageId },
      });
      edges.push({
        from: conversationNode(conversation.id),
        to: id,
        kind: "asks",
        weight: 1,
        reason: "This conversation left this open.",
      });
    });
  }

  // Lineage: a thread continued in another client is the strongest link there is,
  // because it is recorded rather than inferred.
  const known = new Set(conversations.map((conversation) => conversation.id));
  for (const conversation of conversations) {
    const parentId = conversation.lineage?.parentId;
    if (!parentId || !known.has(parentId)) continue;
    edges.push({
      from: conversationNode(conversation.id),
      to: conversationNode(parentId),
      kind: "continues",
      weight: 3,
      reason: `Continued from the earlier thread${conversation.lineage?.continuedBy ? ` in ${conversation.lineage.continuedBy}` : ""}.`,
    });
  }

  // Topics, but only shared ones. A term appearing in a single conversation adds
  // a node and no structure, which makes the graph bigger and less informative.
  const topicMembers = new Map<string, string[]>();
  for (const conversation of conversations) {
    for (const topic of extractTopics(conversation, 15)) {
      const members = topicMembers.get(topic) ?? [];
      members.push(conversation.id);
      topicMembers.set(topic, members);
    }
  }

  const sharedTopics = [...topicMembers.entries()]
    .filter(([, members]) => members.length >= minTopicConversations)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, maxTopics);

  for (const [topic, members] of sharedTopics) {
    const id = `topic:${topic}`;
    nodes.push({ id, kind: "topic", label: topic, weight: members.length });
    for (const conversationId of members) {
      edges.push({
        from: conversationNode(conversationId),
        to: id,
        kind: "about",
        weight: 1,
        reason: `Shared with ${members.length - 1} other conversation(s).`,
      });
    }
  }

  // Near duplicates, which a relay accumulates fast: the same chat arriving twice
  // through two different clients.
  for (const pair of detectDuplicates(conversations, options.duplicateThreshold ?? 0.6)) {
    edges.push({
      from: conversationNode(pair.left.conversationId),
      to: conversationNode(pair.right.conversationId),
      kind: "similar",
      weight: pair.similarity,
      reason: `Transcripts overlap at ${Math.round(pair.similarity * 100)} percent.`,
    });
  }

  // Contradictions, between the decision nodes themselves rather than between the
  // conversations, so the graph points at the two claims that actually disagree.
  for (const conflict of detectConflicts(conversations, options.conflictThreshold ?? 0.45)) {
    const from = claimNodeByText.get(conflict.left.text);
    const to = claimNodeByText.get(conflict.right.text);
    if (!from || !to) continue;
    edges.push({ from, to, kind: "contradicts", weight: conflict.similarity, reason: conflict.reason });
  }

  return {
    nodes,
    edges,
    stats: summarize(nodes, edges),
    generatedAt: new Date().toISOString(),
  };
}

/** A short readable account of what the graph shows, for a client to display. */
export function graphToMarkdown(graph: ConversationGraph): string {
  const lines = [
    "# LNKZ conversation graph",
    "",
    `${graph.stats.conversations} conversations, ${graph.stats.decisions} decisions, `
    + `${graph.stats.questions} open questions, ${graph.stats.topics} shared topics, ${graph.stats.edges} edges.`,
    "",
  ];

  if (graph.stats.hubs.length) {
    lines.push("## Most connected", "");
    for (const hub of graph.stats.hubs) {
      lines.push(`- ${hub.label} (${hub.kind}, ${hub.degree} connections)`);
    }
    lines.push("");
  }

  const contradictions = graph.edges.filter((edge) => edge.kind === "contradicts");
  if (contradictions.length) {
    lines.push("## Contradictions", "");
    for (const edge of contradictions.slice(0, 8)) {
      lines.push(`- ${edge.reason}`);
      lines.push(`  - ${labelOf(graph, edge.from)}`);
      lines.push(`  - ${labelOf(graph, edge.to)}`);
    }
    lines.push("");
  }

  const duplicates = graph.edges.filter((edge) => edge.kind === "similar");
  if (duplicates.length) {
    lines.push("## Likely duplicates", "");
    for (const edge of duplicates.slice(0, 8)) {
      lines.push(`- ${labelOf(graph, edge.from)} and ${labelOf(graph, edge.to)}: ${edge.reason}`);
    }
    lines.push("");
  }

  if (graph.stats.isolated.length) {
    lines.push("## Connected to nothing else", "");
    for (const node of graph.stats.isolated.slice(0, 10)) lines.push(`- ${node.label}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function summarize(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const byKind = (kind: NodeKind) => nodes.filter((node) => node.kind === kind);

  return {
    conversations: byKind("conversation").length,
    decisions: byKind("decision").length,
    questions: byKind("question").length,
    topics: byKind("topic").length,
    edges: edges.length,
    hubs: nodes
      .map((node) => ({ id: node.id, label: node.label, kind: node.kind, degree: degree.get(node.id) ?? 0 }))
      .filter((entry) => entry.degree > 0)
      .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
      .slice(0, 10),
    isolated: byKind("conversation")
      .filter((node) => connectionsBeyondOwnClaims(node, edges) === 0)
      .map((node) => ({ id: node.id, label: node.label })),
  };
}

/**
 * A conversation is always joined to its own decisions and questions, so counting
 * raw degree would say nothing is ever isolated. What matters is whether it
 * connects to anything outside itself.
 */
function connectionsBeyondOwnClaims(node: GraphNode, edges: GraphEdge[]): number {
  return edges.filter((edge) => {
    if (edge.kind === "decided" || edge.kind === "asks") return false;
    return edge.from === node.id || edge.to === node.id;
  }).length;
}

function labelOf(graph: ConversationGraph, id: string): string {
  return graph.nodes.find((node) => node.id === id)?.label ?? id;
}

function conversationNode(id: string): string {
  return `conversation:${id}`;
}
