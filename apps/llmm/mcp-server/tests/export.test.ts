import assert from "node:assert/strict";
import test from "node:test";
import { EXPORT_FORMATS, REIMPORTABLE_FORMATS, exportConversation, toOpenAi } from "../src/export/index.js";
import { detectFormat, importConversations } from "../src/import/index.js";
import type { Conversation } from "../src/types.js";

function conversation(): Conversation {
  return {
    id: "6f1b2c3d-0000-4000-8000-000000000000",
    version: 1,
    title: "Storage decision",
    summary: "Chose SQLite over Postgres for the first release.",
    source: { provider: "chatgpt", app: "desktop" },
    participants: ["Nihal"],
    tags: ["launch"],
    messages: [
      { id: "m1", role: "user", content: "Postgres or SQLite for the relay?", createdAt: "2026-03-01T10:00:00.000Z" },
      {
        id: "m2",
        role: "assistant",
        content: "We decided to use SQLite. It removes the deployment dependency.\n\nI will write the migration.",
        createdAt: "2026-03-01T10:00:05.000Z",
      },
      { id: "m3", role: "user", content: "Good. What is still open?", createdAt: "2026-03-01T10:01:00.000Z" },
    ],
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:01:00.000Z",
  };
}

function bodies(source: Conversation) {
  return Object.fromEntries(REIMPORTABLE_FORMATS.map((format) => [format, exportConversation(source, format).body]));
}

test("every export format produces content, a mime type, and a filename", () => {
  const source = conversation();
  for (const format of EXPORT_FORMATS) {
    const result = exportConversation(source, format);
    assert.ok(result.body.trim().length > 0, `${format} produced nothing`);
    assert.ok(result.mimeType.includes("/"), `${format} has no mime type`);
    assert.match(result.filename, /^storage-decision\./, `${format} filename is wrong: ${result.filename}`);
  }
});

test("LaTeX is declared one-way, because it is a typesetting language not a data format", () => {
  const result = exportConversation(conversation(), "latex");
  assert.equal(result.reimportable, false);
  assert.equal(REIMPORTABLE_FORMATS.includes("latex"), false);
  for (const format of REIMPORTABLE_FORMATS) {
    assert.equal(exportConversation(conversation(), format).reimportable, true, `${format} should re-import`);
  }
});

test("a conversation survives a round trip through every re-importable format", () => {
  const source = conversation();
  const expected = source.messages.map((message) => message.content);

  for (const [format, body] of Object.entries(bodies(source))) {
    const back = importConversations(body);
    const roundTripped = back.conversations[0];
    assert.ok(roundTripped, `${format} did not re-import`);
    assert.deepEqual(
      roundTripped.messages.map((message) => message.content),
      expected,
      `${format} lost or altered message content`,
    );
  }
});

test("the structured formats are detected as themselves, not as a fallback", () => {
  const source = conversation();
  assert.equal(detectFormat(exportConversation(source, "chatgpt").body), "chatgpt");
  assert.equal(detectFormat(exportConversation(source, "claude").body), "claude");
  assert.equal(detectFormat(exportConversation(source, "openai").body), "openai");
  assert.equal(detectFormat(exportConversation(source, "lnkz").body), "lnkz");
  assert.equal(detectFormat(exportConversation(source, "markdown").body), "markdown");
});

test("roles survive the round trip where the target format can express them", () => {
  const source = conversation();
  for (const format of ["chatgpt", "claude", "openai", "lnkz"] as const) {
    const back = importConversations(exportConversation(source, format).body);
    assert.deepEqual(
      back.conversations[0].messages.map((message) => message.role),
      ["user", "assistant", "user"],
      `${format} lost the role sequence`,
    );
  }
});

test("the ChatGPT export is a real tree with current_node on the last message", () => {
  const source = conversation();
  const tree = JSON.parse(exportConversation(source, "chatgpt").body) as {
    current_node: string;
    mapping: Record<string, { parent: string | null; children: string[] }>;
  };

  assert.equal(tree.current_node, "m3");
  assert.equal(tree.mapping.root.parent, null);
  assert.deepEqual(tree.mapping.root.children, ["m1"]);
  assert.equal(tree.mapping.m2.parent, "m1");
  assert.deepEqual(tree.mapping.m3.children, [], "the leaf has no children");
});

test("the OpenAI export is pasteable into an API call", () => {
  const payload = toOpenAi(conversation());
  assert.deepEqual(payload.messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(payload.messages[1].content.includes("SQLite"), true);
  assert.equal("name" in payload.messages[0], false, "no author means no name field");
});

test("author names are sanitized into the shape the API accepts", () => {
  const source = conversation();
  source.messages[0].author = "Nihal S. (laptop)";
  const payload = toOpenAi(source);
  assert.equal(payload.messages[0].name, "Nihal_S___laptop_");
});

test("an unknown format falls back to plain text rather than throwing", () => {
  const result = exportConversation(conversation(), "not-a-format" as never);
  assert.equal(result.format, "text");
  assert.ok(result.body.includes("Storage decision"));
});

test("the brief variant carries the decisions the plain transcript does not", () => {
  const source = conversation();
  const plain = exportConversation(source, "markdown").body;
  const brief = exportConversation(source, "markdown-brief").body;
  assert.equal(plain.includes("## Decisions"), false);
  assert.ok(brief.includes("## Decisions"));
  assert.ok(brief.includes("SQLite"));
});

test("the LaTeX export is a complete document with the analysis above the transcript", () => {
  const body = exportConversation(conversation(), "latex").body;
  assert.ok(body.includes("\\documentclass[11pt,a4paper]{article}"));
  assert.ok(body.includes("\\begin{document}"));
  assert.ok(body.includes("\\end{document}"));
  assert.ok(body.includes("\\title{Storage decision}"));
  assert.ok(body.includes("\\begin{abstract}"));
  assert.ok(body.indexOf("Decisions") < body.indexOf("Transcript"), "decisions come first");
  assert.match(exportConversation(conversation(), "latex").filename, /\.tex$/);
});

test("every LaTeX special character is escaped rather than breaking the build", () => {
  const source = conversation();
  source.messages = [{
    id: "m1",
    role: "user",
    content: "Costs $5 & 100% of C:\\path_to\\file #1 ~ x^2 {braces}",
    createdAt: "2026-03-01T10:00:00.000Z",
  }];

  const body = exportConversation(source, "latex").body;
  assert.ok(body.includes("\\$5"), "dollar");
  assert.ok(body.includes("\\&"), "ampersand");
  assert.ok(body.includes("100\\%"), "percent");
  assert.ok(body.includes("path\\_to"), "underscore");
  assert.ok(body.includes("\\#1"), "hash");
  assert.ok(body.includes("\\textasciitilde{}"), "tilde");
  assert.ok(body.includes("\\textasciicircum{}"), "caret");
  assert.ok(body.includes("\\{braces\\}"), "braces");
  assert.ok(body.includes("\\textbackslash{}"), "backslash");

  // The escapes must not have been escaped in turn, which is the classic failure.
  assert.equal(body.includes("\\textbackslash{}textbackslash"), false);
  // And ordinary spaces must survive, which they do not if the sentinel leaks.
  assert.ok(body.includes("Costs "), "spaces intact");
});

test("fenced code goes into verbatim and is not escaped there", () => {
  const source = conversation();
  source.messages = [{
    id: "m1",
    role: "assistant",
    content: "Run this:\n\n```bash\nexport A=$B && echo 100%\n```\n\nThen restart.",
    createdAt: "2026-03-01T10:00:00.000Z",
  }];

  const body = exportConversation(source, "latex").body;
  assert.ok(body.includes("\\begin{Verbatim}"));
  assert.ok(body.includes("export A=$B && echo 100%"), "code is left alone inside verbatim");
  assert.ok(body.includes("Then restart."), "prose after the fence survives");
});
