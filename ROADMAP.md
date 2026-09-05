# LNKZ workflow roadmap

## Current

- Provider-neutral conversation schema and portable imports/exports.
- Deterministic context packets, analysis, graph, conflict, and duplicate detection.
- Expiring, use-limited, revocable handoffs with hashed tokens and redaction.
- SQLite and Postgres behind one `ConversationStore` contract.
- Stateless HTTP MCP, stdio MCP, REST, read-only connectors, and publish preparation.
- Static workspace principals and scoped MCP authorization.

## Next

- Managed OAuth/OIDC identity attached to workspace and actor context.
- Workspace administration, membership, roles, and API-key lifecycle UI in the main product.
- Envelope encryption, retention, deletion, and export controls.
- Shared rate limiting and operational metrics for multi-instance deployments.
- Incremental connector sync with explicit per-user consent.

## Later

- Embeddings behind the existing search interface.
- Claim-level deduplication and citation graphs.
- Browser capture, mobile share sheet, and QR handoffs.
- Connector SDK and deliberate write-back workflows.
