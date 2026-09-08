---
name: Claude destination boundary
description: The distinction between Anthropic model access and delivery into a user's Claude-owned space.
---

Claude.ai conversation-space delivery requires a dedicated managed destination connector. An Anthropic API/model connection alone cannot create or populate a user's Claude-owned space.

**Why:** Treating model access as native Claude delivery would misrepresent where sensitive conversation content goes and could bypass the user's destination confirmation.

**How to apply:** Keep direct delivery explicitly unavailable until a supported secure connector exists. Preserve the redacted, expiring, revocable handoff-link path as the fallback, and do not ask users to paste credentials into the app.