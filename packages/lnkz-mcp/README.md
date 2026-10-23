# LNKZ MCP

LNKZ MCP is the standalone Model Context Protocol adapter for the LNKZ relay built into [LLMM](https://github.com/nsirivolu27/LLMM). It exposes the existing LNKZ tools, resources, and prompts to MCP clients while using the relay's authenticated REST API for every operation.

This repository contains no LLMM console, database, conversation store, import pipeline, connector implementation, or product branding. Run LLMM/LNKZ separately, then point this adapter at it.

## Requirements

- Node.js 22
- pnpm 10.26.1 through Corepack
- A running LLMM/LNKZ relay
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

- Product UI, relay REST API, stores, authentication, managed OIDC membership, connectors, import/export implementation, intelligence, graph construction, and publish-target discovery belong in [LLMM](https://github.com/nsirivolu27/LLMM).
- MCP registration, stdio transport, REST wire contract, and the authenticated REST client belong here.
- RSNA work belongs only in [rsna-knee-abnormality-detection](https://github.com/nsirivolu27/rsna-knee-abnormality-detection).
