# LNKZ MCP and API reference

LNKZ exposes stateless Streamable HTTP at `POST /mcp` and stdio through `dist/stdio.mjs`.
When authentication is enabled, send `Authorization: Bearer <key>`.

## Multi-node context forwarding

Set the same high-entropy `LNKZ_MCP_CONTEXT_SECRET` on LNKZ nodes that are allowed to trust one
another. During an authenticated MCP request, outbound federation and publish-discovery calls add
an opaque `x-lnkz-context` value. It is an HMAC-SHA-256 envelope containing the workspace ID,
actor ID, scopes, a short expiry, and trace information. The default lifetime is 60 seconds and a
receiver refuses envelopes whose signed lifetime exceeds five minutes.

The header is accepted only by the MCP authentication boundary. Plain workspace headers are never
trusted. A valid API key or a managed-auth context takes precedence, and malformed, expired,
incorrectly scoped, or incorrectly signed envelopes fail closed. Do not put the shared secret in a
URL, MCP argument, log, response, or source file. Rotate it as a coordinated deployment across all
trusted nodes; during rotation, nodes using different secrets will reject forwarded requests.

`GET /health` reports only whether forwarding is enabled. It never returns the secret or an
envelope.

## MCP tools

### Conversations

- `save_conversation` — store a normalized conversation.
- `import_conversation` — import ChatGPT, Claude, Gemini, OpenAI, LNKZ, Markdown, or text payloads.
- `export_conversation` — write Markdown, brief, OpenAI, ChatGPT, Claude, LNKZ, LaTeX, or text.
- `get_conversation`, `list_conversations`, `search_conversations`, `append_messages`.
- `delete_conversation` — remove a conversation and related handoffs.

### Handoffs

- `create_handoff`, `redeem_handoff`, `continue_handoff`, `revoke_handoff`, `list_handoffs`.

### Context intelligence

- `build_context_packet`, `analyze_conversation`, `find_conflicts`, `find_duplicates`.
- `build_context_graph` — expose lineage, shared topics, duplicates, and contradiction candidates.

### Federation and publishing

- `search_context`, `list_connectors`, `workspace_stats`, `audit_log`.
- `list_publish_targets`, `prepare_publish` — inspect and prepare downstream MCP calls without sending them.

## Resources

- `lnkz://connectors`
- `lnkz://stats`
- `lnkz://conversations`
- `lnkz://graph`
- `lnkz://conversation/{id}`

## Prompts

- `continue_shared_conversation`
- `research_brief`
- `prepare_handoff`
- `reconcile_conflicts`

## REST routes

- `GET /health`
- `POST /api/conversations`, `GET /api/conversations`, `GET /api/conversations/:id`
- `DELETE /api/conversations/:id`, `POST /api/conversations/:id/messages`
- `POST /api/conversations/import`, `POST /api/conversations/search`
- `GET /api/conversations/:id/export`
- `POST /api/conversations/:id/handoffs`, `GET /api/handoffs`, `DELETE /api/handoffs/:id`
- `POST /api/context/search`, `POST /api/context/packet`
- `GET /api/context/conflicts`, `GET /api/context/duplicates`
- `GET /api/connectors`, `GET /api/stats`, `GET /api/events`
- `GET /share/:token` for bearer handoff redemption
- `POST /api/publish/prepare`, `GET /api/publish/targets`, `GET /api/graph`

## Configuration

| Variable | Purpose |
| --- | --- |
| `LNKZ_API_KEY` | Compatibility bearer key; required in production |
| `LNKZ_API_KEYS_JSON` | Multi-workspace static principals |
| `LNKZ_AUTH_MODE` | `static` or `multi-key`; multi-key requires Postgres |
| `LNKZ_ALLOW_UNAUTHENTICATED` | Explicit local-development escape hatch |
| `LNKZ_MCP_PATH` | MCP HTTP path, default `/mcp` |
| `LNKZ_MCP_API_KEY_REQUIRED` | Require a key for MCP requests |
| `LNKZ_MCP_CONTEXT_SECRET` | Shared HMAC secret for trusted multi-node MCP context forwarding; minimum 32 bytes |
| `DATABASE_URL` | Switch from SQLite to Postgres |
| `LNKZ_DATABASE_APP_ROLE` | Runtime Postgres role granted by migrations |
| `LNKZ_MCP_TARGETS` | Downstream MCP targets for publish preparation |
| `SLACK_*`, `JIRA_*`, `FIGMA_*`, `DOCUMENT_FEED_*` | Optional read-only connectors |

All connector credentials stay in environment configuration and are never passed as MCP tool
arguments or persisted in conversation content by the relay itself.
