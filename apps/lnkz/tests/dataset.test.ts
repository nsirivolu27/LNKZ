import assert from "node:assert/strict";
import test from "node:test";
import { exportDataset } from "../src/lnkz/dataset.js";
import { datasetExportSchema } from "../src/lnkz/schemas.js";
import type { Conversation } from "../src/lnkz/types.js";

const workspace = "10000000-0000-4000-8000-000000000001";
function conversation(id: string, content: string, rootId?: string): Conversation {
  return {
    id, version: 1, title: id, source: { provider: "chatgpt" }, participants: [], tags: [],
    messages: [
      { id: `${id}-1`, role: "user", content, createdAt: "2025-01-01T00:00:00.000Z" },
      { id: `${id}-2`, role: "assistant", content: "A useful answer", createdAt: "2025-01-01T00:00:01.000Z" },
    ],
    lineage: rootId ? { rootId } : undefined,
    createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:01.000Z",
  };
}
function exportWith(items: Conversation[], maxExamples = 100) {
  return exportDataset(items, workspace, { seed: "fixed", maxExamples, acknowledgeRights: true, approvalTag: "approved" });
}

test("redacts sensitive classes, skips incomplete/tool transcripts, and does not mutate sources", () => {
  const sensitive = "email a@example.com card 4111 1111 1111 1111 jwt eyJabcde.abcde.abcde " +
    "-----BEGIN RSA PRIVATE KEY----- secret -----END RSA PRIVATE KEY----- " +
    "postgres://user:pass@example.test/db sk-abcdefghijklmnop";
  const source = conversation("sensitive", sensitive);
  const before = structuredClone(source);
  const result = exportWith([source, { ...conversation("short", "only one"), messages: [conversation("short", "only one").messages[0]!] }, {
    ...conversation("tool", "tool output"), messages: [
      { id: "tool-1", role: "user", content: "x", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "tool-2", role: "tool", content: "result", createdAt: "2025-01-01T00:00:01.000Z" },
    ],
  }]);
  assert.deepEqual(source, before);
  assert.match(result.trainJsonl + result.validationJsonl, /REDACTED_EMAIL/);
  for (const kind of ["email", "card", "jwt", "privateKey", "connectionString", "token"]) assert.ok((result.manifest.redactions[kind] ?? 0) > 0, kind);
  assert.equal(result.manifest.skipped.length, 2);
});

test("dedupes exact examples, caps output, and produces deterministic seeded output", () => {
  const items = Array.from({ length: 8 }, (_, i) => conversation(`c${i}`, `unique ${i}`));
  const a = exportWith([items[0]!, items[0]!, ...items], 3);
  const b = exportWith([items[0]!, items[0]!, ...items], 3);
  assert.deepEqual(a, b);
  assert.equal(a.manifest.examples.duplicates, 2);
  assert.ok(a.manifest.examples.train + a.manifest.examples.validation <= 3);
});

test("keeps lineage groups in one split", () => {
  const result = exportWith([
    conversation("root", "one", "lineage"),
    conversation("child", "two", "lineage"),
    conversation("other", "three", "other"),
  ]);
  const lines = [...result.trainJsonl.trim().split("\n").filter(Boolean).map(() => "train"), ...result.validationJsonl.trim().split("\n").filter(Boolean).map(() => "validation")];
  const all = [...result.trainJsonl, ...result.validationJsonl];
  assert.equal(lines.length, 3);
  assert.ok(all.length > 0);
  const rootSplit = result.trainJsonl.includes('"sourceId":"root"') ? "train" : "validation";
  assert.equal(result.trainJsonl.includes('"sourceId":"child"') ? "train" : "validation", rootSplit);
});

test("requires explicit rights acknowledgement and approval tag", () => {
  assert.throws(() => datasetExportSchema.parse({ conversationIds: [workspace], approvalTag: "approved" }));
  assert.throws(() => datasetExportSchema.parse({ conversationIds: [workspace], acknowledgeRights: true }));
});