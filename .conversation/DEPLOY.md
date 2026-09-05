# Deploying LNKZ

LNKZ runs as one container: a Node process serving the site, the REST API, and the MCP
endpoint. It needs a persistent disk, because the SQLite store lives on it, and TLS, because
a handoff token travels in a URL.

Fly is the default below. Render is equivalent and covered at the end.

## 0. Build it locally first

Do this before anything else. The container's first stage runs the same web build, so a
failure here is a failure there, and finding it locally takes seconds instead of a deploy
cycle.

```powershell
npm install
npm ci --prefix mcp-server
npm run typecheck
npm test
npm run build
node scripts/smoke.mjs
```

`npm run build` should leave `dist/index.html` and `dist/console.html` next to a hashed
`dist/assets/` folder. If it does not, stop and fix that before touching Fly.

## Before you start

You need the Fly CLI and an account:

```powershell
winget install --id Fly.Flyctl
fly auth login
```

Pick a name now. It appears in three places that must agree: `fly.toml`, the secrets below,
and the health check header. Anywhere this file says `lnkz`, substitute yours.

## 1. Create the app without deploying

```powershell
fly launch --no-deploy --name lnkz --region iad
```

Answer no if it offers to tweak settings; `fly.toml` in this repo is already correct. If you
chose a name other than `lnkz`, open `fly.toml` and update both `app = "lnkz"` and the
`Host = "lnkz.fly.dev"` line under the health check.

## 2. Create the volume

```powershell
fly volumes create lnkz_data --size 1 --region iad
```

This is not optional. Without it the SQLite file lives in the machine's ephemeral filesystem
and every deploy silently wipes your conversations.

## 3. Set the secrets

```powershell
fly secrets set `
  LNKZ_API_KEY=(python -c "import secrets;print(secrets.token_urlsafe(32))") `
  LNKZ_PUBLIC_BASE_URL=https://lnkz.fly.dev `
  ALLOWED_HOSTS=lnkz.fly.dev `
  ALLOWED_ORIGINS=https://lnkz.fly.dev
```

What each one does, because getting these wrong is the usual first-deploy failure:

| Variable | Why it matters |
| --- | --- |
| `LNKZ_API_KEY` | Without it the API and the MCP endpoint are open to anyone who finds the URL. The server logs a warning at boot if it is unset. |
| `LNKZ_PUBLIC_BASE_URL` | The origin baked into every `shareUrl`. Set it wrong and handoff links point somewhere that does not exist. Must be `https`. |
| `ALLOWED_HOSTS` | DNS rebinding protection. Must be the bare hostname, no scheme, no trailing slash. Loopback names are added automatically so the container's own health check is not rejected. |
| `ALLOWED_ORIGINS` | Blocks cross-origin browser requests. Must include the scheme. |

Connector credentials are optional and go in the same way, for example
`fly secrets set SLACK_BOT_TOKEN=... SLACK_CHANNEL_IDS=C123`. Anything unset stays visibly
disabled rather than failing.

## 4. Deploy

```powershell
fly deploy
```

The image builds the site and the server in separate stages and ships neither toolchain, runs
as a non-root user, and carries a health check.

## 5. Verify it for real

The repo's smoke test accepts a URL, so point it at production and let it drive the live
server over both REST and MCP:

```powershell
$env:LNKZ_API_KEY = (fly secrets list | Select-String LNKZ_API_KEY)  # or paste the value you set
node scripts/smoke.mjs https://lnkz.fly.dev
```

Fourteen checks should pass, covering auth, import, search, packet building, handoff
redemption, single-use exhaustion, MCP initialize, a live tool call, and the audit trail.

A quick manual pass:

```powershell
curl https://lnkz.fly.dev/health
start https://lnkz.fly.dev/console.html
```

## 6. Point a client at it

```json
{
  "mcpServers": {
    "lnkz": {
      "url": "https://lnkz.fly.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_LNKZ_API_KEY" }
    }
  }
}
```

Ask the client to call `list_connectors`, then `import_conversation`, then
`build_context_packet`. That sequence is the whole product in three calls and makes a good
demo.

## If something goes wrong

**Every request returns 403.** `ALLOWED_HOSTS` does not match the hostname you are using.
It takes a bare hostname; `https://lnkz.fly.dev` is wrong, `lnkz.fly.dev` is right.

**The machine never reports healthy.** The health check header in `fly.toml` does not match
the app name. Both must be the same domain.

**Share links point at localhost.** `LNKZ_PUBLIC_BASE_URL` was not set before the handoff was
created. Existing links stay broken; set it and mint new ones.

**Conversations vanish after a deploy.** The volume is missing or not mounted at `/app/data`.
Check with `fly volumes list` and `fly ssh console -C "ls -la /app/data"`.

**401 on everything.** The key is right but the header is not. It must be
`Authorization: Bearer <key>`.

Logs: `fly logs`. Shell: `fly ssh console`.

## Cost and idling

`fly.toml` sets `auto_stop_machines = "suspend"` with `min_machines_running = 0`, so the
machine suspends when idle and resumes on the next request. A suspended machine keeps its
volume. First request after idling takes a moment. To keep it always warm for a demo, set
`min_machines_running = 1`.

## Render instead

`render.yaml` is a working blueprint. In the Render dashboard choose Blueprint, point it at
the repository, and set `LNKZ_PUBLIC_BASE_URL`, `ALLOWED_HOSTS`, and `ALLOWED_ORIGINS` to your
`onrender.com` domain when prompted. `LNKZ_API_KEY` is generated for you; read it from the
service's environment tab. The disk is declared in the blueprint and mounts at `/app/data`.

## Backups

The whole store is one file. Back it up with:

```powershell
fly ssh console -C "cat /app/data/lnkz.db" > lnkz-backup.db
```

Do this before any schema change. When LNKZ moves to Postgres, this section is replaced by
ordinary database backups.

## AWS reference deployment: App Runner + private RDS

The repository also contains a CDK reference stack in `infra/`. It creates a VPC, one NAT
Gateway, private RDS PostgreSQL, an S3 Gateway Endpoint, a customer-managed KMS key, encrypted
S3 exports, Secrets Manager secrets, an ECR repository, App Runner roles, a VPC connector, and
CloudWatch log retention. The default App Runner configuration is capped at three instances.
With eight Postgres connections per instance, the application budget is 24 connections, leaving
headroom on a `db.t4g.micro`.

Check App Runner availability in the target AWS account before committing to this path. AWS may
not accept new App Runner customers in every account or region. If the service is unavailable,
keep the same VPC, RDS, secrets, and container image and run the service on ECS Fargate instead.

### 1. Bootstrap the infrastructure

The first deployment creates the ECR repository but does not create App Runner, because App
Runner needs an image that is already in ECR:

```bash
npm install
npm run infra:synth
npx cdk bootstrap
npx cdk deploy LnkzProduction \
  --parameters EnableAppRunner=false \
  --outputs-file cdk-outputs.json
```

Record the `RepositoryUri`, `MigrationSecretArn`, `ApplicationDatabaseSecretArn`, and
`DatabaseEndpoint` outputs. Push the image after building it:

```bash
docker build -f mcp-server/Dockerfile -t lnkz:release .
docker tag lnkz:release "$REPOSITORY_URI:$IMAGE_TAG"
docker push "$REPOSITORY_URI:$IMAGE_TAG"
```

The application secret is intentionally separate from the migration secret. Retrieve both
through AWS Secrets Manager, create the `lnkz_app` login with the application secret's password,
and run the migration as the migration role:

```bash
export DATABASE_URL='postgresql://lnkz_migrator:...@PRIVATE_RDS_ENDPOINT:5432/lnkz'
export LNKZ_DATABASE_APP_ROLE=lnkz_app
npm --prefix mcp-server run db:migrate
```

`db:migrate` owns DDL and grants only table DML to `lnkz_app`; it does not grant ownership or
`BYPASSRLS`. The application role must never be used to run migrations. Keep the migration
credential in the release environment, not in the App Runner runtime.

### 2. Enable App Runner

Deploy the image tag and the public URL parameters. App Runner injects the API key and the
application database username/password from Secrets Manager; the application supplies the
non-secret RDS host, port, and database name as environment variables and constructs its
connection URL. No application request to Secrets Manager is required.

```bash
npx cdk deploy LnkzProduction \
  --parameters EnableAppRunner=true \
  --parameters ImageTag="$IMAGE_TAG" \
  --parameters PublicBaseUrl=https://YOUR_PUBLIC_HOST \
  --parameters AllowedHosts=YOUR_PUBLIC_HOST \
  --parameters AllowedOrigins=https://YOUR_PUBLIC_HOST
```

The VPC connector is required for private RDS access. It also means ordinary public egress is
not available without the NAT Gateway. The S3 Gateway Endpoint avoids paying NAT for S3. Keep
CloudFront/WAF out of v1 to avoid roughly $10–15/month of fixed cost; if public signup or share
abuse justifies adding them later, never cache `/api/*`, `/mcp`, or `/share/*`.

### 3. Release and smoke test

Run migrations explicitly before shifting traffic, then exercise the deployed service:

```bash
node scripts/smoke.mjs https://YOUR_PUBLIC_HOST
```

The smoke test can exercise a local Postgres mode too. Set `SMOKE_DATABASE_URL` to a migrated
database URL and run `node scripts/smoke.mjs`; without it, the test deliberately boots SQLite.
The Postgres integration tests additionally require `LNKZ_POSTGRES_MIGRATION_URL` and a separate
non-owner `LNKZ_POSTGRES_TEST_URL`, so unset, empty, and foreign workspace contexts are tested
under RLS rather than through a superuser connection.

The stack deliberately does not create database roles through CDK: RDS role passwords are
database credentials, not CloudFormation values. The migration bootstrap is the auditable
boundary that creates `lnkz_app`, applies grants, and verifies the runtime role cannot bypass
RLS. Keep the RDS instance in isolated subnets and do not make it publicly accessible.

## MCP container configuration

The MCP layer is configured at runtime, so the same Docker image can move between environments
without a rebuild:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LNKZ_MCP_ENABLED` | `true` | Enable or disable the Streamable HTTP endpoint |
| `LNKZ_MCP_PATH` | `/mcp` | Path exposed to MCP clients; useful behind a reverse proxy |
| `LNKZ_MCP_API_KEY_REQUIRED` | `false` | Fail startup unless `LNKZ_API_KEY` is present |
| `LNKZ_TRUST_PROXY` | `false` | Trust a proxy's forwarded client address for rate limits |
| `LNKZ_MAX_BODY` | `24mb` | JSON request body limit |
| `LNKZ_RATE_LIMIT_WINDOW_MS` | `60000` | Shared and local limiter window |
| `LNKZ_API_RATE_LIMIT` | `600` | API/MCP requests per client per window |
| `LNKZ_SHARE_RATE_LIMIT` | `60` | Public handoff reads per client per window |
| `LNKZ_AUTH_MODE` | `static` | Use `multi-key` for multiple workspace principals |
| `LNKZ_API_KEYS_JSON` | empty | JSON array mapping bearer keys to workspace, actor, and scopes |
| `LNKZ_DEFAULT_ACTOR_ID` | `system` | Actor recorded for the compatibility key |

For App Runner, set `LNKZ_PUBLIC_BASE_URL` to the public HTTPS URL and use
`LNKZ_MCP_API_KEY_REQUIRED=true`. If a proxy terminates TLS, set `LNKZ_TRUST_PROXY=1` only when
it overwrites `X-Forwarded-For`; otherwise clients could influence the rate-limit identity.

The compatibility deployment uses one API key and one workspace. A multi-workspace deployment
sets `LNKZ_AUTH_MODE=multi-key` and injects `LNKZ_API_KEYS_JSON` through Secrets Manager. Each
principal selects a workspace and actor, and its `scopes` limit MCP operations. Do not put these
keys in a Dockerfile, image layer, or committed Compose file. Multi-key mode requires Postgres;
SQLite remains single-tenant.

The image includes both MCP transports:

```bash
node dist/server.js  # Streamable HTTP plus REST and the web console
node dist/stdio.js   # MCP over stdin/stdout for a host MCP client
```

Compose can run the stdio form without a second image:

```bash
docker compose run --rm -T lnkz node dist/stdio.js
```
