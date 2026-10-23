import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationGraph, graphToMarkdown } from "../src/graph/index.js";
import type { Conversation } from "../src/types.js";

function conversation(
  id: string,
  title: string,
  contents: string[],
  extra: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    version: 1,
    title,
    source: { provider: "chatgpt" },
    participants: [],
    tags: [],
    messages: contents.map((content, index) => ({
      id: `${id}-m${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content,
      createdAt: "2026-03-01T00:00:00.000Z",
    })),
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...extra,
  };
}

const storageA = conversation("a1", "Storage decision", [
  "Should the conversation store be Postgres or SQLite for the relay?",
  "We decided to use SQLite for the conversation store. It removes the deployment dependency.",
]);

const storageB = conversation("b2", "Storage revisited", [
  "Revisiting the conversation store choice for the relay.",
  "We decided to use Postgres for the conversation store after all.",
]);

const unrelated = conversation("c3", "Standup time", [
  "Can we move standup?",
  "We decided to move standup to Thursday mornings.",
]);

test("conversations, their decisions and their open questions all become nodes", () => {
  const graph = buildConversationGraph([storageA]);

  assert.equal(graph.stats.conversations, 1);
  assert.ok(graph.stats.decisions >= 1, "the decision was extracted");
  assert.ok(graph.stats.questions >= 1, "the open question was extracted");

  const decided = graph.edges.filter((edge) => edge.kind === "decided");
  assert.equal(decided[0].from, "conversation:a1");
  assert.ok(decided[0].reason.length > 0, "every edge explains itself");
});

test("shared topics link conversations, and single-conversation terms do not become nodes", () => {
  const graph = buildConversationGraph([storageA, storageB, unrelated]);
  const topics = graph.nodes.filter((node) => node.kind === "topic");

  assert.ok(topics.length > 0, "the two storage conversations share subject matter");
  assert.ok(topics.every((topic) => topic.weight >= 2), "a topic in one conversation adds no structure");
  assert.ok(topics.some((topic) => topic.label === "store" || topic.label === "conversation"));
});

test("contradicting decisions are joined to each other, not to their conversations", () => {
  const graph = buildConversationGraph([storageA, storageB]);
  const contradictions = graph.edges.filter((edge) => edge.kind === "contradicts");

  assert.ok(contradictions.length >= 1, "SQLite versus Postgres is a contradiction");
  assert.ok(contradictions[0].from.startsWith("decision:"), "the edge points at the claim");
  assert.ok(contradictions[0].to.startsWith("decision:"));
});

test("lineage is recorded as an edge, because it is known rather than inferred", () => {
  const continued = conversation("d4", "Storage continued", ["Picking this up on my laptop."], {
    lineage: { parentId: "a1", rootId: "a1", continuedBy: "claude" },
  });
  const graph = buildConversationGraph([storageA, continued]);
  const lineage = graph.edges.find((edge) => edge.kind === "continues");

  assert.ok(lineage);
  assert.equal(lineage.from, "conversation:d4");
  assert.equal(lineage.to, "conversation:a1");
  assert.ok(lineage.weight > 1, "a recorded link outweighs an inferred one");
  assert.match(lineage.reason, /claude/);
});

test("lineage pointing outside the loaded set is not turned into a dangling edge", () => {
  const orphan = conversation("e5", "Continued from elsewhere", ["Carrying on."], {
    lineage: { parentId: "not-loaded" },
  });
  const graph = buildConversationGraph([orphan]);
  assert.equal(graph.edges.filter((edge) => edge.kind === "continues").length, 0);
});

test("a conversation connected only to its own claims counts as isolated", () => {
  const graph = buildConversationGraph([unrelated]);
  assert.deepEqual(graph.stats.isolated.map((node) => node.label), ["Standup time"]);

  const connected = buildConversationGraph([storageA, storageB]);
  assert.equal(connected.stats.isolated.length, 0, "shared topics connect these two");
});

test("the summary names the hubs and the contradictions", () => {
  const markdown = graphToMarkdown(buildConversationGraph([storageA, storageB, unrelated]));
  assert.match(markdown, /# LNKZ conversation graph/);
  assert.match(markdown, /## Most connected/);
  assert.match(markdown, /## Contradictions/);
});

test("an empty corpus produces an empty graph rather than throwing", () => {
  const graph = buildConversationGraph([]);
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.equal(graph.stats.conversations, 0);
});
