import assert from "node:assert/strict";
import test from "node:test";
import { detectFormat, importConversations } from "../src/import/index.js";

const chatGptExport = [{
  title: "Rollout plan",
  create_time: 1_735_689_600,
  current_node: "c2",
  mapping: {
    root: { id: "root", parent: null, message: null, children: ["u1"] },
    u1: {
      id: "u1",
      parent: "root",
      message: {
        id: "u1",
        author: { role: "user" },
        create_time: 1_735_689_601,
        content: { content_type: "text", parts: ["Which rollout should we use?"] },
      },
    },
    // An abandoned edit branch. It must not appear in the import.
    a1: {
      id: "a1",
      parent: "u1",
      message: {
        id: "a1",
        author: { role: "assistant" },
        content: { content_type: "text", parts: ["Discarded draft answer."] },
      },
    },
    c2: {
      id: "c2",
      parent: "u1",
      message: {
        id: "c2",
        author: { role: "assistant" },
        create_time: 1_735_689_602,
        content: { content_type: "text", parts: ["We decided to use the staged rollout."] },
        metadata: { model_slug: "gpt-4o" },
      },
    },
  },
}];

const claudeExport = [{
  uuid: "3f0d5a2e-0000-4000-8000-000000000000",
  name: "Schema review",
  created_at: "2026-02-01T10:00:00Z",
  chat_messages: [
    { uuid: "m1", sender: "human", text: "Is the index on updated_at enough?", created_at: "2026-02-01T10:00:01Z" },
    { uuid: "m2", sender: "assistant", content: [{ type: "text", text: "Add a composite index for the provider filter." }] },
  ],
}];

test("format detection separates the vendor export shapes", () => {
  assert.equal(detectFormat(JSON.stringify(chatGptExport)), "chatgpt");
  assert.equal(detectFormat(JSON.stringify(claudeExport)), "claude");
  assert.equal(detectFormat(JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi there" }] }] })), "gemini");
  assert.equal(detectFormat("# Title\n\n### User\n\nhello there"), "markdown");
  assert.equal(detectFormat("User: hello\nAssistant: hi"), "text");
});

test("a ChatGPT export follows current_node and drops abandoned branches", () => {
  const result = importConversations(JSON.stringify(chatGptExport));
  assert.equal(result.format, "chatgpt");
  assert.equal(result.conversations.length, 1);

  const conversation = result.conversations[0];
  assert.equal(conversation.title, "Rollout plan");
  assert.equal(conversation.source.provider, "chatgpt");
  assert.deepEqual(conversation.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(conversation.messages.some((message) => message.content.includes("Discarded draft")), false);
  assert.equal(conversation.messages[1].createdAt, new Date(1_735_689_602 * 1000).toISOString());
});

test("a Claude export reads both the text field and the typed content blocks", () => {
  const result = importConversations(JSON.stringify(claudeExport));
  assert.equal(result.format, "claude");
  const conversation = result.conversations[0];
  assert.equal(conversation.title, "Schema review");
  assert.equal(conversation.messages[0].role, "user");
  assert.equal(conversation.messages[1].content, "Add a composite index for the provider filter.");
});

test("a Gemini request body imports as a conversation", () => {
  const result = importConversations(JSON.stringify({
    contents: [
      { role: "user", parts: [{ text: "Summarize the launch thread." }] },
      { role: "model", parts: [{ text: "The team chose the staged rollout." }] },
    ],
  }));
  assert.equal(result.format, "gemini");
  assert.deepEqual(result.conversations[0].messages.map((message) => message.role), ["user", "assistant"]);
});

test("a Markdown transcript splits on speaker headings and keeps fenced code intact", () => {
  const payload = [
    "# Index review",
    "",
    "## Transcript",
    "",
    "### User",
    "",
    "Here is the query plan:",
    "",
    "```sql",
    "### not a heading inside a fence",
    "SELECT 1;",
    "```",
    "",
    "### Assistant",
    "",
    "We decided to add the composite index.",
  ].join("\n");

  const result = importConversations(payload);
  assert.equal(result.format, "markdown");
  const conversation = result.conversations[0];
  assert.equal(conversation.title, "Index review");
  assert.equal(conversation.messages.length, 2);
  assert.ok(conversation.messages[0].content.includes("### not a heading inside a fence"));
  assert.equal(conversation.messages[1].role, "assistant");
});

test("a labeled paste splits on speaker labels", () => {
  const result = importConversations("User: what changed?\nAssistant: the storage layer moved to SQLite.");
  assert.equal(result.format, "text");
  assert.deepEqual(result.conversations[0].messages.map((message) => message.role), ["user", "assistant"]);
});

test("an unlabeled paste is kept whole rather than guessed at", () => {
  const result = importConversations("Just a block of notes with no speakers at all in it.");
  assert.equal(result.conversations[0].messages.length, 1);
  assert.ok(result.warnings.length > 0);
});

test("a LNKZ packet can be re-imported so a handoff becomes a conversation elsewhere", () => {
  const packet = {
    format: "lnkz.conversation.v1",
    conversation: {
      id: "8b6f2a1c-0000-4000-8000-000000000000",
      version: 1,
      title: "Relayed thread",
      source: { provider: "claude", app: "desktop" },
      participants: ["Nihal"],
      tags: ["launch"],
      messages: [{ id: "m1", role: "user", content: "Carry this forward.", createdAt: "2026-03-01T00:00:00Z" }],
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    },
  };
  const result = importConversations(JSON.stringify(packet));
  assert.equal(result.format, "lnkz");
  assert.equal(result.conversations[0].source.provider, "claude");
  assert.ok(result.conversations[0].tags?.includes("imported"));
});

test("bad input fails loudly instead of storing an empty conversation", () => {
  assert.throws(() => importConversations("", "auto"), /Nothing to import/);
  assert.throws(() => importConversations("{not json", "chatgpt"), /not valid JSON/);
  assert.throws(() => importConversations(JSON.stringify([{ mapping: {}, current_node: "" }]), "chatgpt"), /No conversations found/);
});

test("the chat-completions message array imports, which covers far more than OpenAI", () => {
  const result = importConversations(JSON.stringify({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are terse." },
      { role: "user", content: "Which store should the relay use?" },
      { role: "assistant", content: "SQLite. It removes the deployment dependency." },
    ],
  }));

  assert.equal(result.format, "openai");
  const conversation = result.conversations[0];
  assert.deepEqual(conversation.messages.map((message) => message.role), ["system", "user", "assistant"]);
  assert.equal(conversation.source.app, "chat-completions/gpt-4o");
});

test("a bare message array is one conversation, not many empty ones", () => {
  const result = importConversations(JSON.stringify([
    { role: "user", content: "First question here." },
    { role: "assistant", content: "First answer here." },
  ]));
  assert.equal(result.format, "openai");
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].messages.length, 2);
});

test("a batch of message arrays imports as separate conversations", () => {
  const result = importConversations(JSON.stringify([
    { messages: [{ role: "user", content: "Thread one opening line." }] },
    { messages: [{ role: "user", content: "Thread two opening line." }] },
  ]));
  assert.equal(result.conversations.length, 2);
});

test("an assistant turn that only calls a tool keeps its place in the thread", () => {
  const result = importConversations(JSON.stringify({
    messages: [
      { role: "user", content: "Search the league." },
      { role: "assistant", content: null, tool_calls: [{ type: "function", function: { name: "search_league" } }] },
      { role: "tool", content: "Two results." },
    ],
  }));
  const contents = result.conversations[0].messages.map((message) => message.content);
  assert.deepEqual(contents, ["Search the league.", "[tool call: search_league]", "Two results."]);
});

test("an unknown export is located structurally rather than guessed at by vendor", () => {
  const result = importConversations(JSON.stringify({
    meta: { app: "some-new-assistant", version: 3 },
    thread: {
      title: "Deployment questions",
      entries: [
        { speaker: "user", body: "Where does the database live in production?" },
        { speaker: "assistant", body: "On a mounted volume, so a redeploy does not wipe it." },
        { speaker: "user", body: "And the backups?" },
      ],
    },
  }));

  assert.equal(result.format, "generic");
  const conversation = result.conversations[0];
  assert.equal(conversation.title, "Deployment questions");
  assert.deepEqual(conversation.messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.ok(result.warnings.some((warning) => warning.includes("not recognized")));
});

test("prompt and response pairs become two turns each", () => {
  const result = importConversations(JSON.stringify({
    session: {
      name: "Copilot session",
      turns: [
        { prompt: "Why is this test failing?", response: "The fixture is stale." },
        { prompt: "How do I refresh it?", response: "Re-run the generator." },
      ],
    },
  }));

  assert.equal(result.format, "generic");
  const messages = result.conversations[0].messages;
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(messages[0].content, "Why is this test failing?");
  assert.equal(messages[1].content, "The fixture is stale.");
});

test("the structural importer ignores arrays that are not conversations", () => {
  assert.throws(
    () => importConversations(JSON.stringify({
      users: [{ id: 1, email: "a@example.com" }, { id: 2, email: "b@example.com" }],
      settings: { theme: "dark", retries: 3 },
    }), "generic"),
    /No conversations found/,
  );
});

test("a named vendor format is never handed to the structural importer", () => {
  const claudeShaped = JSON.stringify([{
    uuid: "9f0d5a2e-0000-4000-8000-000000000000",
    name: "Precedence check",
    chat_messages: [{ uuid: "m1", sender: "human", text: "This must import as claude." }],
  }]);
  assert.equal(detectFormat(claudeShaped), "claude");
});
