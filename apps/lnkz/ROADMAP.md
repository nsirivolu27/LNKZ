# LNKZ roadmap

## Before a public demonstration

- Validate a hosted instance, its persistent storage and its smoke test.
- Separate readiness from liveness, drain shutdowns, and make logs safe to collect.
- Make migration and backup commands work from the built production artifact.
- Record a repeatable save, handoff, import and continuation demonstration.

## Transfer completion

- Publish instance identity and sign packets independently of trusted-node HMAC.
- Verify the sender and packet contents, recording verification in lineage.
- Make the SQLite-to-Postgres migration an accessible, verified command.
- Preserve audit actors consistently across both stores.

## Scope boundaries

This relay does not need a web console, accounts, embeddings, a queue, a cache
service or a message bus. Text messages and one-parent lineage remain the
conversation model. Optional future work includes attachment portability,
claim-level citations, and deliberate connector write-back after the core
operational path is proven.

[CHANGELOG.md](CHANGELOG.md) records completed changes; [ARCHITECTURE.md](ARCHITECTURE.md)
describes current implementation rather than future promises.
