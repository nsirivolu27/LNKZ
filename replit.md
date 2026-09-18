# LNKZ Mobile and API

LNKZ captures, searches, packages, and securely hands off conversation context
from a mobile client through an authenticated API.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the LNKZ API server
- `pnpm --filter @workspace/mobile run dev` — run the Expo mobile app
- `pnpm run typecheck` — typecheck the mobile/API workspace
- `pnpm run build` — typecheck and build the API
- `pnpm run build:mobile` — create the static Expo Go build
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string; the development database must have LNKZ migrations applied

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API/MCP: Express 5 with stateless Streamable HTTP and REST
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/src/lnkz/` — LNKZ API, MCP tools, storage, imports, analysis, and connectors
- `artifacts/api-server/.replit-artifact/artifact.toml` — preview and publishing configuration

## Architecture decisions

- Product name is LNKZ; `LNKZ_*` environment variables, MCP tool names, and `lnkz://` resource URIs remain compatibility contracts.
- MCP and REST share the same `ConversationStore` contract.
- SQLite remains local single-tenant mode; Postgres provides workspace RLS and actor-scoped authorization.

## Product

Import a conversation, normalize it, extract decisions and open questions, build a bounded context packet, hand it to another model/person/device, and continue it with lineage preserved.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run the Postgres migrations before starting the server when `DATABASE_URL` is present.
- Use the shared preview proxy for testing (`http://localhost:80/health`), not the internal service port.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
