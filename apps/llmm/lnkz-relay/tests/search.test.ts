import assert from "node:assert/strict";
import test from "node:test";
import { aggregateSearch } from "../src/search.js";
import type { Connector, ConnectorId, ContextItem } from "../src/types.js";

function connector(id: ConnectorId, items: ContextItem[] | Error): Connector {
  return {
    id,
    label: id,
    status: () => ({ id, label: id, configured: true, detail: "test" }),
    search: async () => {
      if (items instanceof Error) throw items;
      return items;
    },
  };
}

test("aggregate search ranks title matches and removes duplicates", async () => {
  const result = await aggregateSearch([
    connector("jira", [
      { source: "jira", id: "A-1", title: "Launch checklist", text: "ordinary details" },
      { source: "jira", id: "A-1", title: "Launch checklist", text: "duplicate" },
    ]),
    connector("slack", [
      { source: "slack", id: "1", title: "general", text: "launch checklist discussed here" },
    ]),
  ], { query: "launch checklist", limit: 10 });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].source, "jira");
  assert.deepEqual(result.searchedSources, ["jira", "slack"]);
});

test("one connector failure does not hide successful results", async () => {
  const result = await aggregateSearch([
    connector("jira", new Error("Jira is unavailable")),
    connector("documents", [
      { source: "documents", id: "doc-1", title: "Launch", text: "Checklist" },
    ]),
  ], { query: "launch", limit: 5 });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.errors, [{ source: "jira", message: "Jira is unavailable" }]);
});

test("source filters and exclusions prevent federation loops", async () => {
  const result = await aggregateSearch([
    connector("fantasy", [{ source: "fantasy", id: "f", title: "League", text: "launch" }]),
    connector("jira", [{ source: "jira", id: "j", title: "Launch", text: "issue" }]),
    connector("lnkz", [{ source: "lnkz", id: "c", title: "Launch", text: "conversation" }]),
  ], { query: "launch", sources: ["fantasy", "jira"], excludeSources: ["fantasy"] });

  assert.deepEqual(result.searchedSources, ["jira"]);
  assert.deepEqual(result.items.map((item) => item.source), ["jira"]);
});
