---
name: LNKZ repository split
description: Repository ownership and branding boundary between LNKZ workflow code and LLMM.
---

The focused LNKZ conversation product lives in `nsirivolu27/LNKZ`, including the relay, storage, handoffs, web console, and mobile app. The general MCP/catalog direction is Magentic in `nsirivolu27/lnkz-mcp`; LLMM is historical compatibility material.

**Why:** The user explicitly reassessed the split so LNKZ owns the conversation workflow and Magentic owns the standalone MCP/catalog product; keeping LLMM active would preserve the old overlap and confuse deployment ownership.

**How to apply:** Put new relay, storage, import/export, handoff, connector, web-console, mobile, and deployment work in LNKZ. Put MCP transport, agent catalog, marketplace, and REST adapter work in `lnkz-mcp`. Keep the repositories independently buildable without sibling checkouts or Git dependencies.