# LNKZ roadmap

## MVP: an end-to-end encrypted messenger for AI content

LNKZ lets someone take AI-created content and its relevant context from a source
platform and share it with a receiver: another person, an app, an AI platform,
or another receiving system. Conversation handoffs are one supported content
flow within this product, not the limit of the product.

**Product promise:** create anywhere, share privately through LNKZ, receive and
continue where it is useful. LNKZ is a messenger, with end-to-end encrypted
one-to-one conversations as the first release, not a public file-sharing portal.

Messages, AI context and attachments must be encrypted on the sending device
and decrypted only at authorized receiving endpoints. The LNKZ delivery service
must not hold content-decryption keys. The current relay is not E2EE; this is a
new implementation requirement, not a description of existing protection.

This is the revised MVP definition, not a claim that every capability below is
implemented. ARCHITECTURE.md describes the current implementation.

## The sharing flow

1. **Capture:** paste text or a conversation, upload an image, video, audio clip,
   document or other supported file, or attach a source link. A supported
   connector may import directly from the source platform.
2. **Review:** see exactly what will be sent. Select content and optionally add
   the source platform, prompt, relevant conversation, notes and attribution.
   Do not infer or fabricate metadata that the source does not provide.
3. **Choose a receiver:** share privately with a person, or explicitly send to a
   supported application/platform/system destination. The sender's platform
   credentials are never part of the shared content.
4. **Receive:** the recipient previews the share, accepts or downloads the
   permitted content, and can reply or carry it into a compatible tool.
5. **Continue and return:** new messages or generated results can be shared back
   with their relationship to the original intact. Preserve the original rather
   than silently replacing it.

Ordinary messages and files work without an AI provider account. Human chat is
one receiver experience; receiving systems do not have to behave like people
or participate in a chat.

Encrypted previews are generated on the recipient's device after decryption.
Keep message titles, filenames, prompts, source URLs and thumbnails inside the
encrypted payload. Inbox/Chats, contacts, a composer and device verification are
the primary user experience. Existing plaintext handoff endpoints are a separate
legacy mode, never a silent fallback when encryption fails.

## What universal means

Text, file uploads, links and downloadable exports provide the baseline across
platforms. Direct import, delivery, generation and editable-project transfer
require explicitly supported integrations and destination capabilities.

A link-only share must be labeled as a link: it is not a stored copy, and the
receiver may need access to its source. A video file can be portable even when
its source platform's editable project is not. Preserve unknown file types as
attachments within documented size/type limits rather than promising previews
or execution for every format.

Show which action actually happened: copied, link created, downloaded, accepted,
or delivery confirmed by an integration. Opening a platform or copying content
is not evidence that the destination received it or continued a model session.
Sending data to an external AI service requires the user's explicit choice.
An AI provider receiving readable content becomes a disclosed recipient; E2EE
between people does not make that provider unable to read what is sent to it.
A system that cannot participate in the encryption protocol receives only an
explicit client-side export. Do not label that export as encrypted delivery to
the destination. LNKZ servers and Magentic must not transparently decrypt chats.

## MVP acceptance gate

Demonstrate these workflows through the product UI and its real backend:

- Two separately authenticated people establish a private chat, verify their
  devices and exchange encrypted messages, including while one is offline.
- Inspect requests, database/object storage, logs and backups: no message text,
  media plaintext or content-decryption keys reach the LNKZ service. Document
  the routing, timing and size metadata the service can still observe.
- Tampered ciphertext, replayed messages and unauthorized recipients fail
  safely. Device/key changes require verification; no silent key replacement
  or plaintext downgrade is allowed.
- Two people on separate devices exchange text, a conversation, an image and a
  generated video. Audio and documents can be shared as attachments; supported
  previews are identified, and unsupported previews offer a download.
- A recipient can receive a private share without the sender's relay API key or
  source-platform credentials. Routine use does not require running a server.
- The sender reviews content and optional AI context before sharing. The
  recipient sees the available provenance, including when it is unverified.
- A recipient downloads or exports content for another AI platform and returns a
  result linked to its source. Verify one explicitly supported system receiver
  end to end; name the integration actually exercised.
- Access control covers both metadata and attachment bytes. Expired/revoked
  shares deny future access, and concurrent requests respect use limits.
  Revocation cannot retract a copy already downloaded by a recipient.
- Content and history survive refresh and restart. Interrupted uploads and
  failed deliveries expose a clear outcome without reporting false success or
  silently duplicating a send.
- Key storage, device linking/revocation, session persistence and recovery are
  exercised on the supported clients. Account-password reset alone cannot
  decrypt history. Define and test the retained-history policy for new devices.

The existing two-relay conversation journey remains a regression gate. Passing
it alone does not establish media sharing, person-to-person messaging, hosted
onboarding, or delivery to arbitrary systems.

## Build order

1. **Encryption and identity foundation:** select a maintained messaging protocol
   implementation after checking license, supported runtimes, maintenance and
   interoperability. Prove a two-device session, device verification, offline
   delivery and private-key storage. Do not design a custom ratchet. Required
   encryption dependencies and native builds have been authorized by the user.
2. **Encrypted one-to-one messenger:** implement contacts, Inbox/Chats, compose,
   receive, replies and client-side conversation import/export. The delivery
   backend authenticates recipients and stores opaque encrypted envelopes;
   private-message search and context preparation run on the client.
3. **Encrypted attachments:** support images, video, audio and documents with
   device-side encryption, authenticated downloads and encrypted descriptors.
   Specify upload limits, interruption recovery and retention. Reuse existing
   conversation formats inside encrypted payloads, not plaintext store rows.
4. **System receiver:** implement one bounded destination adapter through an
   explicit contract, with scoped authorization and honest delivery results.
   Keep copy/download/link fallbacks available for other platforms.
5. **Acceptance and operations:** complete the workflows above, recovery tests,
   persistence, backups, and a physical two-device check before claiming the
   revised MVP is ready.

Encryption identities and device verification are required for the first gate.
Additional source-platform provenance and optional enrichment remain follow-on
work. Transporting AI output does not require the relay to call a model, train
one, or execute uploaded content. Groups and live calls are outside this MVP.

## Current foundation and gaps

The current implementation provides text conversation import/export, deterministic
context packets, expiring handoffs, preview, continuation, lineage, REST, embedded
MCP, a web console and an Expo client. The two-relay harness exercises conversation
transfer and return with separate databases/keys and persistence across restart.

Media storage/upload, a general share envelope, recipient inbox/addressing,
E2EE sessions, consumer onboarding and verified system delivery are work to implement and
validate. The self-hosted two-relay setup remains a development/test option; it
is no longer the required user experience or the definition of the MVP.

## Separate products and boundaries

LNKZ owns this sharing experience and its relay/mobile/web implementation.
Workspaces remain a separate product concern; do not add workspace administration,
team roles, shared project management or workspace orchestration to this MVP.
Existing backend isolation controls remain intact.

Magentic owns the standalone MCP server and marketplace direction. Preserve the
existing LNKZ MCP compatibility surfaces and REST boundary. Neither MCP expansion
nor marketplace publishing/payments is a prerequisite for the LNKZ MVP.

See PRODUCT-SPLIT.md for repository boundaries and MARKETPLACE.md for the separate
marketplace proposal. No repository/package/environment rename is authorized by
this scope change. CHANGELOG.md records completed changes; this roadmap records
intended work.
