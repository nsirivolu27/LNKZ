# LLMM/LNKZ REST API

The LLMM repository exposes the authenticated REST relay. MCP hosting is
provided by the standalone [`lnkz-mcp`](https://github.com/nsirivolu27/lnkz-mcp)
adapter, which translates its stable tools, resources, and prompts into these
routes.

## Authentication

Set `LNKZ_API_KEY` on the relay and send:

```http
Authorization: Bearer <LNKZ_API_KEY>
```

`GET /health` is unauthenticated. Share URLs are intentionally
unauthenticated, rate-limited, no-store bearer links. All other `/api/*`
routes require the key.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness and connector summary |
| `POST` | `/api/conversations` | Save a normalized conversation |
| `GET` | `/api/conversations` | List conversations |
| `GET` | `/api/conversations/:id` | Conversation plus analysis |
| `DELETE` | `/api/conversations/:id` | Delete |
| `POST` | `/api/conversations/:id/messages` | Append turns |
| `POST` | `/api/conversations/search` | Ranked search |
| `POST` | `/api/conversations/import` | Import, with `dryRun` |
| `GET` | `/api/conversations/:id/export?format=` | Export |
| `POST` | `/api/conversations/:id/handoffs` | Create a handoff |
| `GET` | `/api/handoffs` | List handoffs |
| `DELETE` | `/api/handoffs/:id` | Revoke |
| `GET` | `/share/:token` | Redeem a handoff |
| `POST` | `/api/context/search` | Federated search |
| `POST` | `/api/context/packet` | Build a context packet |
| `GET` | `/api/context/conflicts` | Contradiction candidates |
| `GET` | `/api/context/duplicates` | Near-duplicate pairs |
| `GET` | `/api/graph` | Conversation graph |
| `GET` | `/api/publish/targets` | Downstream MCP discovery |
| `POST` | `/api/publish/prepare` | Prepare, never send, a downstream call |
| `GET` | `/api/connectors` | Connector status |
| `GET` | `/api/stats` | Workspace statistics |
| `GET` | `/api/events` | Audit events |