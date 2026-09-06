# Deploying LNKZ

LNKZ is a single Node container with a persistent SQLite volume or a Postgres connection. There is
no web console in this repository.

## Docker

```bash
cp .env.example .env
# Set a long random LNKZ_API_KEY and production host/origin values.
docker compose up --build
curl http://localhost:3100/health
```

Mount `/app/.data` if using SQLite. Without a persistent volume, conversations disappear when the
container is replaced. Terminate TLS in front of the service because handoff tokens are bearer
secrets in URLs.

## Production settings

Set all of these for a public deployment:

```bash
LNKZ_API_KEY=...
LNKZ_PUBLIC_BASE_URL=https://lnkz.example.com
ALLOWED_HOSTS=lnkz.example.com
ALLOWED_ORIGINS=https://lnkz.example.com
LNKZ_MCP_API_KEY_REQUIRED=true
LNKZ_MCP_CONTEXT_SECRET=...
```

Production fails during startup when authentication is not configured. Do not use
`LNKZ_ALLOW_UNAUTHENTICATED=true` outside local development.

If a reverse proxy overwrites `X-Forwarded-For`, set `LNKZ_TRUST_PROXY=true`; otherwise leave it
false so clients cannot spoof rate-limit identity.

`LNKZ_MCP_CONTEXT_SECRET` is needed only when one LNKZ node calls another without a target-specific
API key and must preserve the authenticated actor context. Generate at least 32 random bytes and
store the value in the deployment secret manager. Every mutually trusting node must use the same
value. Never expose it through client configuration, logs, health checks, or committed environment
files. Nodes without the value keep forwarding disabled and still support ordinary API-key MCP.

## Postgres

Run migrations with a migration-capable role, then run the server with a separate non-owner role:

```bash
pnpm build
DATABASE_URL=postgresql://migration-role:...@host/lnkz pnpm db:migrate
DATABASE_URL=postgresql://lnkz-app:...@host/lnkz pnpm start
```

Set `LNKZ_DATABASE_APP_ROLE` during migration to grant the application role table DML. The runtime
role must not own tables and must not have `BYPASSRLS`. Multi-key workspace authorization requires
Postgres and `LNKZ_AUTH_MODE=multi-key`.

## Health and rollout checks

- `GET /health` returns the service, MCP path, auth status, connector configuration, and only the
  enabled/disabled state of context forwarding.
- `POST /mcp` must be tested with an authorized bearer key.
- `/share/:token` is intentionally bearer-based, rate-limited, and uncached.
- Never cache `/api/*`, `/mcp`, or `/share/*` at a reverse proxy.
