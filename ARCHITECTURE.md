# LNKZ architecture

## Five components, three surfaces

The REST API is the product boundary. REST, MCP over stdio, and stateless
Streamable HTTP MCP call the same workflow and storage code. A web client is a
separate project that calls REST.

1. **Store** (`src/lnkz/store/`): `ConversationStore` separates callers from
   SQLite (the default) and Postgres. SQLite uses built-in `node:sqlite`, FTS5,
   versioned migrations and a legacy JSON import. Postgres uses `tsvector`, a
   GIN index and workspace row-level security. Runtime roles must not own
   tables or bypass RLS; transactions apply workspace context before queries.
2. **Ingest and export** (`import/`, `export/`): normalize provider formats into
   ordered text messages, source, participants, tags and lineage. Supported
   formats and public operations belong in [MCP.md](MCP.md). Round-trip tests
   preserve portable content; LaTeX is a one-way presentation format.
3. **Intelligence** (`intel/`, `graph/`): deterministic rules extract decisions,
   questions, actions and facts with source-message references. Shingling and
   Jaccard find near duplicates; cosine similarity proposes conflicting claims.
   The graph connects conversations, claims and shared topics with reasons.
   These are candidates for human review. This layer makes no model calls.
4. **Handoff** (store methods and `transfer.ts`): random bearer tokens are stored
   only as SHA-256 hashes. Expiry, use limits, revocation and optional redaction
   constrain redemption. Events record creation, redemption and refusal.
   Transfer pulls a packet into the receiver's store and records origin lineage.
   The URL boundary rejects unsupported protocols, embedded credentials,
   private addresses by default, and redirects, and limits packet size and time.
5. **Surfaces** (`server.ts`, `mcp.ts`, `mcp-surfaces.ts`, `surfaces.ts`): validate
   and authorize requests, then call shared workflows. Optional connectors
   federate searches; publishing prepares a call for review without sending it.

## Identity boundary

Plain workspace headers are never trusted. API-key or managed request context
takes precedence over trusted-node forwarding. SQLite is single-tenant;
multi-key workspaces require Postgres. Forwarding protocol details are owned
by [MCP.md](MCP.md#multi-node-context-forwarding).

## Operating boundary

One process and one database are enough. [DEPLOY.md](DEPLOY.md) owns environment
variables, migrations, startup, health checks and backups. [ROADMAP.md](ROADMAP.md)
tracks unfinished operational and transfer work.
