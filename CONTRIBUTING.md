# Contributing to LNKZ

Use Node 22 and the package manager pinned in package.json:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
pnpm verify:web && pnpm verify:http
```

Run these checks before every commit. Postgres integration tests require the
two database URLs described in [DEPLOY.md](DEPLOY.md). Report skipped checks;
do not weaken tests to accommodate a local environment.

The pnpm workspace contains the relay at the root, `apps/web`, and `infra`.
Keep one implementation of the store and workflows in `src/lnkz`. The browser
is a REST client. Run `pnpm infra:synth` to check the optional AWS template;
synthesis creates no deployed resources. Use `pnpm dev:web` for UI development.

Keep commits small and explain why the change is needed. Include a reproduction
for a bug and checks that exercise its behavior. Explain any new dependency in
the commit. Preserve MCP names, resource URIs, and environment variable names.
Keep deterministic analysis free of model calls. See [ARCHITECTURE.md](ARCHITECTURE.md)
for boundaries and [MCP.md](MCP.md) for public contracts.

Do not commit builds, databases, credentials, logs, caches, patches, or local
projects. A fresh clone must remain clean after installation and building.

## Review and branch protection

Open a pull request against main. Describe the problem, resulting behavior,
validation, and scope left alone. For a sequence of dependent phases, target
each subsequent pull request at the preceding branch and retarget after merge.

Maintainers: in Settings → Rules → Rulesets, protect main. Require a pull request
and the passing `verify` status check from CI before merging. Block force pushes
and branch deletion. This is setup guidance; a file cannot enable GitHub rules.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md).
