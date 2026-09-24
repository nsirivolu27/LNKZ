# LNKZ messenger UI specification

The screens of the messenger described in ROADMAP.md. This is the reference a
design pass builds against and the contract the React Native components have to
satisfy afterwards.

Today `apps/mobile` is still the old relay console: Home, Library, Import,
Handoffs, Settings. That is the previous product. Nothing below describes what
is currently on screen.

## The constraint that shapes everything

One codebase renders both surfaces. `apps/mobile` is an Expo app; its web export
is served by the relay at `/mobile/`, and `scripts/verify-web.mjs` asserts the
bundle loads from the relay origin. So a design that only works as HTML and CSS
cannot ship. React Native has no CSS grid, no pseudo-elements, no `position:
sticky`, no `:hover` on touch, no box-shadow spread on Android, and no cascade.

Design within this list and the port is mechanical:

- Flexbox only, and only `row` or `column`. No grid.
- Every color, size and space comes from a token in `apps/mobile/src/theme.ts`.
  No literal hex in a component.
- Borders are solid and uniform. One border per edge, no shorthand tricks.
- Elevation is a border plus a background step, never a shadow.
- Nothing depends on hover to be discoverable. Hover is decoration on web only.
- Text truncation is an explicit line count, not `text-overflow`.
- Icons are drawn shapes or text glyphs, not an icon font.

## Tokens

From `apps/mobile/src/theme.ts`. Both themes ship; the app follows the system
setting because `app.json` sets `userInterfaceStyle: automatic`.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#0A0610` | `#FAF7FD` | Page behind everything |
| `surface` | `#130D1C` | `#FFFFFF` | Bars, headers, sheets |
| `raised` | `#1B1327` | `#F3EEFA` | Cards, inputs, incoming bubbles |
| `selected` | `#251B35` | `#EAE2F5` | Active row, highlight |
| `line` | `#2C2140` | `#E4DCF0` | Standard border |
| `strong` | `#3E2F58` | `#CFC2E4` | Emphasised border, dividers |
| `text` | `#F2EDF8` | `#140D1F` | Primary text |
| `muted` | `#B0A4C4` | `#4E4361` | Secondary text, metadata |
| `subtle` | `#8B7DA3` | `#6B5F80` | Placeholders, disabled |
| `accent` | `#E84BA3` | `#B22273` | Primary action, own bubble |
| `onAccent` | `#12060E` | `#FFFFFF` | Text on accent |
| `lineage` | `#A87BFF` | `#6D34D6` | Provenance, AI context |
| `live` | `#34E0B0` | `#0C8F70` | Verified, delivered, online |
| `stop` | `#FF5C47` | `#C23A28` | Failure, revoked, unverified |

Three of these carry meaning and must never be used decoratively. `lineage` marks
where something came from. `live` marks a verified or confirmed state. `stop`
marks a failure or a trust problem. A design that uses `stop` because red looks
good makes the one screen where it matters unreadable.

Color is never the only signal. Every state that uses one of those three also
carries a word or a shape, because roughly one in twelve men cannot separate the
`live` and `stop` hues.

## Navigation

Five destinations. On narrow widths a bottom bar; at 900px and up a left rail
with the thread list beside it in a two pane layout.

1. **Inbox** Conversations with people.
2. **Compose** Start a share or a new conversation.
3. **Library** Your own saved content, including what you accepted from others.
4. **Activity** Deliveries, accepted shares, revocations, key changes.
5. **Settings** Devices, account, relay configuration.

Relay configuration used to be a top level tab. It is not product surface any
more and moves inside Settings.

## Screens

### 1. Identity setup

First run. Replaces the current server URL and API key form, which asked a
person to understand a relay before they could send anything.

Collect a display name, create the device key pair, register the public key.
The private key never leaves the device. Show a short explanation that this
device now holds a key, that losing every device means losing the history, and
that a password reset cannot recover encrypted messages. Say it once, plainly,
at the moment it becomes true.

Self-hosting a relay is an option in Settings, not a step here.

States: idle, generating key, registering, failed with a retry that does not
regenerate the key.

### 2. Device verification

Shown when a conversation is opened with an unverified contact, and again
whenever a contact's key changes.

Display the safety number for both sides and a scan option. Two outcomes only,
verified or not, with no in between that reads as partially safe.

The key change case is the important one. It appears as a full width banner
inside the thread at the point in the history where the change happened, not as
a toast. Wording says the contact's key changed, that messages from before the
change were encrypted to the old key, and that verification is needed again. The
composer stays usable, because blocking it teaches people to dismiss the banner.

States: unverified, verifying, verified, key changed, verification failed.

### 3. Inbox

The list of conversations.

Each row: contact name, verification pip, last message preview, timestamp,
unread count. Previews are generated on this device after decryption, so a row
can legitimately have nothing to show yet. That is a real state, not an error.

Row states: normal, unread, unverified contact, decrypting, undecryptable,
delivery failed, legacy plaintext thread.

The legacy state needs its own visible treatment. Existing plaintext relay
conversations remain reachable and must be labeled as not encrypted wherever
they appear. They never inherit the encrypted styling, and encryption never
silently falls back into this mode.

Empty state: no conversations, with one action to start one. Loading: skeleton
rows, not a spinner, so the shape of the list is established before content.

### 4. Conversation thread

The main screen.

Header carries the contact name, verification state, and an overflow menu with
verify, shared media, and mute. Body is a message list, newest at the bottom.

Message bubbles. Own messages use `accent` with `onAccent` text, aligned right.
Incoming use `raised` with `text`, aligned left. Timestamps and delivery state
sit below the bubble, not inside it, because attachment bubbles have no reliable
corner to put them in.

Delivery state is explicit and never optimistic: sending, sent, delivered,
failed. "Delivered" means the service acknowledged the envelope for the
recipient. It does not mean read, and the UI must not imply that.

**Attachment bubbles.** Image and video get a thumbnail decrypted on this device.
Audio gets a duration and a play control. Documents get a filename, type and
size. Any type with no supported preview gets a download action and says so
rather than showing a broken preview. Filenames, thumbnails and prompts are
inside the encrypted payload, so all of this renders only after decryption.

**The AI context block.** What makes this LNKZ rather than a generic messenger.
An attached share carries its source platform, the prompt when one exists, the
selected conversation, notes and attribution. It renders as a collapsed card
below the bubble, bordered in `lineage`, expanding to the full context.

Provenance the source did not actually provide is never invented. A share with
no known prompt says the prompt is unavailable, and a share whose provenance
cannot be checked says it is unverified.

**Undecryptable messages.** A message this device cannot decrypt, for instance
one sent before the device was added, renders as a placeholder bubble in
position with an explanation. It is never hidden, because a silently missing
message is worse than a visible gap.

Composer: text field, attach, send. Attach offers photo, video, audio, document,
paste a conversation, and import from a connected platform.

Thread states: loading history, empty, sending, offline with queued messages,
contact key changed, undecryptable messages present.

### 5. Share review

Between choosing content and sending it. This screen is the whole promise of
"see exactly what will be sent", so it cannot be skipped or collapsed into a
confirmation dialog.

Shows the content itself, then each optional context element as an individually
toggleable row: source platform, prompt, selected conversation, notes,
attribution. Default every toggle off except the content. Opting in to sharing a
prompt is a decision; opting out of one already on is a trap.

Redaction runs here, on this device. Show what will be removed, let it be
overridden per item.

For a conversation, allow selecting which messages go. Show the count and an
approximate size for what is selected.

Primary action names the recipient: "Send to Priya". Not "Share".

States: reviewing, redacting, nothing selected, too large for the upload limit.

### 6. Receiver picker

Choosing where a share goes. Two groups that must not look alike, because the
encryption guarantee differs between them.

**People and devices.** End to end encrypted. Verification state shown per
contact.

**Systems and AI platforms.** Not covered by the encryption between people. An
AI service that receives content can read it. Selecting one requires an explicit
confirmation naming the destination and stating that it becomes a disclosed
recipient. A destination that cannot participate in the protocol receives a
client side export, and that is labeled an export, never encrypted delivery.

After sending, the result states what actually happened: copied, link created,
downloaded, accepted, or delivery confirmed by a named integration. Opening a
platform is not evidence it received anything, and the UI never claims it is.

### 7. Shared media and history

Per conversation. Everything exchanged in one thread, filterable by type, each
item linking back to its message. Where a link was shared rather than a file, it
is labeled a link and notes that the recipient may need access to the source.

Empty state per filter, not one empty state for the screen.

### 8. Receiving a share

The recipient's side.

Preview first, always, and previewing costs nothing. Show what is inside, who
sent it, the provenance available, and whether the link is bounded by uses or
expiry. Then two distinct actions, because conflating them is how the chain gets
lost: **accept a copy** keeps it and records where it came from, and **continue**
does that and adds your turn as a new conversation naming the client that carried
it forward.

A recipient needs neither the sender's API key nor their source platform
credentials, and the screen must never ask for either.

Revocation cannot retract what was already downloaded. Where the UI mentions
revoking, it says so.

States: previewing, expired, revoked, already spent, accepting, continuing,
failed with the input preserved.

### 9. Settings

Account, devices, relay, legacy.

**Devices** lists each linked device with its added date and last seen, allows
revocation, and states what history a newly added device will and will not see.
That policy is a decision the ROADMAP requires defining, and the UI is where it
becomes visible.

**Recovery** explains that an account password reset alone cannot decrypt
history, and offers the encrypted backup flow if one exists. It never implies
server side recovery.

**Relay** holds the server URL and key for people running their own. Not
required for ordinary use.

**Legacy** reaches the old plaintext handoff surface, clearly separated and
clearly labeled.

## Component inventory

Build these once. Everything above composes from them.

Avatar, VerificationPip, MessageBubble, AttachmentCard, ContextCard,
DeliveryStatus, ConversationRow, MediaGrid, Composer, AttachMenu, ToggleRow,
RecipientRow, Banner, EmptyState, SkeletonRow, ActionButton, Sheet.

Four states are required on every component that loads or sends anything: empty,
loading, error, and success. A design that only draws the happy path is not
finished, and the encrypted cases below are the ones usually missing.

## The states that get skipped

Worth naming separately because a generic messenger design will not include
them and this product cannot ship without them:

- A message this device cannot decrypt.
- A contact whose key just changed.
- A contact who has never been verified.
- A thread that is legacy plaintext, not encrypted.
- A share whose provenance is unverified or absent.
- A send to an AI platform, which is a disclosure, not a delivery.
- An export to a system that cannot participate in the encryption.
- A revoked share that a recipient already downloaded.
- An attachment whose type has no preview.
- Queued messages while offline.

## Notes for the design pass

Design the dark theme first. It is the default in `app.json` and the accent was
picked against `#0A0610`.

Include every state listed above, not just the populated screens. The populated
screen is the easy half.

Do not introduce new colors. If something needs emphasis the tokens do not
cover, that is worth discussing before it is drawn, because each addition has to
be justified in both themes.

Mobile width first. The app is an Expo client and phone is the primary surface.

Real content, not lorem. A conversation share with its prompt attached is the
thing being designed, and it does not read correctly with filler in it.
