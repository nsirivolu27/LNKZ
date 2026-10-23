# Working on LNKZ

Use [CONTRIBUTING.md](CONTRIBUTING.md) for checks and review expectations.
Architecture boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md).

The root package is the relay. `apps/web` is a REST client and `infra` contains
optional deployment templates. Use the root pnpm workspace and lockfile.
Do not bring back an embedded copy of the relay or MCP server from LLMM history.
Preserve public tool names, resource URIs, environment variables and auth guards.
Keep conversation intelligence deterministic and model-free.

Keep commits free of credentials, generated output and attribution trailers.
Run typecheck, tests and build before committing. Run the web and HTTP smoke
checks for changes to combined application wiring.
