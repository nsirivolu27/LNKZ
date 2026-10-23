# LNKZ

**Your working context, out of the app it was trapped in.**

You spend an hour with a model working something out. It lands on an answer,
names the tradeoffs, leaves two things open. Then you need it somewhere else:
a different model, your phone, a teammate.

LNKZ saves the conversation, extracts its decisions with source messages, and
hands that context to the next model or person through an expiring link. It
runs on your machine or your server, with data you own.

## Product and workspace setup

LNKZ is a REST-first, deterministic conversation context store. It keeps
conversations, analysis, context packets, and expiring handoffs in one
workspace; the standalone `lnkz-mcp` adapter calls this API and has no database.
Personal workspaces are single-user. Team workspaces use Postgres, API-key
principals, and workspace row-level security.

For one local personal workspace, set `LNKZ_API_KEY` in `.env` (or use the
explicitly local-only unauthenticated escape hatch). For multiple personal or
team workspaces, use Postgres and configure both variables below. Keep this
JSON in a secret manager in shared environments; keys are never selected by a
client-supplied workspace header:

```bash
LNKZ_AUTH_MODE=multi-key
LNKZ_API_KEYS_JSON='[{"key":"personal-key","workspaceId":"00000000-0000-4000-8000-000000000001","actorId":"personal-user","scopes":["mcp","read","write","admin"]},{"key":"team-key","workspaceId":"22222222-2222-4222-8222-222222222222","actorId":"team-member","scopes":["mcp","read","write"]}]'
LNKZ_WORKSPACES_JSON='[{"id":"00000000-0000-4000-8000-000000000001","name":"Personal Workspace","mode":"personal","useCase":"Portable conversation context","datasets":{"enabled":true,"approvalTag":"training-approved"}},{"id":"22222222-2222-4222-8222-222222222222","name":"Research Team","mode":"team","useCase":"Shared research and engineering context","datasets":{"enabled":false,"approvalTag":"training-approved"}}]'
```

`LNKZ_WORKSPACES_JSON` defines the workspace name, mode, use case, and export
policy. `LNKZ_API_KEYS_JSON` maps each bearer key to exactly one workspace,
actor, and scope set. See [DEPLOY.md](DEPLOY.md) for validation and Postgres
role requirements.

## Run it locally

Use Node 22 and the pinned pnpm version:

```bash
git clone https://github.com/nsirivolu27/LNKZ.git
cd LNKZ
corepack enable
corepack pnpm install --frozen-lockfile
pnpm build
pnpm start
```

In another terminal, run `pnpm seed`, then ask a connected MCP client:
"What did we decide about the forecast model, and what changed later?"
See [MCP.md](MCP.md) for connection settings. The local server uses
http://127.0.0.1:3100. For public use, follow [DEPLOY.md](DEPLOY.md).

Useful checks from `apps/lnkz`:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm verify:http
```

## REST examples

All protected routes use the authenticated workspace represented by the bearer
key. The workspace endpoint is useful for checking a key before configuring
MCP:

```bash
curl -H "Authorization: Bearer $LNKZ_API_KEY" \
  http://127.0.0.1:3100/api/workspace
```

Dataset export is curation and preparation, not model training. It preserves
the source conversations, redacts sensitive values, removes exact duplicates,
and returns deterministic train/validation JSONL. It requires an admin key,
explicit conversation IDs, rights acknowledgement, and the workspace approval
tag:

```bash
curl -X POST http://127.0.0.1:3100/api/datasets/export \
  -H "Authorization: Bearer $LNKZ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"conversationIds":["00000000-0000-4000-8000-000000000003"],"acknowledgeRights":true,"approvalTag":"training-approved","seed":"lnkz-v1"}'
```

No model is trained by this endpoint; any later training is a separate,
operator-controlled process.

## MCP profiles

The standalone adapter supports named personal/team profiles. Each profile
supplies a base URL, the environment variable containing its key, and the
expected workspace ID. The adapter verifies that `/api/workspace` returns that
ID before exposing tools:

```bash
LNKZ_PROFILE=personal
LNKZ_PROFILES_JSON='[{"name":"personal","baseUrl":"https://personal.example.com","apiKeyEnv":"LNKZ_PERSONAL_KEY","workspaceId":"00000000-0000-4000-8000-000000000001"},{"name":"team","baseUrl":"https://team.example.com","apiKeyEnv":"LNKZ_TEAM_KEY","workspaceId":"22222222-2222-4222-8222-222222222222"}]'
```

## Mobile preview

Set `EXPO_PUBLIC_LNKZ_API_URL` to the reachable LNKZ URL, then run the Expo
mobile app from its own workspace with `pnpm start` (or `npx expo start`).
Use the native device/QR preview for SecureStore-backed credentials; the web
preview uses browser storage. Never put an API key, database credential, or
MCP context secret in an `EXPO_PUBLIC_*` variable.

## AWS and security boundaries

The CDK reference stack is in `../llmm/infra` and is intentionally not
deployed by this repository. It requires AWS credentials, a configured CDK
account/region, an ECR image tag, and operator approval before enabling the
conditional App Runner service. It retains a private, TLS-enabled RDS
PostgreSQL instance in isolated subnets, an ECR repository, KMS encryption,
Secrets Manager, VPC/security groups, and a private export bucket. App Runner
sets production mode and fail-closed authentication explicitly.

Use the migration-only database secret only for `pnpm db:migrate`. App Runner
receives only the non-owner runtime database secret and API-key secret; its
role cannot read migration credentials. PostgreSQL is required for
multi-workspace deployments, while SQLite is suitable for local personal
development.

TLS and bearer authentication are required for public use. Handoff URLs are
bearer secrets and should not be logged or cached. Connectors are optional and
instance-scoped: credentials configured on one LNKZ instance are not portable
to another instance or workspace. LNKZ does not provide centralized connector
tenant isolation beyond the configured instance boundary; review connector
permissions and reverse-proxy settings before sharing an instance.

## Read next

| Document | Its job |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data flow, storage and trust boundaries |
| [MCP.md](MCP.md) | Tool, resource, prompt and REST contracts; MCP client setup |
| [DEPLOY.md](DEPLOY.md) | Configuration, hosting and operational commands |
| [ROADMAP.md](ROADMAP.md) | Remaining work and scope boundaries |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local checks, review and branch protection |
| [CHANGELOG.md](CHANGELOG.md) | Changes over time |
| [SECURITY.md](SECURITY.md) | Private vulnerability disclosure |

## Related repositories

| Repository | What it owns |
| --- | --- |
| This repository | The relay and its REST and MCP surfaces |
| [LLMM](https://github.com/nsirivolu27/LLMM) | A separate product and console built on the relay |
| [lnkz-mcp](https://github.com/nsirivolu27/lnkz-mcp) | A standalone MCP adapter for a remotely hosted relay |

Licensed under [MIT](LICENSE).
