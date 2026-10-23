# LNKZ roadmap

## What the MVP proves

One path, walked end to end:

1. You have a conversation with a model.
2. You hand it to another person.
3. They pick it up on their own instance and carry it forward.
4. The chain shows where it came from, and who continued it.

That is the product. Everything else is in service of it.

Extracting decisions and fitting a context packet inside a token budget are
features of step 3, not the thesis. They matter because the person on the other
end should receive what was settled rather than forty thousand tokens of
transcript, but a relay that only compressed context and never left the machine
would not be this product.

## Topology: each person runs their own instance

LNKZ is federated by decision, not by omission. Conversations move between
instances as copies. There is no central server, no account to create, and no
shared tenancy to reason about.

This is what makes the rest of the scope small:

- **No accounts.** Your instance is yours. The API key is a deployment
  credential, not a user identity.
- **No invites, roles or permissions.** A handoff link is the entire
  authorization model, and it expires.
- **No shared workspace.** A workspace is your instance. `workspace_id` and the
  row-level security around it stay as isolation plumbing for anyone hosting for
  a small group, and are not a product surface.
- **Pull, never push.** The recipient fetches; nothing accepts unsolicited
  writes from strangers. No inbound endpoint, no addressing scheme, no delivery
  retries, and it works from behind any firewall.

Collaboration here is asynchronous and symmetric: you send a link, they import
it, and if they want to send work back they mint a link of their own. Two people
end up with two conversations joined by lineage rather than one conversation
with two editors. That is a real limitation and an accepted one, because live
co-editing is a different product and would drag accounts, presence and conflict
resolution in behind it.

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

The existing LLMM landing page and console now live with the relay in LNKZ.
The console uses REST; it does not introduce accounts, embeddings, a queue, a
cache service or a message bus. Text messages and one-parent lineage remain the
conversation model. Optional future work includes attachment portability,
claim-level citations, and deliberate connector write-back after the core
operational path is proven.

[CHANGELOG.md](CHANGELOG.md) records completed changes; [ARCHITECTURE.md](ARCHITECTURE.md)
describes current implementation rather than future promises.
