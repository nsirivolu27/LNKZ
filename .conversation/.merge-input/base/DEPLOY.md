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
