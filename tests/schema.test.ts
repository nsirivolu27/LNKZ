import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { PostgresConversationStore } from "../src/lnkz/store/postgres.js";

test("the store refuses a schema behind or ahead before a data query", async (context) => {
  for (const version of [0, 1, 3]) {
    const query = context.mock.method(Pool.prototype, "query", async () => ({ rows: [{ version }] }));
    const store = new PostgresConversationStore("postgresql://localhost/unused");
    try {
      await assert.rejects(store.stats(), /schema is incompatible.*pnpm db:migrate/);
      assert.equal(query.mock.callCount(), 1);
    } finally {
      await store.close();
      query.mock.restore();
    }
  }
});
