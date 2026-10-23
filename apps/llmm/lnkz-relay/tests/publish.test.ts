import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeWrite, prepareCall, renderBody, type RemoteTool } from "../src/publish/prepare.js";
import { configuredTargets, discoverTools, findTool } from "../src/publish/targets.js";
import type { Conversation } from "../src/types.js";

function conversation(): Conversation {
  return {
    id: "7a1b2c3d-0000-4000-8000-000000000000",
    version: 1,
    title: "Storage decision",
    summary: "Chose SQLite for the first release.",
    source: { provider: "chatgpt", url: "https://chat.example/c/123" },
    participants: ["Nihal"],
    tags: [],
    messages: [
      { id: "m1", role: "user", content: "Postgres or SQLite?", createdAt: "2026-03-01T10:00:00.000Z" },
      {
        id: "m2",
        role: "assistant",
        content: "We decided to use SQLite. I will write the migration. It is unclear whether WAL matters.",
        createdAt: "2026-03-01T10:00:05.000Z",
      },
    ],
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:05.000Z",
  };
}

const createIssue: RemoteTool = {
  name: "create_issue",
  description: "Create a Jira issue",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Issue title" },
      description: { type: "string" },
      projectKey: { type: "string", description: "Which project" },
      priority: { type: "number" },
    },
    required: ["summary", "description", "projectKey"],
  },
};

test("target configuration parses name=url and name=url|key", () => {
  const { targets, errors } = configuredTargets({
    LNKZ_MCP_TARGETS: "jira=https://jira.example/mcp|secret, notes=http://localhost:9000/mcp",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(targets.map((target) => target.name), ["jira", "notes"]);
  assert.equal(targets[0].apiKey, "secret");
  assert.equal(targets[1].apiKey, undefined);
  assert.deepEqual(errors, []);
});

test("a malformed target is reported and skipped rather than guessed at", () => {
  const { targets, errors } = configuredTargets({
    LNKZ_MCP_TARGETS: "broken, bad=notaurl, ftp=ftp://files.example/mcp, ok=https://good.example/mcp",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(targets.map((target) => target.name), ["ok"]);
  assert.equal(errors.length, 3);
  assert.ok(errors.some((error) => error.includes("name=url form")));
  assert.ok(errors.some((error) => error.includes("unparseable")));
  assert.ok(errors.some((error) => error.includes("not http or https")));
});

test("the existing fantasy connector stays a target so nothing that worked breaks", () => {
  const { targets } = configuredTargets({ FANTASY_MCP_URL: "https://fantasy.example/mcp" } as NodeJS.ProcessEnv);
  assert.deepEqual(targets.map((target) => target.name), ["fantasy"]);
});

test("no configuration means no targets, not an error", () => {
  const { targets, errors } = configuredTargets({} as NodeJS.ProcessEnv);
  assert.deepEqual(targets, []);
  assert.deepEqual(errors, []);
});

test("discovery marks the tools that look like writes", async () => {
  const discovered = await discoverTools(
    [{ name: "jira", url: "https://jira.example/mcp" }],
    async () => [createIssue, { name: "search_issues" }, { name: "update_issue" }],
  );

  const tools = discovered[0].tools;
  assert.deepEqual(tools.map((tool) => tool.write), [true, false, true]);
  assert.equal(findTool(discovered, "jira", "create_issue")?.name, "create_issue");
  assert.equal(findTool(discovered, "jira", "missing"), null);
});

test("one unreachable target does not hide the others", async () => {
  const discovered = await discoverTools(
    [{ name: "down", url: "https://down.example/mcp" }, { name: "up", url: "https://up.example/mcp" }],
    async (target) => {
      if (target.name === "down") throw new Error("connection refused");
      return [{ name: "post_message" }];
    },
  );

  assert.equal(discovered[0].error, "connection refused");
  assert.deepEqual(discovered[0].tools, []);
  assert.equal(discovered[1].tools.length, 1);
});

test("a conversation maps onto a remote tool's schema, and says what it could not fill", () => {
  const prepared = prepareCall(conversation(), "jira", createIssue, "brief");

  assert.equal(prepared.sent, false);
  assert.equal(prepared.arguments.summary, "Storage decision");
  assert.ok(String(prepared.arguments.description).includes("SQLite"));
  assert.equal("priority" in prepared.arguments, false, "non-string fields are left alone");

  assert.deepEqual(prepared.missing.map((field) => field.name), ["projectKey"]);
  assert.ok(prepared.filled.some((entry) => entry.name === "summary"));
  assert.ok(prepared.notes.some((note) => note.includes("Nothing was sent")));
});

test("a tool with no input schema is reported rather than filled in blindly", () => {
  const prepared = prepareCall(conversation(), "notes", { name: "append" }, "summary");
  assert.deepEqual(prepared.arguments, {});
  assert.ok(prepared.notes.some((note) => note.includes("no input schema")));
});

test("a url field is filled from the conversation's source when there is one", () => {
  const withUrl = prepareCall(conversation(), "notes", {
    name: "add_link",
    inputSchema: { type: "object", properties: { link: { type: "string" } } },
  }, "summary");
  assert.equal(withUrl.arguments.link, "https://chat.example/c/123");

  const source = conversation();
  source.source.url = undefined;
  const without = prepareCall(source, "notes", {
    name: "add_link",
    inputSchema: { type: "object", properties: { link: { type: "string" } } },
  }, "summary");
  assert.equal("link" in without.arguments, false, "an unknown value is left empty, not invented");
});

test("each shape sends a different amount of the conversation", () => {
  const source = conversation();
  const summary = renderBody(source, "summary");
  const decisions = renderBody(source, "decisions");
  const brief = renderBody(source, "brief");
  const transcript = renderBody(source, "transcript");

  assert.ok(decisions.includes("SQLite"));
  assert.equal(decisions.includes("Postgres or SQLite?"), false, "decisions do not carry the transcript");
  assert.ok(brief.includes("Open questions") || brief.includes("Action items"));
  assert.ok(transcript.length > summary.length, "the transcript is the largest payload");
});

test("write detection reads the verb, not the remote server's own claim about itself", () => {
  assert.equal(looksLikeWrite({ name: "create_issue" }), true);
  assert.equal(looksLikeWrite({ name: "jira_post_comment" }), true);
  assert.equal(looksLikeWrite({ name: "delete_page" }), true);
  assert.equal(looksLikeWrite({ name: "search_issues" }), false);
  assert.equal(looksLikeWrite({ name: "get_page" }), false);
});
