---
name: Mobile packet selection
description: Contract boundary for carrying selected mobile content into context packets.
---

Treat a selected conversation as the supported unit of mobile packet context. Do not claim that individual message selection is enforced unless the relay contract explicitly gains message identifiers.

**Why:** The existing packet contract accepts conversation identifiers and a query, but not message identifiers. Conversation-level selection delivers a real bounded packet without inventing a mobile-only backend behavior.

**How to apply:** Keep selected conversation identifiers in transient app context, pass them through the established packet request, and preserve them when moving from conversation detail to packet and handoff screens. Scope message-level filtering as a separate API contract change.