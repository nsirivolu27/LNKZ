# Proposed product boundary: Magentic and LNKZ

Status: proposal recorded before component moves. No repository, package,
environment variable, or public tool has been renamed. No component has moved.
This supersedes the earlier plan to consolidate MCP work into LLMM; those
separate migration worktrees are not part of this change.

## Magentic (magentic.ai), currently the lnkz-mcp repository

- Owns the MCP server and marketplace product: `mcp.ts`, `surfaces.ts`,
  `stdio.ts`, `http.ts`, `http-main.ts`, and MCP tool registrations.
- Owns `catalog/`, `agents/`, `llm/`, `suggest.ts`, `elicit.ts`, and `list.ts`.
  These files already live here, so no relocation is necessary.
- Owns `client.ts`, `profiles.ts`, and the adapter-side `contract.ts`:
  authenticated REST access, profile selection, and wire validation.
- Owns `brand/tokens.css` and `brand/README.md` as the shared design source.
- Keeps LangChain providers optional. Sampling/provider enrichment belongs
  here; it must not become a required dependency of the relay.
- The current catalog distributes agent configuration. Marketplace ownership
  does not imply payments, third-party publishing, or install trust are complete.

## LNKZ, the LNKZ repository

- Owns `src/lnkz/`: REST routes, storage, authentication, identity, import/export,
  deterministic analysis, handoffs, lineage, and domain authorization.
- Owns `apps/mobile`, `apps/web`, and relay infrastructure and deployment assets.
- Keeps its embedded `/mcp` and stdio compatibility surfaces for current clients.
  Removing or forwarding those is a separate integration change, not a file move.
  They must continue to use the same relay business services as REST.
- Receives a versioned copy of Magentic's design tokens; it does not gain a
  runtime package dependency on the MCP server or on a sibling checkout.

## The contract is the seam

Magentic calls LNKZ through REST with the caller's credentials. It never imports
relay internals or opens the relay database. LNKZ owns the authoritative API;
Magentic owns its client-side schema. Evolve both through versioned fixtures and
integration tests for auth failures, preview without redemption, import,
continuation, revocation, and workspace isolation. Keep URLs, tool names,
resource URIs, payloads and error semantics compatible until a migration is agreed.

## Brand decision

LNKZ uses Magentic's magenta accent, with its own product name. Magenta is for
the primary action and focus. Headings and panels remain neutral; lineage and
status use the semantic tokens. Both web surfaces share dark-base/light themes,
Instrument Sans/JetBrains Mono stacks, spacing, small corners, and flat depth.

## Separate approval required: disruptive naming migration

Proposed next step: rename the GitHub MCP repository to `magentic`, choose and
verify an available package name (for example `@magentic/mcp`), and introduce
`MAGENTIC_*` names for MCP-owned settings. Keep `LNKZ_BASE_URL` and `LNKZ_API_KEY`
as relay connection settings, or support them as documented compatibility aliases;
blindly renaming every `LNKZ_*` variable would also rename the other product's API.

Before applying that step, inventory remotes, package/bin names, Docker/Fly/CI
settings, client examples, paths and environment names. Approve exact names,
alias precedence, a deprecation period, and rollback instructions. Then test
old and new client configurations. Do not rename repositories, publish packages,
delete legacy paths, or change deployed settings as part of the brand pass.
