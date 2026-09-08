import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentsConnector } from "../src/connectors/documents.js";
import { createFantasyConnector } from "../src/connectors/fantasy.js";
import { createFigmaConnector } from "../src/connectors/figma.js";
import { createJiraConnector } from "../src/connectors/jira.js";
import { createSlackConnector } from "../src/connectors/slack.js";

test("connectors stay disabled until their complete credential set exists", () => {
  assert.equal(createSlackConnector({}), null);
  assert.equal(createJiraConnector({ JIRA_BASE_URL: "https://example.atlassian.net" }), null);
  assert.equal(createFigmaConnector({ FIGMA_PERSONAL_ACCESS_TOKEN: "x" }), null);
  assert.equal(createDocumentsConnector({}), null);
  assert.equal(createFantasyConnector({}), null);
});

test("least-privilege connector configurations are recognized without network calls", () => {
  assert.equal(createSlackConnector({ SLACK_BOT_TOKEN: "xoxb-test", SLACK_CHANNEL_IDS: "C1" })?.id, "slack");
  assert.equal(createJiraConnector({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_EMAIL: "person@example.com",
    JIRA_API_TOKEN: "token",
  })?.id, "jira");
  assert.equal(createFigmaConnector({
    FIGMA_PERSONAL_ACCESS_TOKEN: "figd_test",
    FIGMA_FILE_KEYS: "file-one",
  })?.id, "figma");
  assert.equal(createDocumentsConnector({ DOCUMENT_FEED_URLS: "https://docs.example/context.json" })?.id, "documents");
  assert.equal(createFantasyConnector({ FANTASY_MCP_URL: "https://fantasy.example/api/mcp" })?.id, "fantasy");
});
