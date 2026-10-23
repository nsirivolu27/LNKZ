# LNKZ MCP and API reference

LNKZ exposes stateless Streamable HTTP at `POST /mcp` and stdio through `dist/lnkz/stdio.mjs`.
When authentication is enabled, send `Authorization: Bearer <key>`.

## Claude Desktop setup

Build the repository using the README quick start, then open Claude Desktop's
developer settings and edit its MCP configuration. Use absolute paths on your
machine. This stdio process can share the local SQLite file with your HTTP server:

```json
{
  "mcpServers": {
    "lnkz": {
      "command": "node",
      "args": ["/absolute/path/LNKZ/dist/lnkz/stdio.mjs"],
      "env": {
        "NODE_ENV": "development",
        "LNKZ_DB_FILE": "/absolute/path/LNKZ/.data/lnkz.db",
        "LNKZ_PUBLIC_BASE_URL": "http://127.0.0.1:3100"
      }
    }
  }
}
```

On Windows, use JSON-escaped paths such as `C:\\path\\LNKZ\\dist\\lnkz\\stdio.mjs`
and an absolute Node executable if it is not on the client's PATH. Restart the
client after saving. Keep the HTTP process running when minting links so those
links can be opened. For a hosted relay, use a client supporting Streamable
HTTP at `/mcp` with its bearer key, or the separate
[lnkz-mcp adapter](https://github.com/nsirivolu27/lnkz-mcp).

After running `pnpm seed`, say:

1. "Search my LNKZ conversations for the forecast model decision."
2. "Build a context packet from those conversations, including what changed."
3. "Save this conversation into LNKZ."
4. "Create a redacted handoff for it, expiring in 30 minutes, with one use."

In the receiving client: "Import this LNKZ share link, show its origin lineage,
and continue from the decisions it contains." Supply the link privately.

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

25 tools, 5 resources, and 4 prompts. Names, resource URIs and LNKZ_ environment
variable names are compatibility contracts.

### Conversations

- `save_conversation` â€” store a normalized conversation.
- `import_from_url` — pull a share link from another instance with origin lineage.
- `import_conversation` â€” import ChatGPT, Claude, Gemini, OpenAI, LNKZ, Markdown, or text payloads.
- `export_conversation` â€” write Markdown, brief, OpenAI, ChatGPT, Claude, LNKZ, LaTeX, or text.
- `get_conversation`, `list_conversations`, `search_conversations`, `append_messages`.
- `delete_conversation` â€” remove a conversation and related handoffs.

### Handoffs

- `create_handoff`, `redeem_handoff`, `continue_handoff`, `revoke_handoff`, `list_handoffs`.

### Context intelligence

- `build_context_packet`, `analyze_conversation`, `find_conflicts`, `find_duplicates`.
- `build_context_graph` â€” expose lineage, shared topics, duplicates, and contradiction candidates.

### Federation and publishing

- `search_context`, `list_connectors`, `workspace_stats`, `audit_log`.
- `list_publish_targets`, `prepare_publish` â€” inspect and prepare downstream MCP calls without sending them.

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

- `POST /api/conversations/import-url`, `POST /api/handoffs/continue`

- `GET /health`
- `GET /ready`
- `POST /api/conversations`, `GET /api/conversations`, `GET /api/conversations/:id`
- `DELETE /api/conversations/:id`, `POST /api/conversations/:id/messages`
- `POST /api/conversations/import`, `POST /api/conversations/search`
- `GET /api/conversations/:id/export`
- `POST /api/conversations/:id/handoffs`, `GET /api/handoffs`, `DELETE /api/handoffs/:id`
- `POST /api/context/search`, `POST /api/context/packet`
- `GET /api/context/conflicts`, `GET /api/context/duplicates`
- `GET /api/connectors`, `GET /api/stats`, `GET /api/events`
- `GET /share/:token` for bearer handoff redemption
- `GET /share/:token/preview` for the same link without redeeming it: title,
  provider and message count only, never the transcript. Answers `410` when the
  link is dead, which is how a caller tells that apart from the `404` an older
  relay returns for a route it does not have.
- `POST /api/handoffs/continue` takes either a `token` for a handoff minted here
  or a `url` for another instance's link, and never both.
- `POST /api/publish/prepare`, `POST /api/publish/execute`, `GET /api/publish/targets`, `GET /api/graph`

Configuration and defaults are documented in [DEPLOY.md](DEPLOY.md).

## Moving a conversation between two instances

Four tools cover the crossing, and the difference between them matters.

- `preview_handoff` reports what a link holds without redeeming it. No
  transcript, no use spent, safe on a one-use link.
- `import_from_url` takes a copy and records where it came from. Its `dryRun`
  is the same peek as `preview_handoff` and likewise costs nothing.
- `continue_from_link` stores your continuation of someone else's conversation
  as a new conversation, recording the origin instance and the provider that
  carried it forward.
- `continue_handoff` does the same for a link this instance minted, and can
  point at the parent row because that row is local.

Importing and then appending is not the same as continuing. It edits your copy
and leaves nothing saying the work moved on.

## Writing to another system

`prepare_publish` maps a conversation onto a remote tool's input schema and
shows the exact call. `execute_publish` makes it. They are separate because a
read that goes wrong wastes a request and a write that goes wrong is a ticket
somebody has to close.

Three rules govern the second one.

`LNKZ_MCP_TARGETS` says where LNKZ may read. `LNKZ_PUBLISH_ALLOWLIST` says
what it may write, as explicit `target:tool` pairs:

```text
LNKZ_PUBLISH_ALLOWLIST=jira:create_issue,slack:post_message
```

Per tool, not per target, because allowing a target wholesale allows every
write it grows later. Absent means nothing publishes, in every environment
including development, since a rule that relaxes itself locally is one you
find out about in production.

Redaction runs before the call and defaults on. The packet goes to a system
LNKZ does not control and often cannot delete from.

Every attempt is recorded as `publish.sent`, `publish.refused` or
`publish.failed`, with the target, tool, shape and whether redaction was on,
and never the arguments. Redacting on the way out is pointless if the payload
lands in the audit log on the way past.
