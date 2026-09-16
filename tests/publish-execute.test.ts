import assert from "node:assert/strict";
import test from "node:test";
import { executePublish, isPublishAllowed, publishAllowlist } from "../src/lnkz/publish/execute.js";
import type { RemoteCaller } from "../src/lnkz/publish/execute.js";
import { SqliteConversationStore } from "../src/lnkz/store/index.js";
import type { ConversationStore } from "../src/lnkz/store/index.js";
import type { RemoteTool } from "../src/lnkz/publish/prepare.js";

const TARGET = { name: "jira", url: "https://jira.example.com/mcp" };

const TOOL: RemoteTool = {
  name: "create_issue",
  description: "Create an issue.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      description: { type: "string" },
      project: { type: "string" },
    },
    required: ["summary", "description", "project"],
  },
};

const PLANTED = "sk-live-4f9c2b7e1a8d6035e2c4a90b7d15f8e3";

async function withStore(run: (store: ConversationStore) => Promise<void>) {
  const store = new SqliteConversationStore(":memory:");
  try {
    await run(store);
  } finally {
    store.close();
  }
}

function saved(store: ConversationStore) {
  return store.save({
    title: "Rate limiting the share endpoint",
    source: { provider: "chatgpt" },
    messages: [
      { role: "user", content: `Use this staging key while testing: ${PLANTED}` },
      { role: "assistant", content: "We decided to rate limit /share separately from the API." },
    ],
  });
}

/** Records what it was asked to send, and never sends anything. */
function recorder(result: { isError: boolean; text: string } = { isError: false, text: "JIRA-1 created" }) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const caller: RemoteCaller = async (_target, tool, args) => {
    calls.push({ tool, args });
    return result;
  };
  return { calls, caller };
}

test("nothing publishes without an allowlist, in any environment", async () => {
  // Not "nothing publishes in production". A rule that relaxes itself locally
  // is a rule you discover in production.
  assert.equal(publishAllowlist({}).size, 0);
  assert.equal(isPublishAllowed("jira", "create_issue", {}), false);
  assert.equal(isPublishAllowed("jira", "create_issue", { NODE_ENV: "development" }), false);

  await withStore(async (store) => {
    const conversation = await saved(store);
    const { calls, caller } = recorder();

    const result = await executePublish(store, {
      conversation, target: TARGET, tool: TOOL,
      overrides: { project: "REL" },
    }, caller, {});

    assert.equal(result.outcome, "refused");
    assert.equal(result.sent, false);
    assert.match(result.reason ?? "", /LNKZ_PUBLISH_ALLOWLIST/);
    assert.equal(calls.length, 0, "a refused publish still reached the target");
  });
});

test("the allowlist is per tool, not per target", async () => {
  // Allowing a target wholesale would mean allowing every write it grows
  // later, including ones that did not exist when the operator decided.
  const env = { LNKZ_PUBLISH_ALLOWLIST: "jira:create_issue" };
  assert.equal(isPublishAllowed("jira", "create_issue", env), true);
  assert.equal(isPublishAllowed("jira", "delete_issue", env), false);
  assert.equal(isPublishAllowed("slack", "create_issue", env), false);

  // Case and separator tolerance, because this is typed by hand into a
  // deployment config and a capital letter should not silently disable a rule.
  const messy = { LNKZ_PUBLISH_ALLOWLIST: "  Jira:Create_Issue ,\n slack:post_message  " };
  assert.equal(isPublishAllowed("jira", "create_issue", messy), true);
  assert.equal(isPublishAllowed("slack", "post_message", messy), true);
});

test("an allowed publish sends, redacted, and records what it did without the payload", async () => {
  await withStore(async (store) => {
    const conversation = await saved(store);
    const { calls, caller } = recorder();

    const result = await executePublish(store, {
      conversation, target: TARGET, tool: TOOL,
      overrides: { project: "REL" },
    }, caller, { LNKZ_PUBLISH_ALLOWLIST: "jira:create_issue" });

    assert.equal(result.outcome, "sent");
    assert.equal(result.sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.tool, "create_issue");

    // Redaction is on by default and runs before the call, because the packet
    // is going somewhere LNKZ cannot delete from.
    assert.equal(result.redacted, true);
    assert.equal(JSON.stringify(calls[0]?.args).includes(PLANTED), false, "the planted credential was sent to the target");

    // The stored conversation keeps it: redaction is for what leaves.
    const stored = await store.get(conversation.id);
    assert.ok(JSON.stringify(stored).includes(PLANTED));

    const events = await store.listEvents(20);
    const event = events.find((entry) => entry.kind === "publish.sent");
    if (!event) throw new Error("a successful publish was not recorded");
    assert.equal(event.detail?.target, "jira");
    assert.equal(event.detail?.tool, "create_issue");
    assert.equal(event.detail?.redacted, true);
    // "system" rather than a name, because there is no authenticated request
    // behind a unit test and the store refuses to invent one. Asserted rather
    // than skipped: an audit row with no actor at all is the bug this found,
    // and SQLite wrote exactly that until the column existed.
    assert.equal(event.actorId, "system");
    assert.equal(JSON.stringify(event).includes(PLANTED), false, "the audit entry carried the payload");
  });
});

test("a refusal and a failure are both recorded, not only success", async () => {
  // An audit log holding only successes answers the wrong question.
  await withStore(async (store) => {
    const conversation = await saved(store);
    const env = { LNKZ_PUBLISH_ALLOWLIST: "jira:create_issue" };

    await executePublish(store, {
      conversation, target: TARGET, tool: TOOL, overrides: { project: "REL" },
    }, recorder().caller, {});

    await executePublish(store, {
      conversation, target: TARGET, tool: TOOL, overrides: { project: "REL" },
    }, recorder({ isError: true, text: "project REL does not exist" }).caller, env);

    const thrower: RemoteCaller = async () => { throw new Error("connect ECONNREFUSED"); };
    await executePublish(store, {
      conversation, target: TARGET, tool: TOOL, overrides: { project: "REL" },
    }, thrower, env);

    const kinds = (await store.listEvents(20)).map((event) => event.kind);
    assert.ok(kinds.includes("publish.refused"), "a refusal was not recorded");
    assert.equal(kinds.filter((kind) => kind === "publish.failed").length, 2, "both failure modes were not recorded");
  });
});

test("a required field the mapping could not fill refuses before the call", async () => {
  // The remote server's idea of a missing required field is its own business,
  // and its error will be worse than this one.
  await withStore(async (store) => {
    const conversation = await saved(store);
    const { calls, caller } = recorder();

    const result = await executePublish(store, {
      conversation, target: TARGET, tool: TOOL,
    }, caller, { LNKZ_PUBLISH_ALLOWLIST: "jira:create_issue" });

    assert.equal(result.outcome, "refused");
    assert.match(result.reason ?? "", /project/);
    assert.equal(calls.length, 0, "an incomplete call was sent anyway");
  });
});

test("redaction can be turned off, and the result says so", async () => {
  await withStore(async (store) => {
    const conversation = await saved(store);
    const { calls, caller } = recorder();

    const result = await executePublish(store, {
      conversation, target: TARGET, tool: TOOL,
      overrides: { project: "REL" },
      redact: false,
    }, caller, { LNKZ_PUBLISH_ALLOWLIST: "jira:create_issue" });

    assert.equal(result.redacted, false);
    const event = (await store.listEvents(20)).find((entry) => entry.kind === "publish.sent");
    assert.equal(event?.detail?.redacted, false, "the audit entry did not record that redaction was off");
    assert.equal(calls.length, 1);
  });
});
