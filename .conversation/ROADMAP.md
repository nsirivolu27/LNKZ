# Roadmap

## Shipped

**Portability**

- Provider-neutral `lnkz.conversation.v1` schema and Markdown transcripts
- Importers for ChatGPT tree exports, Claude exports, Gemini payloads, chat-completions
  message arrays, LNKZ packets, Markdown transcripts, and unlabeled pasted text, with
  detection and a dry run
- A structural importer that locates the conversation in an export LNKZ has never seen,
  instead of shipping a guessed parser per vendor
- Export in eight formats including a compilable LaTeX document, every other one re-importable,
  with round-trip tests
- A graph over the corpus: conversations, decisions, open questions and shared topics, with
  lineage, similarity and contradiction edges that each carry their reason
- Discovery of downstream MCP servers, and preparing a conversation for one of their tools
  without sending anything
- Conversation lineage across clients

**Context intelligence**

- Model-free extraction of decisions, open questions, action items, facts, and topics
- Token-budgeted context packets
- Near-duplicate detection and cross-conversation contradiction candidates

**Relay safety**

- Expiring, use-limited, revocable handoffs with hashed tokens
- Append-only audit log, `no-store` responses, per-IP rate limiting on the public share route
- Optional secret redaction on export

**Platform**

- SQLite with FTS5 behind a storage interface, versioned migrations, legacy JSON import
- 20 MCP tools, 4 resources, 4 prompts over Streamable HTTP and stdio
- REST API, web console, single-container deploy, CI, and an end-to-end smoke test

## Next: production foundation

- Postgres repository implementing the existing `ConversationStore` interface
- Accounts, workspaces, roles, and scoped API tokens replacing the shared key
- Envelope encryption, retention rules, export, deletion, and per-workspace audit
- Shared rate-limit store so more than one instance can run
- Single-use-by-default handoffs, audience verification, and per-workspace handoff policy
- OAuth installation flows and webhook-based incremental connector sync

## Then: deeper context

- Embeddings behind the existing search interface, with BM25 as the fallback, not the ceiling
- Claim-level deduplication and a citation graph across conversations and connectors
- Decision records: a durable, revisable statement of what a thread settled and why
- Packet templates for common handoffs (review, debug, spec, incident)
- Writing back: turn a decision into a Jira issue or a Slack summary from the packet

## Then: ecosystem

- Browser capture extension and a mobile share sheet
- QR handoff for device-to-device transfer
- Connector SDK so a source can be added without touching the core
- Reference federations beyond the current examples
