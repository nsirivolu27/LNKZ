---
name: Managed identity boundary
description: The authorization rule for managed OIDC sessions and workspace access.
---

Managed OIDC authentication proves who a person is, but it does not grant workspace access. Every
managed session must resolve an explicit workspace membership and scopes before becoming a request
context; unknown members are denied rather than auto-provisioned into the default workspace.

**Why:** LLMM serves multiple workspaces and must not turn a valid provider login into an accidental
cross-tenant data grant.

**How to apply:** Keep membership resolution on the server side, derive actor/workspace/scopes from
the membership for REST, MCP, handoffs, audit, and rate limiting, and preserve static API keys as a
separate migration path.