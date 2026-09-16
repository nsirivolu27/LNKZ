# Use LNKZ on two devices

This setup serves the Expo mobile interface in each device's browser. Two independent
relays run on your laptop, with separate API keys and SQLite databases. The devices
exchange handoff links; they do not need each other's API keys. This is a local
test setup, not an AWS deployment or a signed iOS/Android release.

## Start

From the repository root, using Node 22 and the pinned pnpm:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm build:mobile
corepack pnpm dev:devices
```

The last command prints this computer's available IPv4 addresses. Run it again
with the Wi-Fi/LAN address (for example `corepack pnpm dev:devices 192.168.1.20`).
The new `dev:devices` launcher starts two persistent local relays. It refuses an
address that is not on your computer and reports occupied ports rather than
silently using another service.

Connect both devices to the same trusted Wi-Fi. Open the printed **Device A** URL
on one device and **Device B** URL on the other. The server URL is filled in
automatically. Open `.data/two-devices/connections.json` locally, and enter key A
on device A and key B on device B. Do not commit or post this file. Web connection
settings use browser local storage; native Expo uses SecureStore.

The laptop must remain awake. If a phone cannot load the page, check Wi-Fi client
isolation and Windows Firewall access for Node on your private network. Ports
3101 and 3102 must be free. `localhost` on a phone refers to the phone, not the
laptop. HTTP and private-address transfers here are for local testing only; use
HTTPS before running this across the internet.

## Complete the round trip

1. **A → Import:** paste a transcript or an exported chat. For a quick test:

   ```text
   User: How should we store this app's conversations?
   Assistant: We decided to use SQLite for the personal relay.
   User: What should we check next?
   Assistant: Test that both devices keep the conversation after restarting.
   ```

2. **A → Handoffs:** choose that conversation, review its context packet, set a
   use limit of **1**, leave redaction enabled, and create a handoff.
3. Copy the displayed link. Send its text to your other device. Paste it into
   **B → Import → Receive link** rather than opening the share URL in a browser:
   the raw share URL redeems the handoff, and link-unfurling tools can spend a use.
4. **B → Preview link:** check the title, source, message count and expiry.
   Preview again if desired; the use count stays unchanged.
5. Choose **Just keep a copy**, or name the client you are using, enter a follow-up,
   select **My message** or **Model response**, and choose **Continue it here**.
   Receiving spends one use. A continuation saves a new conversation and its
   origin; the sender's original remains unchanged.
6. On B, open the saved conversation and add a follow-up. Create a new handoff
   from B and receive it on A. Check that the sending instance and original chain
   survive the return trip.
7. Stop the launcher with Ctrl+C, restart with the same command, and refresh both
   devices. Both libraries should retain their copies. Keys and data remain in
   `.data/two-devices/`.

LNKZ transports conversations and builds context packets. The client/provider
field records where you continue your work; it does not call that model. Copy
the context packet into your LLM client, then save its response in LNKZ.

## Automated evidence

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm build:mobile
corepack pnpm verify:web
corepack pnpm verify:http
corepack pnpm verify:journey
corepack pnpm infra:synth
```

`verify:journey` starts independent relays and exercises the actual mobile API
client: authentication, repeated preview of a single-use link, import, redaction,
continuation, a return handoff, revocation with uses remaining, and persistence
after both relays restart. It also cleans up both processes. This verifies the
relay/client contract; the physical-device checklist above still needs to run
on your actual phones. PostgreSQL tests require their documented test database
configuration; the local two-device path uses SQLite.
