# LNKZ

**Portable conversation workflow for moving useful context between LLMs, apps, devices, and people.**

This repository contains the focused LNKZ relay workflow: the stateless MCP server, REST API,
conversation import/export pipeline, context intelligence, handoffs, storage, connectors, and
deployment configuration. It is intentionally independent of the
[`nsirivolu27/LLMM`](https://github.com/nsirivolu27/LLMM) product repository: LLMM owns its web
console and product UI, while LNKZ remains a standalone relay/MCP workflow with no LLMM-specific
branding or frontend code.

## What it does

- Imports ChatGPT, Claude, Gemini, OpenAI-compatible, Markdown, plain-text, and LNKZ conversations.
- Builds bounded context packets containing decisions, open questions, actions, facts, and excerpts.
- Exports normalized conversations to portable formats.
- Creates expiring, use-limited, revocable handoff links with optional secret redaction.
- Preserves conversation lineage across clients.
- Searches conversations and optional Slack, Jira, Figma, documentation, and downstream MCP sources.
- Exposes the same workflow through REST, stateless Streamable HTTP MCP, and stdio MCP.
- Preserves authenticated actor and workspace context across trusted MCP nodes with short-lived signed envelopes.
- Uses SQLite by default and Postgres when `DATABASE_URL` is configured.

## Quick start

Requirements: Node 22.5+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm build
pnpm start
```

The server listens on `http://127.0.0.1:3100` by default. For a local unauthenticated run, set
`LNKZ_ALLOW_UNAUTHENTICATED=true`; otherwise set `LNKZ_API_KEY`.

MCP clients connect to:

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

## Development workflow

```bash
pnpm typecheck
pnpm build
pnpm dev
```

For Postgres, run the built migration entrypoint before starting the server:

```bash
pnpm build
DATABASE_URL=postgresql://... pnpm db:migrate
```

SQLite remains the default when `DATABASE_URL` is absent and stores data under `.data/lnkz.db`.

## Deployment

```bash
cp .env.example .env
# Set LNKZ_API_KEY, LNKZ_PUBLIC_BASE_URL, ALLOWED_HOSTS, and ALLOWED_ORIGINS.
docker compose up --build
```

Production starts fail closed unless `LNKZ_API_KEY` or `LNKZ_API_KEYS_JSON` is configured. See
[DEPLOY.md](DEPLOY.md) for storage, Postgres, proxy, and health-check guidance.

For a multi-node deployment, give each trusted LNKZ node the same high-entropy
`LNKZ_MCP_CONTEXT_SECRET`. LNKZ signs the active workspace, actor, scopes, expiry, and trace before
calling another MCP node; receiving nodes accept it only on the MCP endpoint. See [MCP.md](MCP.md)
for the trust and key-rotation details.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — storage contract and relay boundaries
- [MCP.md](MCP.md) — MCP tools, resources, prompts, REST routes, and environment variables
- [DEPLOY.md](DEPLOY.md) — Docker, SQLite, Postgres, and production configuration
- [ROADMAP.md](ROADMAP.md) — workflow-focused next steps

## Compatibility

The `LNKZ_*` environment variables, MCP names, tool names, and `lnkz://` resource URIs are stable
compatibility contracts. The workflow intentionally remains independent of any user interface.
