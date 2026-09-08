# LLMM and LNKZ consolidation

LNKZ is the canonical repository and product name. The consolidation commit
joins LNKZ main with LLMM main as Git parents, keeping both histories reachable.

Source snapshots:

- LNKZ: `dbd4736` (main), including the merged operations and demo work.
- LLMM: `f06d978f691ad67dbbe45992ec4dcd98f309d332` (main).

## Where the code went

| LLMM source | Combined LNKZ location |
| --- | --- |
| `src/`, `index.html`, `console.html`, Vite config | `apps/web/` |
| `infra/` | `infra/`, with workspace scripts and a local CDK config |
| `render.yaml` | Root blueprint, adjusted to the combined image and data path |
| Product and setup documentation | Consolidated into README, ARCHITECTURE and DEPLOY |
| `lnkz-relay/`, `relay/` in a development branch | Superseded by current `src/lnkz/`; no second store or workflow implementation |
| Embedded `mcp-server/` | Superseded by LNKZ's existing HTTP/stdio surfaces; the standalone adapter repository remains available |
| npm lockfiles and nested CI | One root pnpm workspace lockfile and CI workflow |
| Old Docker/Fly definitions | LNKZ's current operational configurations, now including the built web app |
| Graphify setup and migration wrappers with split-repository paths | Remain in source history; active scripts stay rooted in this repository |

The web app's API requests still use the public REST boundary. No tool names,
resource URIs, environment variable names, storage schema, or conversation data
were renamed. The runtime dependency set is unchanged. Vite and the existing
CDK tooling are development dependencies in their respective workspaces.

LLMM's original repository is retained for provenance. This consolidation does
not delete its branches, issues, or history, deploy a server, or complete the
unfinished instance-signing work.
