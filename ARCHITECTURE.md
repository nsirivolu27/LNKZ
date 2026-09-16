# LNKZ architecture

## Five components, three surfaces

The REST API is the product boundary. REST, MCP over stdio, and stateless
Streamable HTTP MCP call the same workflow and storage code. The web client in
`apps/web` calls REST and shares no database access with the relay.

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
4. **Handoff** (`handoffs/wire.ts`, store methods and `transfer.ts`): random
   bearer tokens are stored only as SHA-256 hashes. Expiry, use limits,
   revocation and optional redaction constrain redemption. Events record
   creation, redemption, preview and refusal. Transfer pulls a packet into the
   receiver's store and records origin lineage. The URL boundary rejects
   unsupported protocols, embedded credentials, private addresses by default,
   and redirects, and limits packet size and time.
   Looking and taking are separate operations. `GET /share/:token/preview`
   reports a title, a provider and a count without incrementing uses and never
   returns the transcript, because the route is unauthenticated exactly like
   redemption. It answers `410` when the link is dead so a caller can tell that
   apart from the `404` an older relay returns for a route it lacks.
   Continuation lineage is assembled in one place (`continuation.ts`) for every
   transport. A continuation of a local handoff points at its parent row; one
   from another instance does not, because that row is on a machine this one
   does not own. `rootId` crosses either way, since it identifies the chain
   rather than a row, and is what lets a conversation come home and still
   resolve to the original.
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

## Repository boundary

Three products, built in order, each depending only on the one before it.

**LNKZ**, this repository, is the relay and the thing people use. It owns
conversation storage, ingest, analysis, packets, handoffs, transfer, lineage,
the REST API, the web console and the Expo client. It knows nothing about
adapters or packages.

**lnkz-mcp**, a separate repository, is a thin adapter over this REST API for
people who run a relay elsewhere and want a local MCP server pointed at it.
`LNKZ_BASE_URL` and `LNKZ_API_KEY` configure it and it fails closed without
them. It holds no store, no authentication implementation and no conversation
logic.

That adapter does not replace the MCP surface inside this repository.
`mcp.ts`, `mcp-surfaces.ts` and the stdio entry point talk to the store
in-process and are staying. These are two transports onto one implementation,
not two implementations. If lnkz-mcp ever needs to import from `src/lnkz`, the
boundary is wrong and the fix is in lnkz-mcp.

**The marketplace** distributes configuration for MCP servers. It is described
in [MARKETPLACE.md](MARKETPLACE.md) and is not built. It depends on the adapter
existing, which depends on this relay being finished, and nothing is scaffolded
for it here in the meantime: a placeholder for a product two gates away is how
a boundary gets designed before anyone knows what it needs to carry.

## Workspace and build

The root package owns the relay. `@lnkz/web` owns the existing landing page and
console brought over from LLMM. `apps/mobile` is the Expo client, which calls
the same REST API and holds no storage of its own beyond the connection
credentials in the device keychain. `@lnkz/infra` owns the optional AWS CDK
stack.
All packages share the root pnpm lockfile. The build bundles the relay into
`dist/index.mjs` and the web app into `dist/web`. The same Node process serves
the two public HTML entry points and their assets alongside authenticated REST
and MCP. Unknown API paths remain JSON 404 responses; source and configuration
files are never part of the static root.
