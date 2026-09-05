<div align="center">

# LNKZ

**Your best conversations are trapped in whichever app you had them in. LNKZ gets them out.**

Move a chat from ChatGPT to Claude, from your laptop to your phone, from you to a teammate.
Send the next model the decisions instead of the transcript. Share a thread with a link that
expires, scrubs your keys on the way out, and can be revoked after you send it.

[Quick start](#quick-start) · [Live demo](#the-sixty-second-demo) · [Docs](#documentation) · [Self-host](DEPLOY.md)

![ci](https://github.com/nsirivolu27/LNKZ/actions/workflows/ci.yml/badge.svg)

</div>

---

## The problem

You spend an hour with a model working something out. It lands on an answer, names the
tradeoffs, leaves two things open. Then you need it somewhere else.

Today that means copying and pasting a wall of text into the next window, where the new model
re-reads forty thousand tokens to recover four sentences of conclusion. Or you paste it into
Slack, where it is unreadable and now permanent. Or you screenshot it. Or you just explain it
again from memory, badly.

The conversation was the work. It should not be stuck in the client that happened to host it.

## What LNKZ does

**Brings a chat in from anywhere.** Drop in a ChatGPT export, a Claude export, a Gemini
payload, a chat-completions message array, a Markdown transcript, or just text you copied out
of a window. For an export LNKZ has never seen, it finds the conversation structurally rather
than guessing the vendor, and tells you it did. LNKZ figures out the format and normalizes it. ChatGPT exports are handled properly: because editing a message
branches the conversation, the export is a tree, and LNKZ reconstructs the thread you actually
saw instead of interleaving drafts you abandoned.

**Sends the gist, not the transcript.** Ask for a context packet and LNKZ returns what was
decided, what is still open, what happens next, and a recent excerpt, trimmed to whatever
token budget you name. Fifteen hundred tokens instead of forty thousand, and the next model
starts where you left off rather than reading its way there.

**Hands it to a person safely.** A handoff is a link that expires, that stops working after N
uses, that you can revoke after sending, and that can strip API keys, tokens, and credentials
before the content ever leaves. Only a hash of the link is stored, so the database cannot leak
a working one.

**Keeps the thread whole across clients.** Continue a handed-off conversation somewhere else
and the new thread points back at the original, so you can walk the chain from wherever it
ended up to wherever it started.

**Lets it leave again.** Import without export is lock-in with extra steps. A conversation
writes back out as a Markdown transcript, a brief with the decisions on top, a
chat-completions payload you can paste into an API call, a ChatGPT- or Claude-shaped export,
or a LaTeX document that compiles to a PDF as it stands. Every format except LaTeX re-imports,
and there are round-trip tests that prove it.

**Shows you what the corpus knows.** Search answers which chat mentioned something. It cannot
answer what a body of conversations has settled, which decisions everything else leans on, or
which chats stand alone. That is a question about structure, so LNKZ builds a graph: nodes for
conversations, decisions, open questions and shared topics, edges for lineage, shared subject
matter, near duplicates and contradictions. Every edge carries the reason it exists.

**Searches the work around the chat.** One question spans your saved conversations plus Slack,
Jira, Figma, documentation feeds, and any other MCP server you connect.

## How it works

```
   ChatGPT      Claude       Gemini      a local model      you, pasting
      |            |            |              |                 |
      +------------+-----+------+--------------+-----------------+
                         |
                    ┌────┴─────┐
                    │   LNKZ   │   MCP over HTTP and stdio · REST · web console
                    └────┬─────┘
                         |
        +----------------+----------------+
        |                |                |
   context packet    handoff link    federated search
   for the next      for a person    across Slack, Jira,
   model             or device       Figma, docs, other
                                     MCP servers
```

LNKZ speaks MCP, so it plugs into Claude, Cursor, Codex, and anything else that speaks the
protocol. It also has a plain REST API and a web console, because not everything that needs
your context is an AI client.

## Quick start

Node 22.5 or newer. Storage is SQLite through Node's built-in module, so there is nothing to
compile and no database to run.

```bash
npm install
npm ci --prefix mcp-server
cp mcp-server/.env.example mcp-server/.env

npm run mcp:dev      # server on :3100
npm run dev          # site on :5173, console at /console.html
```

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

## The sixty-second demo

Three calls that are the whole product.

```bash
LNKZ=http://localhost:3100
KEY=$(grep LNKZ_API_KEY mcp-server/.env | cut -d= -f2)

# 1. Bring a conversation in. This one is a raw paste; an export works the same way.
curl -s -X POST $LNKZ/api/conversations/import \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"payload":"User: postgres or sqlite for the relay?\nAssistant: We decided to use SQLite, it removes the deployment dependency. I will write the migration. Still unclear whether we need WAL checkpoints."}'

# 2. Ask for what the next model actually needs.
curl -s -X POST $LNKZ/api/context/packet \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"query":"sqlite","budgetTokens":1500}'
#    -> decision: use SQLite, it removes the deployment dependency
#    -> open question: whether WAL checkpoints are needed
#    -> action item: write the migration

# 3. Hand it to someone, for an hour, three uses, secrets stripped.
curl -s -X POST $LNKZ/api/conversations/<id>/handoffs \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"ttlMinutes":60,"maxUses":3,"redact":true,"audience":"design review"}'
```

Step 2 is the part worth pausing on. Nothing called a model to produce that. The extraction is
rule based, which means it costs nothing, works offline, and gives the same answer twice.

## Capabilities

| | |
| --- | --- |
| **Import** | ChatGPT, Claude, Gemini, chat-completions, LNKZ packets, Markdown, plain text, plus a structural reader for unknown exports. Auto-detected. Preview before writing. |
| **Understand** | Decisions, open questions, action items, cited facts, topics. Each traced to the message it came from. |
| **Package** | Token-budgeted context packets for the next model. |
| **Export** | Back out as Markdown, a brief, a chat-completions payload, or a ChatGPT- or Claude-shaped export. All re-importable. |
| **Share** | Expiring, use-limited, revocable links. Hashed tokens. Optional secret redaction. Full audit trail. |
| **Continue** | Lineage across clients, so a relayed thread stays one thread. |
| **Reconcile** | Near-duplicate detection, and flags when two conversations decided differently. |
| **Connect** | Slack, Jira, Figma, documentation feeds, and any MCP server. Failure-isolated. |
| **Graph** | Structure over the corpus: hubs, contradictions, duplicates, and conversations connected to nothing. |
| **Publish** | Discover what a downstream MCP server can do and prepare the call. It never sends it. |
| **Reach** | 24 MCP tools, 5 resources, 4 prompts, over HTTP and stdio. Plus REST and a web console. |

## Integrations

Every connector is optional and read-only. An unconfigured source shows as disabled with the
reason rather than failing, and one source being down never hides results from the others.

| Source | Set |
| --- | --- |
| Slack | `SLACK_USER_TOKEN`, or `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_IDS` |
| Jira Cloud | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| Figma | `FIGMA_PERSONAL_ACCESS_TOKEN`, `FIGMA_FILE_KEYS` |
| Docs | `DOCUMENT_FEED_URLS` |
| Any MCP server | its URL and key |

## Your data stays yours

LNKZ is self-hosted by design. There is no LNKZ cloud, no account to create, and nothing
phones home.

- Conversations live in a SQLite file you control
- Handoff links carry 192 bits of randomness and are stored only as SHA-256 digests
- Redemptions are `no-store` and `noindex`, and the public share route is rate limited
- Redaction is conservative on purpose: it will not match on bare words, and it Luhn-checks
  card-shaped numbers so version strings and IDs survive
- Every save, share, redemption, rejection, and revocation is in an audit log you can read

A handoff link is a bearer secret in a URL. Terminate TLS in front of it.

## Self-hosting

```bash
docker compose up --build
```

For a real deployment, `fly.toml` and `render.yaml` are checked in and
**[DEPLOY.md](DEPLOY.md)** is the runbook: the volume you need, what each setting does, and the
two mistakes that cause almost every first deploy to fail.

## Documentation

| | |
| --- | --- |
| [DEPLOY.md](DEPLOY.md) | Deploying to Fly or Render, and what to check afterwards |
| [MCP.md](MCP.md) | Every tool, resource, prompt, and REST endpoint |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How it is built and why those tradeoffs |
| [ROADMAP.md](ROADMAP.md) | Shipped, next, and later |
| [GRAPHIFY.md](GRAPHIFY.md) | The codebase knowledge graph used while developing |
| [AGENTS.md](AGENTS.md) | Contributor guide |

## Project status

Working MVP, single user, self-hosted. 85 tests plus an end-to-end smoke test that boots the
built server and drives it over both REST and MCP.

```bash
npm test && npm run typecheck && npm run build && node scripts/smoke.mjs
```

**Not there yet:** accounts and workspaces, more than one instance, semantic search, OAuth for
connectors, and writing back to connected systems. See [ROADMAP.md](ROADMAP.md).

This repository began as an unrelated geo-social photo sharing prototype. That code was
removed from the working tree and lives only in history, before commit `b286e13`.
