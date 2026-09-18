# LLMM — Large Language Model Mover

## MVP definition

LLMM moves useful working context between large language models, AI clients, devices, and people. It is not another chat client and it is not a transcript archive. It is the portable context layer that lets a thread continue somewhere else without starting over.

## Core loop

1. Bring context in — import an export, message array, Markdown transcript, or pasted text.
2. Normalize the thread — preserve turns, source metadata, lineage, and provider-neutral structure.
3. Understand the working state — extract decisions, open questions, action items, facts, topics, conflicts, and duplicates.
4. Package the next move — build a bounded context packet instead of forwarding the entire transcript.
5. Move it safely — create an expiring, revocable handoff for another person, device, or model.
6. Continue the work — create a linked continuation and retain the thread lineage.
7. Connect the surrounding work — search saved context and configured MCP connectors together.

## Product surfaces

- REST relay for ordinary applications and automation; the standalone `lnkz-mcp` adapter provides
  MCP stdio for LLM clients.
- REST for ordinary applications and automation.
- Web console for people who need to inspect, import, search, and hand off context.
- SQLite for local single-user operation; Postgres with workspace RLS for shared deployments.

## Compatibility promise

The product is now called LLMM. The existing LNKZ-prefixed environment variables, MCP tool names,
and lnkz:// resource URIs remain stable in the standalone adapter so current clients and
deployments continue to work. New documentation and user-facing copy should use LLMM.
