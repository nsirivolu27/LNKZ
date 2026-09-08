# LLMM MCP and API reference

LLMM preserves the existing LNKZ MCP contract while presenting the product as the Large Language Model Mover. Clients can continue using the established tool names, resource URIs, and LNKZ_* configuration without migration work.

## Connecting

LLMM exposes stateless Streamable HTTP at `POST /mcp`. When `LNKZ_API_KEY` is set, clients must
send `Authorization: Bearer <LNKZ_API_KEY>`.

```json
{
  "mcpServers": {
    "llmm": {
      "url": "https://llmm.example.com/mcp",
      "headers": { "Authorization": "Bearer ${LNKZ_API_KEY}" }
    }
  }
}
```

For a local stdio client, build first and run `mcp-server/dist/stdio.js` with the repository as
the working directory. `.mcp.json` in this repository already does that.

## Tools

### Conversations

| Tool | Purpose |
| --- | --- |
| `save_conversation` | Store a normalized chat from any client or device |
| `import_conversation` | Normalize a ChatGPT, Claude, Gemini, chat-completions, LLMM, Markdown, or plain-text payload, or find the conversation structurally in an export LLMM has never seen. Auto-detects; `dryRun` previews without writing |
| `export_conversation` | Write a conversation back out in another client's format: `markdown`, `markdown-brief`, `openai`, `chatgpt`, `claude`, `llmm`, `latex`, `text` |
| `get_conversation` | Full conversation, lineage, extracted claims, and Markdown transcript |
| `list_conversations` | Newest first, filterable by provider, tag, or participant |
| `search_conversations` | Ranked full-text search with snippets |
| `append_messages` | Add turns to an existing thread |
| `delete_conversation` | Remove a conversation, its messages, and its handoffs |

### Handoffs

| Tool | Purpose |
| --- | --- |
| `create_handoff` | Mint an expiring, use-limited link, optionally redacted and audience-labeled |
| `redeem_handoff` | Load the packet behind a token |
| `continue_handoff` | Redeem, then store the continuation as a new conversation linked to the original |
| `revoke_handoff` | Invalidate a link that has already been shared |
| `list_handoffs` | Expiry, remaining uses, audience, and revocation state. Tokens are never returned |

### Context intelligence

| Tool | Purpose |
| --- | --- |
| `build_context_packet` | Token-budgeted brief: decisions, open questions, action items, excerpt, conflicts |
| `analyze_conversation` | Extract claims and topics from one conversation |
| `find_conflicts` | Decisions across conversations that appear to disagree |
| `find_duplicates` | Conversations whose transcripts overlap heavily |
| `build_context_graph` | Nodes for conversations, decisions, open questions and shared topics; edges for lineage, shared subject matter, near duplicates and contradictions |

### Publishing

Sending context onward is split in two on purpose. LLMM prepares the call and shows it; making
the call is a separate, deliberate act. A context relay that can silently write into your team's
Jira is a different and more dangerous product than one that cannot.

| Tool | Purpose |
| --- | --- |
| `list_publish_targets` | Connect to each configured downstream MCP server and list its tools, marking which look like writes |
| `prepare_publish` | Map a conversation onto a remote tool's input schema and return the exact call, including the required fields it could not fill. Sends nothing |

Targets are configured with `LNKZ_MCP_TARGETS`, a comma-separated list of `name=url` with an
optional `|key`:

```
LNKZ_MCP_TARGETS=jira=https://jira.example/mcp|abc123,notes=http://localhost:9000/mcp
```

A malformed entry is reported and skipped rather than guessed at, because a typo in a URL here
is a request sent somewhere unintended.

### Federation and operations

| Tool | Purpose |
| --- | --- |
| `search_context` | LLMM plus every configured connector in one call, with per-source errors |
| `list_connectors` | Which sources are configured, and why the others are not |
| `workspace_stats` | Conversation, message, provider, and handoff counts |
| `audit_log` | Recent saves, imports, redemptions, rejections, and revocations |

## Resources

| URI | Content |
| --- | --- |
| `lnkz://connectors` | Connector inventory (JSON) |
| `lnkz://stats` | Workspace statistics (JSON) |
| `lnkz://conversations` | The 25 most recently updated conversations (JSON) |
| `lnkz://graph` | The conversation graph over the 50 most recent conversations (JSON) |
| `lnkz://conversation/{id}` | One conversation as a Markdown transcript with its decisions |

## Prompts

| Prompt | Use |
| --- | --- |
| `continue_shared_conversation` | Resume a handoff while preserving facts, decisions, and open questions |
| `research_brief` | Build a sourced brief from conversations and connected systems |
| `prepare_handoff` | Summarize a conversation, then mint a scoped link for a named recipient |
| `reconcile_conflicts` | Review flagged contradictions and propose which decision stands |

## Conversation format

Every conversation is stored as `llmm.conversation.v1`. `source.provider` is an open string so a
client can identify ChatGPT, Claude, Gemini, a local model, or something that does not exist yet
without a protocol change.

```json
{
  "title": "Launch decision",
  "summary": "Compared two launch plans and selected the lower-risk path.",
  "source": {
    "provider": "any-llm",
    "app": "desktop",
    "deviceId": "work-laptop",
    "externalConversationId": "optional-provider-id"
  },
  "participants": ["Nihal", "Design assistant"],
  "tags": ["launch", "research"],
  "lineage": { "parentId": "uuid-of-the-earlier-thread" },
  "messages": [
    { "role": "user", "content": "Compare the plans." },
    { "role": "assistant", "content": "We decided to go with plan B: lower delivery risk." }
  ]
}
```

Supplying a saved UUID as `id` updates the conversation without changing its creation time.

## REST endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Unauthenticated liveness and connector summary |
| `POST` | `/api/conversations` | Save |
| `GET` | `/api/conversations` | List, with `limit`, `offset`, `provider`, `tag`, `participant` |
| `GET` | `/api/conversations/:id` | Conversation plus analysis |
| `DELETE` | `/api/conversations/:id` | Delete |
| `POST` | `/api/conversations/:id/messages` | Append turns |
| `POST` | `/api/conversations/search` | Ranked search |
| `POST` | `/api/conversations/import` | Import, with `dryRun` |
| `GET` | `/api/conversations/:id/export` | Export, with `?format=` |
| `GET` | `/api/graph` | The conversation graph. `Accept: text/markdown` returns the readable summary |
| `GET` | `/api/publish/targets` | Downstream MCP servers and their tools |
| `POST` | `/api/publish/prepare` | The call that would be made. Sends nothing |
| `POST` | `/api/conversations/:id/handoffs` | Create a handoff |
| `GET` | `/api/handoffs` | List handoffs |
| `DELETE` | `/api/handoffs/:id` | Revoke |
| `GET` | `/share/:token` | Redeem. Unauthenticated, rate limited, `no-store`. `Accept: text/markdown` returns the transcript |
| `POST` | `/api/context/search` | Federated search |
| `POST` | `/api/context/packet` | Build a context packet |
| `GET` | `/api/context/conflicts` | Contradiction candidates |
| `GET` | `/api/context/duplicates` | Near-duplicate pairs |
| `GET` | `/api/connectors`, `/api/stats`, `/api/events` | Status and audit |
| `POST` | `/mcp` | MCP Streamable HTTP |

Examples:

```bash
# Import a Claude export, previewing first
curl -X POST http://localhost:3100/api/conversations/import \
  -H "Authorization: Bearer $LNKZ_API_KEY" -H "Content-Type: application/json" \
  -d "{\"payload\": $(jq -Rs . < conversations.json), \"dryRun\": true}"

# One-hour, three-use, redacted handoff
curl -X POST http://localhost:3100/api/conversations/<id>/handoffs \
  -H "Authorization: Bearer $LNKZ_API_KEY" -H "Content-Type: application/json" \
  -d '{"ttlMinutes":60,"maxUses":3,"redact":true,"audience":"design review"}'

# Redeem as Markdown
curl -H "Accept: text/markdown" http://localhost:3100/share/<token>
```

The `shareUrl` a handoff returns contains a bearer token. Anyone holding it can read that
conversation until it expires or is revoked, so treat it like a temporary password. The
plaintext token is never stored by LLMM.

## Formats

Import accepts these, and `auto` picks between them:

| Format | What it is |
| --- | --- |
| `chatgpt` | The account export. A message tree, so LLMM follows `current_node` to the root and leaves abandoned edit branches out |
| `claude` | The account export. A flat list per conversation, reading either `text` or the typed content blocks |
| `gemini` | The API request body, or a takeout-style record grouping `turns` |
| `openai` | The chat-completions message array, which is also what most agent frameworks, traces and eval files store |
| `llmm` | A LLMM packet, so a handoff becomes a conversation somewhere else |
| `markdown` | A transcript with speaker headings. Fenced code survives, and a document's own header block is not read as messages |
| `text` | A copied chat, split on speaker labels when they exist and kept whole when they do not |
| `generic` | An export LLMM has never seen. Instead of guessing the vendor, it finds the message array or the prompt and response pairs structurally, and says in a warning that it did |

Export writes `markdown`, `markdown-brief` (decisions and open questions above the
transcript), `openai`, `chatgpt`, `claude`, `llmm`, `latex`, and `text`. Every one except
LaTeX re-imports, and there are round-trip tests asserting a conversation exported and read
back is the same conversation.

`latex` produces a standalone document that compiles with `pdflatex` as it stands: preamble,
title, abstract from the summary, the extracted decisions and open questions above the
transcript, and fenced code in `Verbatim` blocks. LaTeX is a one-way door and says so in the
result, because reading one back into a conversation would be a compiler rather than an
importer. Every special character is escaped, which is most of the work: a chat transcript is
full of unescaped backslashes, underscores in identifiers, dollar signs in shell snippets and
percent signs in numbers, any one of which turns a document into a compile error or silently
eats the rest of a line.

## Connector configuration

- Slack: `SLACK_USER_TOKEN`, or `SLACK_BOT_TOKEN` plus `SLACK_CHANNEL_IDS`
- Jira Cloud: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
- Figma: `FIGMA_PERSONAL_ACCESS_TOKEN` or `FIGMA_ACCESS_TOKEN`, plus `FIGMA_FILE_KEYS`
- Documents: comma-separated `DOCUMENT_FEED_URLS`, optionally `DOCUMENT_FEED_BEARER_TOKEN`
- Federated MCP server: `FANTASY_MCP_URL`, optionally `FANTASY_MCP_API_KEY`

All external connectors are read-only. Unconfigured sources stay visible as disabled, and a
failure in one is returned alongside the results from the others.
