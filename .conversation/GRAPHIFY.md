# Graphify on this repository

[Graphify](https://github.com/Graphify-Labs/graphify) turns a codebase into a queryable
knowledge graph and can expose that graph over MCP. LNKZ uses it two ways: as a working
aid while the server is being built, and as a second MCP server sitting beside LNKZ's own,
which is a useful demonstration that the client is talking to a federation rather than a
single process.

## Build or refresh the graph

The checked-in `graphify-out/` was generated before the repository became an MCP server, so
it still describes the archived geo-social prototype. Refresh it from the repository root:

```powershell
graphify . --update
```

`--update` re-extracts only the files that changed. Drop it for a full rebuild. To keep the
graph current automatically:

```powershell
graphify hook install
```

## Use it from Claude Code

`.mcp.json` in the repository root already registers two stdio servers:

| Server | What it answers |
| --- | --- |
| `graphify` | Structure questions: what depends on what, which modules are hubs, where a concept lives |
| `lnkz` | Conversation context: saved chats, packets, handoffs, connected sources |

Claude Code picks that file up when it is opened in this folder. Build the LNKZ server first
so `mcp-server/dist/stdio.js` exists:

```bash
npm run build
```

Useful Graphify tools once it is connected: `graphify_overview`, `graphify_query`,
`graphify_path`, `graphify_explain`, `graphify_neighbors`, `graphify_freshness`.

## Use it from the Claude desktop app

The desktop app reads `%APPDATA%\Claude\claude_desktop_config.json`, which lives in a
protected folder, so it has to be written from the machine itself:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-graphify.ps1
```

The script preserves any servers already configured, backs the file up, and adds only the
`graphify` and `lnkz` entries. Restart the desktop app afterwards.

If you would rather edit it by hand, this is the equivalent:

```json
{
  "mcpServers": {
    "graphify": {
      "command": "C:\\Users\\nsiri\\AppData\\Roaming\\uv\\tools\\graphifyy\\Scripts\\python.exe",
      "args": ["-m", "graphify.serve", "C:\\Users\\nsiri\\OneDrive\\Documents\\Playground\\LNKZ\\graphify-out\\graph.json"]
    },
    "lnkz": {
      "command": "node",
      "args": ["C:\\Users\\nsiri\\OneDrive\\Documents\\Playground\\LNKZ\\mcp-server\\dist\\stdio.js"],
      "env": { "LNKZ_DB_FILE": "C:\\Users\\nsiri\\OneDrive\\Documents\\Playground\\LNKZ\\.data\\lnkz.db" }
    }
  }
}
```

## Graphify for other repositories

The same two steps work anywhere: `graphify .` in the repository, then add a `graphify`
entry pointing at that repository's `graphify-out/graph.json`. Each repository gets its own
graph; the server takes the graph path as an argument rather than discovering it.

For a richer toolset (graph building and labeling from inside the MCP session rather than
from the CLI), `graphify-mcp` is a separate server that wraps the same CLI:

```bash
pip install graphify-mcp
# then, as an MCP server entry:
#   command: graphify-mcp-server
#   env: { "GRAPHIFY_PROJECT_DIR": "." }
```

LNKZ does not depend on either one. Graphify is a development aid here, not a runtime
dependency of the server.
