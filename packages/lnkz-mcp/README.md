# Magentic MCP adapter (published as `lnkz-mcp`)

This is the standalone Model Context Protocol adapter for the canonical
[LNKZ](https://github.com/nsirivolu27/LNKZ) conversation relay. It is the
Magentic-facing home for MCP transport, the agent catalog, and the marketplace
specification. It exposes LNKZ tools, resources, and prompts to MCP clients
through the relay's authenticated REST API.

This repository contains no LLMM console, database, conversation store, import
pipeline, connector implementation, or relay deployment. Run or deploy LNKZ
independently, then point this adapter at its published REST endpoint.

## Requirements

- Node.js 22
- pnpm 10.26.1 through Corepack
- A running LNKZ relay
- A relay API key with the scopes needed by the tools you use

## Install and build

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

The server fails closed unless both settings are present:

```text
LNKZ_BASE_URL=http://127.0.0.1:3100
LNKZ_API_KEY=replace-with-a-dedicated-relay-key
```

Do not commit API keys or put them in command-line arguments. Supply them through your MCP client's environment configuration or a secret manager.

## Claude Desktop (stdio)

Build the repository, then add an entry like this to Claude Desktop's MCP configuration. Replace the path and placeholder key locally.

```json
{
  "mcpServers": {
    "lnkz": {
      "command": "node",
      "args": ["C:\\path\\to\\lnkz-mcp\\dist\\stdio.mjs"],
      "env": {
        "LNKZ_BASE_URL": "http://127.0.0.1:3100",
        "LNKZ_API_KEY": "replace-with-a-dedicated-relay-key"
      }
    }
  }
}
```

The adapter uses local stdio for MCP traffic. It does not open a port or mount `/mcp`; network access is only from the adapter to the configured LNKZ REST base URL.

## Preserved MCP surface

The adapter preserves all 24 tool names:

```text
save_conversation          import_conversation       get_conversation
list_conversations         search_conversations      append_messages
export_conversation        build_context_graph       list_publish_targets
prepare_publish            delete_conversation       create_handoff
redeem_handoff             continue_handoff          revoke_handoff
list_handoffs              build_context_packet      analyze_conversation
find_conflicts             find_duplicates           search_context
list_connectors            workspace_stats           audit_log
```

It also preserves the `lnkz://connectors`, `lnkz://stats`, `lnkz://conversations`, `lnkz://conversation/{id}`, and `lnkz://graph` resources, plus the four existing prompts.

## Repository boundary

- Conversation product UI, relay REST API, stores, authentication, managed OIDC membership,
  connectors, import/export implementation, intelligence, graph construction, mobile app,
  and publish-target discovery belong in [LNKZ](https://github.com/nsirivolu27/LNKZ).
- MCP registration, stdio/HTTP transport, REST wire contract, authenticated REST client,
  agent catalog, and marketplace specification belong here.
- The two repositories communicate through the published LNKZ REST contract; neither requires
  a sibling checkout or a Git dependency from the other.
- RSNA work belongs only in [rsna-knee-abnormality-detection](https://github.com/nsirivolu27/rsna-knee-abnormality-detection).

See [MARKETPLACE.md](MARKETPLACE.md) for the Magentic package model and its
scope-review rules.
