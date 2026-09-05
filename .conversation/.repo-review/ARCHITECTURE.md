# Architecture

```text
    LLM client            teammate / other device          ordinary app
        |                          |                            |
   MCP (HTTP or stdio)      GET /share/:token               REST /api/*
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
      (chatgpt, claude,     (SQLite + FTS5,          (slack, jira, figma,
       gemini, lnkz,         handoffs, audit)         docs, MCP-to-MCP)
       markdown, text)             |
              |                    |
              +---> intel layer <--+
                    (analysis, packets, similarity,
                     conflicts, redaction)
```

## The boundary that matters

`ConversationStore` (`src/store/index.ts`) is the only storage contract in the system. MCP over
HTTP, MCP over stdio, the REST API, and the web console all call it; none of them knows what
is underneath. Replacing SQLite with Postgres is one new class, not a rewrite.

Everything else is arranged so that no transport owns a capability. A tool handler and a REST
route for the same operation call the same function, which is why the MCP surface and the API
never drift apart.

## Storage

SQLite through Node's built-in `node:sqlite`. That choice is deliberate: LNKZ is meant to be
run by one person on whatever machine they have, and a native module that needs a compiler is
a real barrier for that person. The cost is that `node:sqlite` is still flagged experimental
upstream, which is an acceptable trade for an MVP and a one-line change if it stops being true.

Conversations and messages are normalized tables. Search is a separate FTS5 table rebuilt on
write, ranked with `bm25()` weighted toward titles. User queries never reach FTS5 as written:
they are reduced to quoted terms joined by `AND`, and retried as `OR` when the strict form
returns nothing, because FTS5's grammar throws on ordinary punctuation.

Writes go through one transaction per conversation, so a partially written thread is not
possible. Migrations are versioned with `PRAGMA user_version`. A pre-SQLite `.data/lnkz.json`
is imported once on first boot rather than being silently orphaned.

## Import

Each provider gets its own normalizer and a `looksLike` predicate, so detection is a property
of the format rather than a guess made at the call site. ChatGPT is the interesting one: its
export is a message *tree*, because edits branch the conversation, so importing the mapping
naively interleaves abandoned drafts with the real thread. LNKZ walks back from `current_node`
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
general shape: LNKZ federates other MCP servers rather than reimplementing them.

## Hosting

One Node process serves the built site, the REST API, and `POST /mcp` as stateless Streamable
HTTP. A new `McpServer` and transport are constructed per request and torn down when the
response closes, which is what makes the endpoint safe to run behind an autoscaler.

## What has to change before this is multi-user

The shared API key, the single-instance in-process rate limiter, and the local SQLite file are
all single-tenant assumptions. Before a public multi-user release: workspace identities and
scoped authorization, encrypted Postgres, a shared rate-limit store, per-workspace handoff
policy, and managed OAuth for connector installs.
