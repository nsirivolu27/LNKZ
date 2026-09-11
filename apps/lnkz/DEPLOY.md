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
LNKZ_INSTANCE_NAME=Personal relay
ALLOWED_HOSTS=lnkz.example.com
ALLOWED_ORIGINS=https://lnkz.example.com
LNKZ_MCP_API_KEY_REQUIRED=true
LNKZ_MCP_CONTEXT_SECRET=...
NODE_ENV=production
LNKZ_ALLOW_UNAUTHENTICATED=false
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

Use two distinct Postgres roles:

- The migration-only role is the account in `DATABASE_URL` for `pnpm db:migrate`. It needs
  permission to create and alter the schema and should not be used by the running server.
- The runtime-only role is the non-owner, non-`BYPASSRLS` account in `DATABASE_URL` for
  `pnpm start`. Set its name in `LNKZ_DATABASE_APP_ROLE` only while running migrations so the
  migration command can grant it the required table permissions.

App Runner may provide `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, and
`DATABASE_SECRET_JSON` instead of `DATABASE_URL`. `DATABASE_HOST` and
`DATABASE_SECRET_JSON` are an inseparable pair: incomplete or malformed configuration fails
startup rather than silently selecting SQLite. The production image includes the AWS RDS global
CA bundle and enables verified TLS by default when `DATABASE_SSL` is not `false`.

The migration command refuses to run if the connected `DATABASE_URL` role is the same as
`LNKZ_DATABASE_APP_ROLE`.

```bash
pnpm build
# DATABASE_URL is the migration-only role for this command.
DATABASE_URL=postgresql://migration-role:...@host/lnkz \
  LNKZ_DATABASE_APP_ROLE=lnkz-app pnpm db:migrate
# DATABASE_URL is the runtime-only role for this command.
DATABASE_URL=postgresql://lnkz-app:...@host/lnkz pnpm start
```

The runtime role must not own application tables and must not have `BYPASSRLS`. `pnpm start`
verifies both properties against the connected role before it creates the HTTP listener; if either
is unsafe, it reports the exact property and exits without serving traffic. Migration setup is
intentionally not part of the runtime start path. Multi-key workspace authorization requires
Postgres and `LNKZ_AUTH_MODE=multi-key`.

For the AWS reference deployment, run CDK from `apps/llmm` with AWS
credentials and an explicit account/region. Synthesize and review the
template before enabling App Runner; the service is conditional and is not
deployed automatically. Push the reviewed image to the retained ECR
repository, provide an image tag, and obtain operator approval before setting
`EnableAppRunner=true`. The stack keeps RDS in private isolated subnets,
allows PostgreSQL only from the App Runner security group, enables verified
database TLS, and encrypts RDS/ECR/S3/secrets/logs with KMS.

## Health and rollout checks

- `GET /health` returns the service, MCP path, auth status, connector configuration, and only the
  enabled/disabled state of context forwarding.
- `POST /mcp` must be tested with an authorized bearer key.
- `/share/:token` is intentionally bearer-based, rate-limited, and uncached.
- Never cache `/api/*`, `/mcp`, or `/share/*` at a reverse proxy.

## Configuration

| Variable | Purpose |
| --- | --- |
| `LNKZ_API_KEY` | Compatibility bearer key; required in production |
| `LNKZ_API_KEYS_JSON` | Multi-workspace static principals |
| `LNKZ_AUTH_MODE` | `static` or `multi-key`; multi-key requires Postgres |
| `LNKZ_ALLOW_UNAUTHENTICATED` | Explicit local-development escape hatch |
| `NODE_ENV` | Set to `production` for deployed instances; authentication fails closed |
| `LNKZ_MCP_PATH` | MCP HTTP path, default `/mcp` |
| `LNKZ_MCP_API_KEY_REQUIRED` | Require a key for MCP requests |
| `LNKZ_MCP_CONTEXT_SECRET` | Shared HMAC secret for trusted multi-node MCP context forwarding; minimum 32 bytes |
| `LNKZ_INSTANCE_NAME` | Operator-facing display name published in the public instance identity document |
| `DATABASE_URL` | Switch from SQLite to Postgres |
| `DATABASE_HOST` | PostgreSQL hostname used with `DATABASE_SECRET_JSON` |
| `DATABASE_SECRET_JSON` | JSON object containing the runtime database `username` and `password` |
| `DATABASE_PORT` / `DATABASE_NAME` | Structured PostgreSQL connection values; defaults `5432` / `lnkz` |
| `DATABASE_SSL` | Set `false` only for local Postgres; production defaults to verified TLS |
| `LNKZ_DATABASE_APP_ROLE` | Runtime-only Postgres role granted by `pnpm db:migrate`; do not use it as the migration connection role |
| `LNKZ_MCP_TARGETS` | Downstream MCP targets for publish preparation |
| `SLACK_*`, `JIRA_*`, `FIGMA_*`, `DOCUMENT_FEED_*` | Optional read-only connectors |

All connector credentials stay in environment configuration and are never passed as MCP tool
arguments or persisted in conversation content by the relay itself. They are
instance-scoped: a connector configured on one deployment is not available to
another instance or automatically isolated per workspace. Treat connector
access as an operator-managed security boundary.

## Replit preview configuration

Configure backend values as secrets or private environment variables; do not commit their values:

```text
LNKZ_API_KEY
DATABASE_SECRET_JSON
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_SSL=true
LNKZ_POSTGRES_WORKSPACE_ID
ALLOWED_HOSTS=<exact backend hostname>
ALLOWED_ORIGINS=<exact Replit or Expo browser origin>
LNKZ_PUBLIC_BASE_URL=<public backend URL>
```

The mobile artifact needs only the public relay location:

```text
EXPO_PUBLIC_LNKZ_API_URL=<public backend URL>
```

Never place `LNKZ_API_KEY`, database credentials, handoff tokens, or MCP context secrets in an
`EXPO_PUBLIC_*` variable. Native credentials belong in secure device storage; the web preview must
keep temporary credentials in browser memory rather than a public bundle or URL.
