# LNKZ architecture

```text
MCP client / REST caller / teammate handoff
                    |
          authentication + origin boundary
                    |
       shared workflow handlers and surfaces
          /          |          \
     import     ConversationStore    federation
                  /       \
             SQLite       Postgres
                    |
        analysis, packets, graph, redaction
```

## Core boundary

`ConversationStore` is the storage contract. REST routes, MCP tools, handoffs, search, and context
packet generation call the same store and workflow functions. Storage can switch from SQLite to
Postgres without changing the conversation or MCP contracts.

## Storage

SQLite is the default for a local, single-tenant deployment. It uses Node's built-in SQLite
support, versioned migrations, FTS5 search, and a legacy JSON import path. Postgres activates when
`DATABASE_URL` is present. Postgres stores workspace context on conversations, messages, handoffs,
events, and rate-limit buckets; transactions apply workspace context before queries and RLS fails
closed without it.

The migration role is separate from the runtime role. Runtime roles must not own tables or bypass
RLS. Run `pnpm build` followed by `pnpm db:migrate` for Postgres schema changes.

## Relay safety

Handoff tokens are random bearer secrets. Only their hashes are stored. Handoffs include expiry,
maximum uses, revocation, audience, optional redaction, and audit events. Share redemption is
rate-limited and returned with `no-store` and `noindex`; deploy behind TLS.

## Intelligence

Import detection, normalization, decisions, open questions, actions, topics, conflicts, duplicate
detection, graph construction, redaction, and context packets are deterministic and model-free.
This keeps the relay useful offline and makes the workflow predictable for downstream LLMs.

## Hosting

One Node process serves the REST API and stateless Streamable HTTP MCP endpoint. A separate stdio
entrypoint supports MCP hosts that launch a local process. The container has no web console or
LLMM-specific UI assets; this repository owns only the relay workflow.
