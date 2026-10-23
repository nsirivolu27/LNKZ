# LLMM — Large Language Model Mover

LLMM moves useful conversation context between large language models, AI clients, devices, and people.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the LLMM server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string; the development database must have LLMM migrations applied

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API/MCP: Express 5 with stateless Streamable HTTP
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/lnkz/` — LLMM server, MCP tools, storage, imports, analysis, and connectors
- `artifacts/api-server/web-dist/` — LLMM web console and landing page
- `artifacts/api-server/.replit-artifact/artifact.toml` — preview and publishing configuration
- `.local/conversation-workspace/files/` — preserved upstream repository materials used during migration

## Architecture decisions

- Product name is LLMM; `LNKZ_*` environment variables, MCP tool names, and `lnkz://` resource URIs remain compatibility contracts.
- MCP, REST, and the web console share the same `ConversationStore` contract.
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
