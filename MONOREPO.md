# LNKZ monorepo layout

This workspace keeps the LNKZ relay as the primary product boundary while
bringing the related LLMM and MCP projects into one repository.

- `apps/lnkz/` — the LNKZ relay product and its standalone HTTP/MCP surfaces
- `apps/llmm/` — the LLMM web product, infrastructure, relay, and MCP server
- `packages/lnkz-mcp/` — the standalone MCP adapter for the LNKZ REST API
- `artifacts/api-server/` — the active Replit LLMM runtime used by the current
  preview workflow
- `artifacts/mockup-sandbox/` — the active Replit UI mockup workspace

The three upstream histories are preserved as subtree merges. Their original
GitHub default branches remain independent until a reviewed merge branch is
published there.