# Changelog

## Unreleased

- Add a runnable two-instance demo, recorded terminal output, a seeded question
  command, and MCP client instructions. Preserve transfer origin fields when
  saving; the existing normalizers had silently dropped them.

- Add store-backed readiness, safe request logs, startup schema checks and
  awaited shutdown. Include SQL in builds, Fly configuration, a public smoke
  command, and backup/restore operations.

- Restore the existing cross-instance transfer and twelve-conversation demo
  corpus from the local patch, which had not reached main.
- Give each reference document one responsibility and add contribution,
  ownership, licensing, issue, and security reporting guidance.

## 0.2.0 — baseline

The relay includes conversation storage, provider import and export,
deterministic analysis, context packets, graph exploration, expiring handoffs,
REST and MCP surfaces, and optional connectors. See [MCP.md](MCP.md) for the
compatibility contract and [ARCHITECTURE.md](ARCHITECTURE.md) for implementation.

This records the package version already in the repository; it does not claim
a published package or a tagged release.
