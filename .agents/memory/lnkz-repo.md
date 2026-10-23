---
name: LNKZ repository split
description: Repository ownership and branding boundary between LNKZ workflow code and LLMM.
---

The focused LNKZ conversation-relay workflow lives in the public GitHub repository `nsirivolu27/LNKZ`; the existing `nsirivolu27/LLMM` repository remains the main MCP product repository. LNKZ has no web console or LLMM branding.

**Why:** Keeping the relay workflow independently consumable prevents the main LLMM MCP product from becoming coupled to a legacy-compatible workflow package or UI.

**How to apply:** Put new relay-only server, storage, MCP, import/export, handoff, connector, and deployment work in LNKZ. Keep LLMM product UI, managed identity, workspace administration, and main-product integrations in LLMM unless the user explicitly changes this boundary.