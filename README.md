# LNKZ

**Your working context, out of the app it was trapped in.**

You spend an hour with a model working something out. It lands on an answer, names the tradeoffs, leaves two things open. Then you need it somewhere else: a different model, your phone, a teammate.

Today that means pasting a wall of text into the next window, where the new model re-reads forty thousand tokens to recover four sentences of conclusion. LNKZ is the layer that moves the conclusion instead of the transcript.

It runs on your own machine or your own server. Your conversations stay in a file you own.

---

## What it does

**Takes a conversation in.** Paste a ChatGPT export, a Claude export, a Gemini request body, an OpenAI message array, a Markdown transcript, or an unlabeled paste. LNKZ detects the format and normalizes it. Every format round trips, so a conversation can leave as easily as it arrived.

**Works out what it settled.** Deterministic, no model call: decisions, open questions, action items, facts, each carrying the message it came from so you can go back to the source. Across the whole corpus it also finds near duplicates and pairs of conversations whose decisions contradict each other.

**Packs it for the next model.** A context packet fits a token budget you set. It carries what was decided rather than everything that was said, so the next model starts from the conclusion.

**Hands it to a person.** A share link that expires, limits its own uses, can be revoked after you send it, and optionally scrubs credentials on the way out. When they continue the conversation, the new thread points back at the original, so the chain stays walkable.

**Answers from every tool at once.** One search across your conversations plus Slack, Jira, Figma, document feeds, and any downstream MCP server you configure.

---

## The five components

LNKZ is one service with five parts. Each has a clean edge, which is what lets the others change without breaking it.

### 1. Store

The portable conversation format and its two backends. A conversation is a title, a summary, a source naming the provider and app it came from, participants, tags, ordered messages, and optional lineage pointing at the conversation it continued from.

One interface, `ConversationStore`, with two implementations. SQLite by default, so a single person can run this with no other service and no native module to compile. Postgres when `DATABASE_URL` is set, for deployments where more than one instance shares a database. Nothing above the store knows which one is live.

### 2. Ingest and export

Importers for ChatGPT, Claude, Gemini, OpenAI-compatible message arrays, LNKZ packets, Markdown, and plain text, with format detection and a dry run that reports what it found before anything is written. Exporters back out to the same formats plus LaTeX.

Round trip fidelity is the contract, and it is tested: a conversation exported and re-imported comes back as the same conversation, not an inflated approximation of one.

### 3. Intelligence

Rule based analysis over message text. No model calls, no API keys, no per-request cost, and the same input always gives the same output.

It produces the claim types above, detects near duplicates by shingling and Jaccard similarity, flags contradicting decisions by cosine similarity, and builds a graph over the corpus whose nodes are conversations, decisions, open questions and shared topics, and whose every edge carries the reason it exists.

It surfaces candidates for review. It does not adjudicate them.

### 4. Handoff

Share links, and the lineage they create. Tokens are stored as SHA-256 hashes, never in plaintext. Each link carries an expiry, a use limit, an optional audience, and an optional redaction pass that strips credentials before the packet leaves. Redemption is unauthenticated by design, because a link has to work for someone with no key. Continuing is a write, so it takes one.

Every mint, redemption, refusal and revocation lands in an append-only audit log.

### 5. Surfaces

The same workflow through three doors:

- **REST API**, which is the product boundary. Anything you build on top, a web console included, goes through this.
- **MCP over stdio**, for Claude Desktop and other local clients.
- **MCP over Streamable HTTP**, stateless, for remote clients.

24 tools, 5 `lnkz://` resources, 4 prompts. The tool names and resource URIs are a stable contract.

Sitting alongside these, **connectors** federate search out to Slack, Jira, Figma, document feeds, and downstream MCP servers. Credentials for those live in one place, and a connector that is not configured reports itself as unconfigured rather than failing quietly.

---

## MVP

The MVP is the smallest version someone other than the author can pick up and get value from in five minutes.

### The one path that has to work

1. Point Claude Desktop at a running LNKZ.
2. Say "save this conversation into LNKZ."
3. Later, from a different model or a different machine, say "catch me up on what we decided about X."
4. Get the decisions back, not the transcript.
5. Send someone a link to the same thing, and have it expire on its own.

Everything else is in service of that path.

### In scope

- Import from the five major clients, with detection and a dry run
- Search with ranked results and snippets
- Deterministic analysis into decisions, open questions and action items
- Context packets inside a token budget
- Share links with expiry, use limits, revocation and redaction
- Lineage across the handoff, so a continued conversation knows its parent
- MCP over stdio and Streamable HTTP, plus the REST API
- SQLite for one person, Postgres for a shared deployment
- An audit log of every handoff event

### Explicitly out of scope for the MVP

- **A web console.** The REST API is the boundary. A UI is a separate build on top of it, and shipping one before the API is stable would be building on sand.
- **Accounts and multi-user.** A deployment has one shared key. The Postgres schema carries workspace isolation and row level security so this can arrive later without a migration, but per user identity is not implemented.
- **Semantic search.** Lexical ranking only, FTS5 or `tsvector`. Embeddings are a later milestone and deliberately not in the storage contract.
- **Attachments.** Messages are text. An image or PDF in a conversation has nowhere to go yet.
- **Message edits and branching.** Conversations are append only, and lineage records one parent.

### What still stands between here and MVP

| | Status |
| --- | --- |
| Core workflow implemented | Done |
| Test suite | 89 tests, 87 passing, 2 skipped without a database |
| `POST /api/handoffs/continue` | Missing. The only tool with no route behind it. |
| Seed corpus | Missing. Nothing in the repository demonstrates the product working. |
| Deployed anywhere | No. Docker, Fly and Render configs exist and are untested against a real host. |
| Five minute quick start that ends in something working | No. The current one ends at a running process. |

That list is the MVP. Not more features.

---

## Quick start

Requirements: Node 22.5+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm build
pnpm start
```

The server listens on `http://127.0.0.1:3100`. For a local run without auth set `LNKZ_ALLOW_UNAUTHENTICATED=true`; otherwise set `LNKZ_API_KEY`. Production starts fail closed: without `LNKZ_API_KEY` or `LNKZ_API_KEYS_JSON` the process refuses to boot rather than serving your conversations to anyone who asks.

Point an MCP client at it:

```json
{
  "mcpServers": {
    "lnkz": {
      "url": "http://localhost:3100/mcp",
      "headers": { "Authorization": "Bearer YOUR_LNKZ_API_KEY" }
    }
  }
}
```

Storage defaults to SQLite at `.data/lnkz.db`. For Postgres, run the migration entrypoint before starting:

```bash
pnpm build
DATABASE_URL=postgresql://... pnpm db:migrate
```

## Development

```bash
pnpm typecheck
pnpm test
pnpm dev
```

The suite needs no database, no network and no credentials. The two Postgres tests skip themselves unless `LNKZ_POSTGRES_MIGRATION_URL` and `LNKZ_POSTGRES_TEST_URL` are set.

## Deployment

```bash
cp .env.example .env
# Set LNKZ_API_KEY, LNKZ_PUBLIC_BASE_URL, ALLOWED_HOSTS, ALLOWED_ORIGINS.
docker compose up --build
```

See [DEPLOY.md](DEPLOY.md) for storage, Postgres, proxy and health check guidance.

For a multi-node deployment, give each trusted node the same high-entropy `LNKZ_MCP_CONTEXT_SECRET`. LNKZ signs the active workspace, actor, scopes, expiry and trace before calling another MCP node, and receiving nodes accept it only on the MCP endpoint. Plain workspace headers are never trusted, and API key or managed identity always takes precedence over a forwarded envelope. [MCP.md](MCP.md) has the trust and rotation details.

## Building on it

The REST API is the supported way to build anything on top of LNKZ, including a web interface. It is authenticated with a bearer token, returns JSON, and covers everything the MCP tools do. Start at [MCP.md](MCP.md), which lists every route beside the tool that corresponds to it.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — the storage contract and where the boundaries are
- [MCP.md](MCP.md) — tools, resources, prompts, REST routes, environment variables
- [DEPLOY.md](DEPLOY.md) — Docker, SQLite, Postgres, production configuration
- [ROADMAP.md](ROADMAP.md) — what comes after the MVP

## Related repositories

LNKZ started as one repository holding both the relay and the MCP server. Those have different lifecycles, so there are now three places:

| Repository | What it owns |
| --- | --- |
| This repository | The relay: storage, ingest and export, intelligence, handoffs, and the REST and MCP surfaces. What you run. |
| [LLMM](https://github.com/nsirivolu27/LLMM) | A product built on this relay, with its own web console and deployment assets. |
| [lnkz-mcp](https://github.com/nsirivolu27/lnkz-mcp) | The MCP adapter as a standalone client, for pointing a laptop at a relay running somewhere else. |

Start here if you want the relay. Start in LLMM if you want the product with a console on top. Start in lnkz-mcp only if the relay is hosted elsewhere and the MCP client is not.

## Compatibility

The `LNKZ_*` environment variable names, the MCP tool names, and the `lnkz://` resource URIs are stable contracts. Anything built against them keeps working.

MIT licensed.
