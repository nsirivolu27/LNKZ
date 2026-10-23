#!/usr/bin/env node
/**
 * Load the demo corpus into a running LNKZ.
 *
 * Without this, a fresh install has nothing to show. Search returns nothing,
 * find_conflicts has no pair to find, the graph draws no edges, and none of the
 * prompts can be demonstrated. Twelve conversations is enough to make every one
 * of those produce a real answer.
 *
 * The corpus is fiction about a bike-share forecasting project, written so the
 * interesting cases exist on purpose:
 *
 *   - a decision that gets reversed later, so find_conflicts has a real pair
 *   - two standup summaries of the same meeting from two different clients,
 *     so find_duplicates has something above its threshold
 *   - a three-link lineage chain across ChatGPT, Claude and Gemini, which is
 *     the whole product thesis and otherwise has no example anywhere
 *   - one conversation with a fake credential in it, so redaction visibly
 *     strips something on the way out
 *
 * Usage:
 *   node scripts/seed.mjs                      # http://127.0.0.1:3100
 *   node scripts/seed.mjs https://host         # a deployed instance
 *
 * Reads LNKZ_API_KEY from the environment. Safe to run twice: conversations
 * carry fixed ids, so a second run updates rather than duplicating.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = (process.argv[2] ?? process.env.LNKZ_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const apiKey = process.env.LNKZ_API_KEY;
const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const raw = await readFile(resolve(here, "..", "seed", "conversations.json"), "utf8");
  const conversations = JSON.parse(raw);

  console.log(`Seeding ${conversations.length} conversations into ${baseUrl}\n`);

  let saved = 0;
  for (const conversation of conversations) {
    const response = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(conversation),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`  FAIL ${conversation.title}`);
      console.error(`       HTTP ${response.status}: ${detail.slice(0, 200)}`);
      if (response.status === 401) {
        console.error("\nSet LNKZ_API_KEY, or start the server with LNKZ_ALLOW_UNAUTHENTICATED=true.");
        process.exit(1);
      }
      continue;
    }

    saved += 1;
    console.log(`  ok   ${conversation.title}`);
  }

  console.log(`\n${saved} of ${conversations.length} stored.`);
  if (saved !== conversations.length) process.exit(1);

  console.log(`
Now try, from an MCP client pointed at this instance:

  "search my conversations for the forecast model decision"
      finds both the original decision and the one that reversed it

  "find conflicts"
      reports the gradient boosting decision against the ARIMA decision

  "find duplicates"
      reports the two Tuesday standup write-ups, one from ChatGPT and one
      from Claude, as near identical

  "build a context packet about van routing with a budget of 1500 tokens"
      pulls the three-link chain into one packet under budget

  "create a handoff for the weather API conversation with redaction on"
      the fake credential in it is stripped before the packet leaves
`);
}

main().catch((error) => {
  console.error(`\nSeeding failed: ${error.message}`);
  console.error(`Is ${baseUrl} running?`);
  process.exit(1);
});
