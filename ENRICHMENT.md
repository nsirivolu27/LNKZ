# Enrichment: the model-powered layer

**Status: designed, not built.** No code, no dependency, no configuration.
This file fixes the boundary before anything is written against it.

## Why it is not in `intel/`

The analysis in `src/lnkz/intel/` makes no model calls. That is not an
oversight to be corrected later, it is what three other things rest on.

`find_conflicts` and `find_duplicates` return the same answer for the same
input, every time, so a person can act on them. A context packet is auditable:
every claim in it points at the message it came from. And a conversation on
your relay has never left your machine, which is most of what "private by
default" means.

A model in that path costs all three at once. Same input, different answer.
Claims you cannot trace. And every analyzed conversation sent to a provider,
silently, because the feature that needed it was turned on for something else.

None of that makes model-powered analysis wrong. It makes it a different
component with a different contract.

## Shape

A separate package that is a client of the relay, not a part of it.

- It reads through the REST API with an ordinary API key and read scope. It
  does not import from `src/lnkz` and does not open the database. If it ever
  needs to, the boundary is wrong.
- It writes enrichment back as its own record type, never as an edit to a
  conversation or to deterministic analysis. A reader can always tell which
  layer produced a claim, and deleting all enrichment leaves the relay exactly
  as it was.
- It is absent unless configured. No provider key, no enrichment, no partial
  behaviour, no silent fallback that sends data anywhere.
- Enrichment is opt in per workspace, and the opt in is what sends
  conversation text to a provider. That sentence is the consent, so it belongs
  in the interface where someone turns it on, not in a settings file.

## First thing to build: retrieval

Given a question, which past conversations bear on it, and why.

This is the weakest deterministic piece today. The context packet ranks by
BM25 and recency, which is good at finding the words you used and blind to the
conversation that settled the same question in different language six weeks
ago. That gap is exactly what a model closes.

The output is a ranked set of conversation ids with a stated reason per hit.
Ids and reasons, not prose: the packet builder already knows how to turn a
conversation into budgeted context, and duplicating that here would give two
answers to one question.

Done when a query whose answer lives in a conversation sharing no significant
vocabulary with it retrieves that conversation, and the same query against the
deterministic path does not.

## Second, once retrieval is proven useful

The longitudinal view over the same graph. What you keep returning to.
Decisions you reversed. Questions you opened and never closed.

Deliberately second. It is the more interesting half and the easier one to
build badly, because there is no obvious failure: a plausible summary of your
own patterns reads as insight whether or not it is true. Retrieval can be
checked against whether it found the right conversation. Build the one with a
right answer first.

## Not in scope

Enrichment on the transfer path. A packet crossing to another instance carries
what the sender's deterministic layer produced, nothing a model inferred about
them.

Enrichment as a write to conversations. It annotates, it does not edit.

Any dependency on this layer from the relay, the mobile client or the MCP
surface. All three must work identically when it is absent, because for most
installations it will be.

## Sequencing

After the two-device journey passes and lands on `main`, and after instance
identity, which [ROADMAP.md](ROADMAP.md) names as next. This layer is additive
and reversible; those two are foundations, and building on an unverified
foundation is how the crossing shipped broken three times.
