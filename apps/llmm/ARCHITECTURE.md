# Architecture

```text
    LLM client            teammate / other device          ordinary app
        |                          |                            |
   lnkz-mcp (stdio)         GET /share/:token               REST /api/*
        |                          |                            |
        +------------- authentication boundary ------------------+
                                   |
                        +----------+-----------+
                        |    tool / route      |
                        |      handlers        |
                        +----+------+-----+----+
                             |      |     |
              +--------------+      |     +-----------------+
              |                     |                       |
      import normalizers    ConversationStore        federated search
       (chatgpt, claude,     (SQLite + FTS5 or        (slack, jira, figma,
       gemini, llmm,         handoffs, audit)         docs, MCP-to-MCP)
       markdown, text)             |
              |                    |
              +---> intel layer <--+
                    (analysis, packets, similarity,
                     conflicts, redaction)
```

## The boundary that matters

`ConversationStore` (`src/store/index.ts`) is the only storage contract in the relay. The REST
API and web console call it; the standalone `lnkz-mcp` adapter knows only the REST wire contract
and none of the storage details. Replacing SQLite with Postgres is one new class, not a rewrite.

Everything else is arranged so that no relay route owns a product capability. The adapter maps
the stable MCP surface to the REST routes, which keeps the two repositories independently
deployable.

## Storage

SQLite through Node's built-in `node:sqlite` remains the default when `DATABASE_URL` is absent.
That choice is deliberate: LLMM is meant to be run by one person on whatever machine they have,
and a native module that needs a compiler is a real barrier for that person. A deployment that
sets `DATABASE_URL` uses `PostgresConversationStore` instead, without changing the
`ConversationStore` contract or the MCP tool contract.

Conversations and messages are normalized tables. Search is a separate FTS5 table rebuilt on
write, ranked with `bm25()` weighted toward titles. User queries never reach FTS5 as written:
they are reduced to quoted terms joined by `AND`, and retried as `OR` when the strict form
returns nothing, because FTS5's grammar throws on ordinary punctuation.

Writes go through one transaction per conversation, so a partially written thread is not
possible. SQLite migrations are versioned with `PRAGMA user_version`; Postgres migrations are
an explicit release step (`npm run db:migrate`) and application startup fails closed when
`schema_migrations` is behind. The SQLite-to-Postgres importer supports a dry run before it
writes. A pre-SQLite `.data/llmm.json` is imported once on first boot rather than being silently
orphaned.

Postgres keeps `workspace_id` directly on conversations, messages, handoffs, audit events, and
rate-limit buckets. Every store operation starts a transaction and uses transaction-local
`set_config('app.workspace_id', ...)`; it never uses a pooled session setting. RLS policies
fail closed with `nullif(current_setting('app.workspace_id', true), '')::uuid`, and the runtime
role is a non-owner with no `BYPASSRLS`. The migration role owns the tables and is used only by
the release migration step.

Postgres search keeps a denormalized `search_text` alongside the normalized messages, then
indexes a weighted `tsvector` with GIN. Titles rank above summaries and message text, and
`ts_headline` supplies snippets. Search tests assert ordering and useful snippets rather than
exact database scores.

## Import

Each provider gets its own normalizer and a `looksLike` predicate, so detection is a property
of the format rather than a guess made at the call site. ChatGPT is the interesting one: its
export is a message *tree*, because edits branch the conversation, so importing the mapping
naively interleaves abandoned drafts with the real thread. LLMM walks back from `current_node`
to the root, which reconstructs exactly what the user saw.

Anything unrecognized is stored whole rather than split on a guess. Losing structure is
recoverable; inventing it is not.

## Intelligence without a model

Analysis, packets, conflict detection, and redaction are all rule based. A relay that needed an
API key to describe its own payload would be useless offline, non-deterministic, and untestable.
The trade is real and stated where it lands: `find_conflicts` reports candidates for review and
does not claim to adjudicate them.

A context packet exists because the handoff problem is not "send the chat", it is "send the chat
in a form the next model can act on without re-reading 40,000 tokens". The packet carries
decisions, open questions, action items, and a bounded recent excerpt, assembled to fit a
caller-supplied token budget.

## Handoffs

A handoff token is 192 bits of randomness. Only its SHA-256 digest is persisted, so the database
cannot leak working links. Each handoff carries an expiry, a use limit, an optional audience
label, and an optional redaction flag; every creation, redemption, rejection, and revocation is
written to an append-only audit table.

Redemption responses are `no-store` and `noindex`, and the public share route is rate limited
per client IP, because it is the one endpoint that grants read access without a key. Deployment
still requires TLS: the token is in the URL.

Redaction is conservative by design. A false negative is a leak, but a false positive silently
destroys context, so nothing matches on bare words, and the card-number pattern runs a Luhn
check so version strings and long identifiers survive.

## Federation

External systems implement one small `Connector` interface. Search calls the configured
connectors concurrently, reports individual failures alongside successful results, ranks
matches, and removes duplicates. One unavailable service can never hide another's results, and
an unconfigured source stays visible as disabled with the reason.

The Fantasy Copilot adapter is an MCP client talking to another MCP server, which is the
general shape: LLMM federates other MCP servers rather than reimplementing them.

## Hosting

One Node process serves the built site and REST API. The standalone `lnkz-mcp` process provides
local stdio MCP and calls the relay over the authenticated REST boundary. In the AWS deployment,
the cheap in-process limiter runs first and a Postgres bucket limiter runs second, so a burst is
rejected locally while the limit remains shared across instances.

The AWS reference deployment uses App Runner, a private RDS PostgreSQL instance, Secrets
Manager, a customer-managed KMS key, an encrypted S3 bucket, and CloudWatch logs. App Runner
uses a VPC connector to reach RDS. Because that connector removes ordinary public egress, the
default VPC has one NAT Gateway; S3 uses a free Gateway Endpoint. Direct AWS SDK calls would
also need NAT or interface endpoints, but App Runner's Secrets Manager environment injection is
platform-managed and does not make application traffic through the connector.

## Remaining multi-user boundary

SQLite remains intentionally single-process. The Postgres schema and RLS boundary are ready for
workspace-aware identity, but the request identity must set the workspace context rather than
relying on the deployment-wide `LNKZ_POSTGRES_WORKSPACE_ID` default. The shared bearer key is
still a deployment-level credential; public multi-user rollout must finish per-user identity,
scoped authorization, per-workspace handoff policy, and managed OAuth for connector installs.
