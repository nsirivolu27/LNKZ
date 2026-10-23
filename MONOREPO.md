# LNKZ monorepo layout

This workspace keeps the LNKZ relay as the primary product boundary while
bringing the related historical LLMM and Magentic MCP projects into one
repository for coordinated development.

- `apps/lnkz/` — the LNKZ relay product and its standalone HTTP/MCP surfaces
- `apps/llmm/` — historical LLMM web product, infrastructure, relay, and MCP reference
- `packages/lnkz-mcp/` — the standalone MCP adapter for the LNKZ REST API
- `artifacts/api-server/` — the active Replit LLMM runtime used by the current
  preview workflow
- `artifacts/mockup-sandbox/` — the active Replit UI mockup workspace

The three upstream histories are preserved as subtree merges. Their GitHub
repositories remain independently buildable and deployable:

- LNKZ owns the conversation relay, storage, mobile app, web console, and embedded
  compatibility endpoints.
- `lnkz-mcp` is the Magentic-facing MCP/catalog and marketplace repository.
- LLMM is retained as historical compatibility material and is not the target for
  new relay or MCP features.

Cross-repository communication uses published REST/API contracts. A clean checkout
of any canonical repository must not require a sibling checkout or a Git dependency.