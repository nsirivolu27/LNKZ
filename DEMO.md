# A conversation crosses the machine boundary

For a self-contained run after the README installation, use `pnpm demo`. It
generates temporary API keys, starts two processes, loads the seed corpus,
queries it, transfers a conversation and appends a continuation. It prints no
keys or bearer links. `pnpm demo --record` refreshes the checked-in terminal
recording and text sample from actual responses.

## The whole journey, asserted

`pnpm demo` narrates a transfer for a viewer. `pnpm verify:journey` proves one,
which is a different job: it starts two relays on separate databases with
separate keys and walks A to B and back with hard assertions, then reports the
step that failed rather than a generic message.

```bash
pnpm build
pnpm verify:journey
```

It covers what the product claims. Each relay refuses the other's key. A's
conversation id means nothing on B. A one-use link survives being previewed
repeatedly and is spent by a single import. Redaction strips a planted
credential on the way out while leaving A's own copy intact. B continues the
work under another provider, appends a turn, and hands it back, and A resolves
the returned copy to its own original rather than to an id that only ever
existed on B. A revoked link closes redemption, preview, import, dry run import
and continuation. Both relays restart with their data and lineage intact.

It does not check the mobile layout. Nothing in a REST harness can see a
screen, so phone-width behaviour stays a manual check.

## The same transfer, one command at a time

The following Bash commands are local-only. Use three terminals in the repository
after `pnpm build`. Choose unused data paths if you already have demo databases.

Terminal A:

```bash
NODE_ENV=development HOST=127.0.0.1 PORT=3100 LNKZ_ALLOW_UNAUTHENTICATED=true LNKZ_DB_FILE=.data/demo-a.db LNKZ_PUBLIC_BASE_URL=http://127.0.0.1:3100 pnpm start
```

Terminal B:

```bash
NODE_ENV=development HOST=127.0.0.1 PORT=3101 LNKZ_ALLOW_UNAUTHENTICATED=true LNKZ_DB_FILE=.data/demo-b.db LNKZ_PUBLIC_BASE_URL=http://127.0.0.1:3101 LNKZ_TRANSFER_ALLOW_PRIVATE=true pnpm start
```

Terminal C:

```bash
pnpm seed http://127.0.0.1:3100
pnpm ask "forecast model"
node --input-type=module <<'JS'
async function post(base, path, body) {
  const response = await fetch(base + path, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Demo request failed');
  return response.json();
}
const a = 'http://127.0.0.1:3100';
const b = 'http://127.0.0.1:3101';
const sourceId = 'a1000001-0000-4000-8000-000000000001';
const handoff = await post(a, `/api/conversations/${sourceId}/handoffs`, {
  ttlMinutes: 5, maxUses: 1, redact: true
});
const imported = await post(b, '/api/conversations/import-url', {url: handoff.shareUrl});
const id = imported.conversation.id;
await post(b, `/api/conversations/${id}/messages`, {
  messages: [{role: 'assistant', author: 'Claude', content: 'I will compare the seasonal baseline before revisiting gradient boosting.'}]
});
const saved = await (await fetch(`${b}/api/conversations/${id}`)).json();
console.log(JSON.stringify({title: saved.conversation.title, lineage: saved.conversation.lineage, continuation: saved.conversation.messages.at(-1)}, null, 2));
JS
```

The final read comes from B's store. Its lineage names A and the original
conversation ID. Stop A: B still has the conversation. Ctrl-C stops each server;
the explicit-command version keeps the databases for inspection.

For separate machines use their HTTPS public origins, set each instance's API
key in its calling client, and leave private-address transfer disabled. See
[DEPLOY.md](DEPLOY.md) for public configuration. A link is a bearer capability;
do not put it into a recording or log.

## What the recording proves

[demo.cast](docs/demo.cast) and [demo-output.txt](docs/demo-output.txt) capture
`pnpm demo --record` against the repository's synthetic corpus. The continuation
is a scripted client message, not a live model response. The extraction and
transfer come from running relay instances. Random ports and timestamps can
change between runs.
