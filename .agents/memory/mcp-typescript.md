---
name: MCP TypeScript schema inference
description: Type-checking guidance for the recursive MCP SDK tool schemas used by LLMM.
---

The MCP SDK's recursive schema inference can exceed TypeScript's instantiation limit for isolated tool registration, especially graph-shaped schemas. Keep the runtime registration typed and localize any necessary compiler suppression to the affected registration call rather than weakening the whole project configuration.

**Why:** Disabling strictness globally would hide unrelated errors in the storage and authorization layers; a narrow suppression preserves useful type checking everywhere else.

**How to apply:** If a future SDK or TypeScript upgrade moves the error, re-evaluate the affected registration call and remove the suppression if inference improves.