# LNKZ relay

The LNKZ relay is the REST boundary embedded in the LLMM product. It owns the
conversation store, imports and exports, context intelligence, connectors,
handoffs, graph, and publish preparation. It does **not** host MCP.

Run it from the LLMM repository:

```bash
npm ci --prefix lnkz-relay
cp lnkz-relay/.env.example lnkz-relay/.env
npm --prefix lnkz-relay run dev
```

SQLite is the default. Set `DATABASE_URL` to activate the Postgres store.
`LNKZ_API_KEY` protects the API in production; the relay fails closed when it
is configured and the key is missing or wrong.

The standalone MCP adapter lives in
[`nsirivolu27/lnkz-mcp`](https://github.com/nsirivolu27/lnkz-mcp). Configure it
with `LNKZ_BASE_URL` and `LNKZ_API_KEY`; it calls this relay over REST and keeps
all MCP hosting out of the LLMM product process.

## REST surface

`GET /health` is unauthenticated. The remaining API routes require the bearer
key: conversations, imports, exports, context packets, graph, connectors,
handoffs, audit events, and publish preparation. Share URLs are intentionally
unauthenticated, rate-limited, no-store bearer links.

```bash
npm --prefix lnkz-relay run typecheck
npm --prefix lnkz-relay test
npm --prefix lnkz-relay run build
```