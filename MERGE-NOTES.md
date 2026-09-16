# Resolving the merge of claude/mvp-journey-v9 into feat/mvp-journey

Eight files conflict. Keep both sides in every one of them. The changes are
additive on both sides, not competing implementations. Do not take `--ours`
or `--theirs` wholesale on any file.

This file describes what the incoming side changed and why, so the resolution
is a union with understanding rather than a guess.

## src/lnkz/schemas.ts

`continueConversationSchema` was split in two.

It stays a plain `z.object` with a required `token`, because `mcp.ts` reads
`.shape` off it to publish its tool signature, and wrapping it in `.refine()`
produces a `ZodEffects`, which has no `.shape`. That broke the MCP handler
once already.

`continueFromLinkSchema` is the new one, taking a `url` instead. Both must
survive.

## src/lnkz/server.ts

The handoff routes moved out to `src/lnkz/handoffs/wire.ts`, mounted through
`mountHandoffRoutes(app, store, deps)`. `server.ts` should end up about 124
lines shorter, with one mount call where the routes used to be.

Separately: `import-url` with `dryRun` now calls `peekTransfer`, not
`fetchTransfer`. Fetching the packet in order to describe it counts as a
redemption on the sending relay, so on a one-use link the preview succeeded
and the import right after it failed.

## src/lnkz/store/index.ts, sqlite.ts, postgres.ts

`peekHandoff(token)` was added to the `ConversationStore` interface and
implemented in both stores. It returns a `HandoffPeek`, never returns the
transcript, and never increments uses.

Both implementations must be present. An interface method implemented in one
store and not the other typechecks and then fails at runtime on whichever
store the deployment actually uses.

## src/lnkz/mcp.ts

Two new tools: `preview_handoff` and `continue_from_link`.

`import_from_url`'s `dryRun` switched to `peekTransfer`, same reason as the
REST route.

The hand-assembled continuation lineage was replaced with a call to
`localContinuation` from `src/lnkz/continuation.ts`. That was the third copy
of the same rules.

## apps/mobile/src/api.ts

New methods: `previewLink`, `importLink`, `continueFromLink`, `appendMessage`,
`deleteConversation`, `checkConnection`.

New types: `Lineage`, `ImportPreview`, `TransferOrigin`.

`listConversations` gained an `offset` parameter.

## apps/mobile/App.tsx

New components `ReceiveLink` and `Provenance`.

`ConversationDetail` gained a follow-up composer and now takes `client` and
`onChanged` props, so its call site in `Library` changed too.

`ConnectionScreen` calls `checkConnection` instead of `stats`, so the error
can say whether the URL is wrong or the key is.

New `styles.provenance` entry.

## scripts/acceptance.mjs

Added: the preview-does-not-consume regression, exhaustion proved separately
from revocation, revocation tested on a fresh link across all five paths
(redeem, preview, import, dry-run import, continue), the A to B to A return
leg, key isolation between relays, a direct separate-databases assertion, and
both relays restarted rather than only B.

Cleanup fixes: iterate a copy of the `running` array because `stop()` removes
from it and mutating while iterating left a relay alive holding its database
open, retry the `rm` because Windows does not release a SQLite file the
instant its process exits, and print PASS last so a cleanup problem cannot
appear after the word PASS.

## Arriving with no conflict

These should simply be present afterwards:

- `src/lnkz/continuation.ts`
- `src/lnkz/handoffs/wire.ts`
- `tests/continuation.test.ts`
- `tests/handoff-routes.test.ts`
- `ENRICHMENT.md`
- `MARKETPLACE.md`

## After resolving

```
corepack pnpm typecheck
corepack pnpm test
```

Both must pass before committing the merge. If a test fails, fix the code
rather than deleting the test.

Then commit, and report which files needed real judgment rather than a
mechanical union, and what was chosen in those.
