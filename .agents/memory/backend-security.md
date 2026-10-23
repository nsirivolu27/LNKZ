---
name: Backend security baseline
description: Security defaults and audit interpretation for the LLMM HTTP server.
---

The LLMM HTTP boundary uses security headers, strict origin checks, bounded JSON bodies, no-store responses for health/API/MCP data, safe JSON error responses, proxy-aware client IP resolution, and production fail-closed authentication configuration. Local development may remain unauthenticated only when the environment explicitly permits it by default.

**Why:** Conversation content, handoff tokens, and workspace metadata are sensitive; browser defaults and deployment misconfiguration must not silently expose them.

**How to apply:** Preserve the production fail-closed behavior while implementing managed identity, workspace permissions, and API-key integration. In non-production, an undersized context secret may disable forwarded signing so local preview can boot, but forwarding helpers must reject undersized secrets too. Treat migration-query SAST alerts as false positives only after verifying values are parameterized or identifiers are strictly allowlisted.