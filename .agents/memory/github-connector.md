---
name: GitHub connector limitations
description: Replit GitHub connector behaviors observed when managing repository contents.
---

The GitHub connector can read repository trees and update ordinary repository files, but the low-level Git Data tree-create endpoint may return a proxy 404, and paths under `.github/workflows/` may return a Cloudflare HTML response instead of JSON.

**Why:** The standalone LNKZ repository was already complete except for its optional CI workflow; repeated API routes could not upload that hidden path through the connector.

**How to apply:** Prefer the documented contents endpoint for ordinary files, serialize updates, and treat hidden workflow-path failures as a connector limitation rather than changing repository visibility or creating a duplicate repository.