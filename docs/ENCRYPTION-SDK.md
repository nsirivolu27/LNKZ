# Encryption SDK decision

ROADMAP.md build order step 1 requires selecting a maintained messaging protocol
implementation before any encryption code is written. ARCHITECTURE.md records
that no SDK is installed and that the earlier no-new-dependencies constraint has
since been lifted. This document makes the selection and states the reason.

Nothing has been installed. Every claim below was checked against the project's
own repository, package registry entry or documentation, not from recall.
Sources are listed at the end. Verified 2026-09-19.

## What actually decides this

The protocol comparison matters less than four facts about where our client has
to run. They eliminate most of the field before any cryptographic argument.

**We ship two client surfaces from one codebase.** `apps/mobile` is an Expo app
whose web export is served by the relay at `/mobile/`, and `scripts/verify-web.mjs`
now asserts that every script tag in that build loads from the relay origin. Any
library that works on only one of native or browser splits the client in two.

**We are on Expo SDK 52 and React Native 0.76.9.** Not a detail. Two of the
candidates below require React Native 0.84 or 0.87, which means Expo SDK 56 or
later. That is a three-to-four major upgrade of the mobile app before a single
line of encryption code runs.

**WebAssembly in Hermes is not something to build on yet.** Secondary coverage of
React Native 0.84 claims WASM support landed with Hermes V1, but the official
0.84 release post does not mention WebAssembly at all, the Hermes feature request
for it is still open and unassigned, and the June 2026 Hermes stable release post
does not mention it either. Treat WASM on native as unproven. Any Rust-to-WASM
option is therefore a browser-only option until proven otherwise on a device.

**`crypto.subtle` is not reliably present in Hermes.** `expo-crypto` provides
digests, AES-GCM, and random bytes, not a SubtleCrypto implementation. The
`react-native-quick-crypto` request for `crypto.subtle` has been open since 2023
with no assignee and no linked PR. One third-party guide claims Web Crypto works
out of the box on RN 0.71+; the existence and staleness of every polyfill in this
space contradicts it. This is the one open question that must be closed by a
spike rather than by reading, and it is the last section of this document.

## Ruled out

**libsignal (`@signalapp/libsignal-client`).** The repository states plainly:
"Use outside of Signal is unsupported." It is AGPLv3, which is a licensing
decision for a product we intend to distribute, not just a preference. There is
no WASM binding, so the browser surface has nothing to use. The README also warns
that all APIs and bridge layers are subject to change without notice. Ruled out
on support posture first, license second, browser gap third. This confirms what
ARCHITECTURE.md already flagged.

**`@privacyresearch/libsignal-protocol-typescript`.** The community TypeScript
port. Last published version 0.0.16 in May 2023, roughly three years stale. GPLv3.
The README documents usage but says nothing about production readiness, audits, or
which parts of the protocol it omits. An unmaintained cryptographic dependency with
an undocumented scope is worse than no dependency. Ruled out.

**AWS Wickr.** Worth naming because the stack direction is AWS. It is a managed
messaging product, not a protocol SDK we can embed in our own client. Not
applicable.

## Candidates

### ts-mls

Pure TypeScript implementation of MLS (RFC 9420) by Luka Jacobowitz. MIT. Version
1.6.2, March 2026, actively maintained with routine dependency upkeep. Runs in
browsers, Node 20+, and serverless. Built on `@hpke/core`, with `@noble/curves`
pulled in for P-256 and optional post-quantum ciphersuites available through
ML-KEM and X-Wing.

React Native is not listed as a supported environment. It is pure JavaScript with
no native module, so it should load in Hermes; whether its HPKE layer finds the
Web Crypto primitives it needs there is exactly the open question above.

The authors state it has not had a formal security audit and recommend an
independent review before production use.

### mls-rs (awslabs)

Rust implementation of RFC 9420 from AWS Labs. Apache-2.0 or MIT. Actively
developed, 76 releases. Validated for conformance to RFC 9420 but, in its own
words, has "not yet received a full security audit by a 3rd party." Advertises
WASM builds, plus `mls-rs-ffi` and `mls-rs-uniffi` for language bindings; the
Web Crypto provider is marked experimental.

The natural fit for an AWS-targeted stack, and the strongest engineering artifact
in the list. It is also the one we cannot use today: WASM gives us the browser
and nothing dependable on Hermes, and the UniFFI path means a native module,
which means leaving Expo Go and taking on prebuild plus a Rust toolchain in CI.

### matrix-sdk-crypto-wasm, with react-native-matrix-crypto

Olm and Megolm via vodozemac, the implementation Element ships. Apache-2.0,
actively maintained, and usable without a Matrix homeserver since the crypto
crate is a no-network state machine. It is a WebAssembly binding and requires
`initAsync()`, so on its own it is browser and Node only.

Linagora's `react-native-matrix-crypto` covers the native gap with a JSI Turbo
Module carrying prebuilt binaries, no Rust toolchain needed. It requires React
Native 0.87 with the New Architecture, which is well ahead of our 0.76.9, and it
supports iOS and Android only, so we would be running two different crypto
implementations on our two surfaces and hoping they agree. Its own documentation
lists sharp edges worth reading anyway: the app must drain the outbound request
queue itself, cross-signing setup is a seven step sequence where skipping the
final key query silently leaves events unverified, a device reading `verified`
does not mean an old event's sender was authenticated, and the recovery key cannot
be regenerated.

## Comparison

| | ts-mls | mls-rs | matrix-sdk-crypto-wasm |
|---|---|---|---|
| Protocol | MLS, RFC 9420 | MLS, RFC 9420 | Olm / Megolm |
| License | MIT | Apache-2.0 or MIT | Apache-2.0 |
| Maintained | Yes, v1.6.2 Mar 2026 | Yes, 76 releases | Yes |
| Runs in browser | Yes | Via WASM | Via WASM |
| Runs in Hermes | Pure JS, pending WebCrypto spike | No dependable path today | No, needs the RN bridge |
| Native module required | No | Yes for native | Yes for native |
| Minimum RN / Expo | Current (0.76 / SDK 52) | Prebuild plus Rust in CI | RN 0.87, Expo SDK 56+ |
| Third party audit | No | No, conformance validated | Element's production implementation |
| Post-quantum option | Yes, ML-KEM and X-Wing | Roadmap dependent | No |

## Recommendation

**Adopt MLS as the protocol. Start on ts-mls. Treat mls-rs as the named exit.**

The protocol choice is the durable decision and the library choice is not, and
that is the whole argument. MLS is an IETF standard with a defined wire format,
so ts-mls and mls-rs are two implementations of the same thing. Olm and Megolm
are a de facto protocol defined by one implementation, so choosing that route
means every future migration is a flag day for existing conversations.

That reframes the audit problem. ts-mls being unaudited would be a serious
objection if it were a permanent commitment. It is not. If an independent review
goes badly, or if we outgrow it, the replacement is mls-rs: same RFC, AWS Labs,
conformance validated, and already the option best aligned with where the backend
is going. Group state and ciphertext stay valid across that swap. We are picking
a protocol we can stay on and an implementation we can leave.

Everything else follows from the runtime facts. ts-mls is the only candidate that
runs on both surfaces without a native module and without first dragging the Expo
app through three or four major versions. mls-rs is the better library and cannot
be used yet. The Matrix route would have us running different crypto on web than
on native, which is the specific thing a single shared client codebase exists to
avoid.

Two consequences to accept openly. MLS is group-oriented, so a one-to-one chat is
a two member group; that is normal MLS usage and it means the group messaging in
ROADMAP.md's out-of-scope list becomes cheap later rather than a rewrite. And
because ts-mls is unaudited, the ROADMAP acceptance line about tampered ciphertext,
replays and unauthorized recipients failing safely is not a checkbox we inherit
from the library. We write those tests ourselves.

## The spike that gates this

Do not install anything into `apps/mobile` on the strength of this document. One
throwaway spike decides whether the recommendation survives contact with Hermes.

Build a scratch Expo app on the versions we actually run, import ts-mls, and on a
physical iOS device and a physical Android device create a two member group,
exchange a message each way, and confirm the plaintext round trips. Run the same
code in the `/mobile/` web build. Record which ciphersuite worked and which
crypto primitives resolved.

The likely failure is `@hpke/core` reaching for `crypto.subtle` and not finding
it. If that happens, the question is whether ts-mls accepts a crypto provider
backed by `@noble/curves` and `@noble/hashes`, which are pure JavaScript and do
run in Hermes. If it does, we supply one and the recommendation stands. If it
does not, the recommendation changes rather than gets patched, and the realistic
alternative is accepting the native module and the Expo upgrade in order to reach
mls-rs, which is a scheduling decision to bring back rather than something to
improvise around.

Budget the spike as its own piece of work. Its only deliverable is an answer.

## Sources

- [signalapp/libsignal](https://github.com/signalapp/libsignal)
- [@privacyresearch/libsignal-protocol-typescript on Socket](https://socket.dev/npm/package/@privacyresearch/libsignal-protocol-typescript)
- [privacyresearchgroup/libsignal-protocol-typescript](https://github.com/privacyresearchgroup/libsignal-protocol-typescript)
- [LukaJCB/ts-mls](https://github.com/LukaJCB/ts-mls)
- [awslabs/mls-rs](https://github.com/awslabs/mls-rs)
- [matrix-org/matrix-sdk-crypto-wasm](https://github.com/matrix-org/matrix-sdk-crypto-wasm)
- [linagora/react-native-matrix-crypto](https://github.com/linagora/react-native-matrix-crypto)
- [React Native 0.84 release post](https://reactnative.dev/blog/2026/02/11/react-native-0.84)
- [Hermes issue 429, WASM support](https://github.com/facebook/hermes/issues/429)
- [Expo SDK 55 changelog](https://expo.dev/changelog/sdk-55)
- [expo-crypto API reference](https://docs.expo.dev/versions/latest/sdk/crypto/)
- [react-native-quick-crypto issue 167, crypto.subtle](https://github.com/margelo/react-native-quick-crypto/issues/167)
