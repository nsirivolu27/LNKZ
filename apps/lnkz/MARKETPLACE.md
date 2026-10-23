# Marketplace design forwarding note

The MCP marketplace is not a LNKZ relay feature. Its package model, catalog
rules, scope review, checksums, and version compatibility belong to the
Magentic-facing MCP repository:

[Magentic marketplace specification](https://github.com/nsirivolu27/lnkz-mcp/blob/main/MARKETPLACE.md)

LNKZ remains the runtime conversation product. It provides the REST contract
that an MCP adapter can consume, but it does not host marketplace packages or
execute package code inside the relay.