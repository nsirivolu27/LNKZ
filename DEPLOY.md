# Operating LNKZ

Use Node 22.16 or newer in the Node 22 line and pnpm 10.26.1. Commands below
use Bash. Inject credentials through environment variables or a secret manager;
the server does not automatically load `.env`. Docker Compose reads `.env`.

## Fly.io with SQLite

Prerequisites: a Fly account, billing enabled, the [Fly CLI](https://fly.io/docs/flyctl/install/),
Node, and this repository. Choose your organization when creating the app.
This creates one machine and one persistent volume; SQLite cannot share a
volume across machines. These commands incur the host's normal charges.

```bash
set -eu
corepack enable
corepack pnpm install --frozen-lockfile
pnpm build
fly auth login
APP="lnkz-$(node -e 'console.log(require("node:crypto").randomBytes(6).toString("hex"))')"
fly apps create "$APP"
fly volumes create lnkz_data --app "$APP" --region iad --size 1 --yes
export LNKZ_API_KEY="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')"
printf 'LNKZ_API_KEY=%s\nLNKZ_PUBLIC_BASE_URL=https://%s.fly.dev\nALLOWED_HOSTS=%s.fly.dev,localhost,127.0.0.1\nALLOWED_ORIGINS=https://%s.fly.dev\n' "$LNKZ_API_KEY" "$APP" "$APP" "$APP" | fly secrets import --app "$APP" --stage
fly deploy --app "$APP" --ha=false
fly checks list --app "$APP"
pnpm smoke "https://$APP.fly.dev"
pnpm seed "https://$APP.fly.dev"
```

Keep the generated key in your password manager before closing this shell.
Do not enable shell tracing. A repeat deployment uses the same app and volume:
`fly deploy --app "$APP" --ha=false`. Store the app name with your runbook.

The readiness probe sends `Host: localhost:3100`, admitted by the existing
loopback allowlist. Host checks stay enabled for other traffic. Fly's service
checks control routing; they are separate from process liveness. See the
[configuration reference](https://fly.io/docs/reference/configuration/),
[health-check behavior](https://fly.io/docs/reference/health-checks/), and
[secret import command](https://fly.io/docs/flyctl/secrets-import/).

## Configuration reference

Required for public production: set `NODE_ENV=production`, an authentication
source, `HOST=0.0.0.0`, the public URL, and host/origin allowlists. Startup errors
name `LNKZ_API_KEY` or `LNKZ_API_KEYS_JSON` when authentication is missing.

| Variable | Default / behavior when absent |
| --- | --- |
| `NODE_ENV` | Development behavior; set `production` publicly |
| `HOST`, `PORT` | `127.0.0.1`, `3100`; container sets host to `0.0.0.0` |
| `LNKZ_PUBLIC_BASE_URL` | Derived from host/port; set the externally reachable HTTPS origin for handoff links |
| `ALLOWED_HOSTS` | SDK defaults; set comma-separated public names; loopback names are retained for probes |
| `ALLOWED_ORIGINS` | Same-origin requests only; add explicit comma-separated browser origins |
| `LNKZ_API_KEY` | No principal; production refuses startup without this or the JSON principal list |
| `LNKZ_API_KEYS_JSON` | Optional nonempty array of `{key, workspaceId, actorId, scopes}`; replaces the single-key principal |
| `LNKZ_AUTH_MODE` | `static`; `multi-key` requires Postgres and configured principals |
| `LNKZ_DEFAULT_ACTOR_ID` | `system` for the single-key principal |
| `LNKZ_ALLOW_UNAUTHENTICATED` | True outside production, false in production; local use only |
| `LNKZ_MCP_ENABLED`, `LNKZ_MCP_PATH` | `true`, `/mcp` |
| `LNKZ_MCP_API_KEY_REQUIRED` | `false`; when true, requires configured principals; production API auth covers MCP too |
| `LNKZ_MCP_CONTEXT_SECRET` | Forwarding disabled; optional shared secret of at least 32 bytes, see [MCP trust protocol](MCP.md#multi-node-context-forwarding) |
| `LNKZ_DB_FILE` | `.data/lnkz.db`; SQLite file, ignored when Postgres is selected |
| `LNKZ_DATA_FILE` | `.data/lnkz.json`; legacy import into an empty SQLite database |
| `DATABASE_URL` | SQLite selected when absent, unless split database credentials below are complete |
| `DATABASE_SECRET_JSON`, `DATABASE_HOST` | Optional JSON username/password plus hostname, used only without `DATABASE_URL` |
| `DATABASE_PORT`, `DATABASE_NAME` | `5432`, `lnkz` for split database credentials |
| `DATABASE_SSL` | Verified TLS; `false` disables TLS for a local test database only |
| `LNKZ_DATABASE_APP_ROLE` | No grants added by migration; set the existing non-owner application role |
| `LNKZ_POSTGRES_WORKSPACE_ID` | `00000000-0000-4000-8000-000000000001`; default workspace UUID |
| `LNKZ_PG_POOL_MAX` | `8`, bounded to 1–32 connections |
| `LNKZ_PG_IDLE_TIMEOUT_MS` | `30000` |
| `LNKZ_PG_CONNECTION_TIMEOUT_MS` | `5000` |
| `LNKZ_PG_MAX_LIFETIME_SECONDS` | `300` |
| `LNKZ_MAX_BODY` | `24mb` JSON request limit |
| `LNKZ_TRUST_PROXY` | `false`; use a verified hop count only when the proxy overwrites forwarded client headers |
| `LNKZ_RATE_LIMIT_WINDOW_MS` | `60000`, range 1000–86400000 |
| `LNKZ_SHARE_RATE_LIMIT`, `LNKZ_API_RATE_LIMIT` | `60`, `600` per window; zero disables the respective limiter |
| `LNKZ_SHUTDOWN_TIMEOUT_MS` | `10000`, range 1000–120000; Fly uses 25000 below its 30-second stop window |
| `LNKZ_TRANSFER_ALLOW_PRIVATE` | Private-address transfer refused; exact `true` is for local two-instance demos |
| `LNKZ_BASE_URL` | `http://127.0.0.1:3100` for seed/smoke scripts; CLI URL argument wins |
| `WEB_DIST_DIR` | Legacy configuration accepted; no console is served |

Optional connectors remain unconfigured until their inputs are complete:

| Variables | Use |
| --- | --- |
| `SLACK_USER_TOKEN` or `SLACK_BOT_TOKEN`; `SLACK_CHANNEL_IDS` | Slack search; bot mode requires channel IDs |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Jira read access |
| `FIGMA_PERSONAL_ACCESS_TOKEN` or `FIGMA_ACCESS_TOKEN`; `FIGMA_FILE_KEYS` | Figma files |
| `DOCUMENT_FEED_URLS`, `DOCUMENT_FEED_BEARER_TOKEN` | Comma-separated document feeds and optional bearer token |
| `FANTASY_MCP_URL`, `FANTASY_MCP_API_KEY` | Optional downstream MCP connection |
| `LNKZ_MCP_TARGETS` | Comma-separated `name=url` or `name=url|key` publish-discovery targets |

## Docker

```bash
cp .env.example .env
node -e 'require("node:fs").appendFileSync(".env", "LNKZ_API_KEY=" + require("node:crypto").randomBytes(32).toString("base64url") + "\n")'
docker compose up --build -d
curl --fail http://localhost:3100/ready
```

Set public URL and allowlists in `.env` before exposing it. The entrypoint
initializes ownership of a newly mounted volume, then runs Node as `lnkz`.
Terminate TLS at the proxy. Never cache `/api/*`, `/mcp`, or `/share/*`.

## Health, logs and shutdown

- `/health` is liveness: the process responds without querying storage.
- `/ready` runs a store query, returning 200 or 503 within two seconds. It is
  unavailable during shutdown. Both endpoints require an admitted Host header.
- Request stdout is JSON: `method`, route-template `path`, `status`,
  `durationMs`, authenticated `workspace` (null otherwise), and generated
  `requestId`. The response exposes the same ID. Headers, query strings,
  message bodies, arbitrary paths, and handoff tokens are excluded.
- SIGTERM/SIGINT stop accepting connections, drain active responses, then await
  store and rate-limit pool closure. Timeout exits nonzero. Allow the platform
  more time than `LNKZ_SHUTDOWN_TIMEOUT_MS`.

If readiness fails, check disk space, file ownership, database connectivity and
schema version. Do not use readiness as a Kubernetes liveness probe: a database
outage should remove traffic, not create a restart loop. Use `/ready` for an
App Runner HTTP service check. After rollout, run `pnpm smoke "$PUBLIC_URL"`
with the API key in the environment. The script removes its synthetic conversation;
its audit events remain. `pnpm verify:http` exercises local MCP forwarding and stdio.

## Postgres release and tests

Create a separate migration owner and a runtime login without ownership,
superuser or BYPASSRLS privileges. Put their URLs in `MIGRATION_DATABASE_URL`
and `APP_DATABASE_URL` through your secret manager, then run:

```bash
pnpm build
DATABASE_URL="$MIGRATION_DATABASE_URL" LNKZ_DATABASE_APP_ROLE=lnkz_app pnpm db:migrate
DATABASE_URL="$APP_DATABASE_URL" pnpm start
```

The built artifact includes every SQL migration. The server checks the expected
schema before listening and refuses an incompatible version. A Fly Postgres
deployment can run the built migration in its release command, with a separate
migration credential; do not give the web process the migration role. The
SQLite `fly.toml` intentionally has no database release command.

Use dedicated disposable databases for integration tests:

```bash
LNKZ_POSTGRES_MIGRATION_URL="$MIGRATION_DATABASE_URL" LNKZ_POSTGRES_TEST_URL="$APP_DATABASE_URL" LNKZ_DATABASE_APP_ROLE=lnkz_app pnpm test
```

Only for a local non-TLS test server, also set `DATABASE_SSL=false`.

## Backup and restore

SQLite's backup API captures a consistent snapshot including committed WAL
changes. Do not copy only the live `.db` file.

```bash
pnpm db:backup ./lnkz-backup.db
node --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync("lnkz-backup.db",{readOnly:true}); console.log(db.prepare("PRAGMA integrity_check").get()); db.close();'
```

For a Fly volume, run the same backup API inside the machine and download it:

```bash
fly ssh console --app "$APP" --command 'node --input-type=module -e '\''import {DatabaseSync,backup} from "node:sqlite";const db=new DatabaseSync("/app/.data/lnkz.db",{readOnly:true});await backup(db,"/tmp/lnkz-backup.db");db.close();'\'''
fly ssh sftp get --app "$APP" /tmp/lnkz-backup.db ./lnkz-backup.db
```

Restore into a new path, with the application stopped. Keep the old database and
its WAL files together until the restored service is verified:

```bash
# Stop pnpm start with Ctrl-C first.
mkdir -p .data/restored
cp ./lnkz-backup.db .data/restored/lnkz.db
LNKZ_DB_FILE=.data/restored/lnkz.db pnpm start
```

For Fly, upload the verified backup under a new filename and select it on
restart; the previous database remains available for rollback:

```bash
fly ssh sftp put --app "$APP" ./lnkz-backup.db /app/.data/restored.db
fly ssh console --app "$APP" --command 'chown lnkz:lnkz /app/.data/restored.db'
fly secrets set --app "$APP" LNKZ_DB_FILE=/app/.data/restored.db
pnpm smoke "https://$APP.fly.dev"
```

Stop writes during the restore window and use a fresh destination filename each
time. Store backups off the machine and restrict access like production data.

Postgres: use the matching major-version client tools, a backup role that can
read all workspaces (RLS otherwise filters data), and a newly created restore
database. Use `PGSERVICE`/`.pg_service.conf` and a restricted `.pgpass` so passwords
do not appear in command arguments:

```bash
PGSERVICE=lnkz_backup pg_dump --format=custom --no-owner --file=lnkz-backup.dump
PGSERVICE=lnkz_restore pg_restore --exit-on-error --single-transaction --no-owner --dbname=lnkz_restored lnkz-backup.dump
DATABASE_URL="$RESTORED_MIGRATION_DATABASE_URL" LNKZ_DATABASE_APP_ROLE=lnkz_app pnpm db:migrate
DATABASE_URL="$RESTORED_APP_DATABASE_URL" pnpm start
```

The destination must be empty. Verify readiness, search and a handoff before
switching traffic. Restore database roles/grants separately; `pg_dump` does not
back up global roles. Keep the original database until verification completes.
