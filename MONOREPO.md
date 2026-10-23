# LNKZ mobile/API repository

This repository contains the LNKZ mobile app and the authenticated API server
that it uses. The mobile client talks to the server through the published REST
contract; no sibling checkout is required.

- `artifacts/mobile/` — Expo mobile app and static Expo Go build
- `artifacts/api-server/` — REST/MCP API, authentication, storage, imports,
  handoffs, connectors, and analysis
- `lib/api-client-react/` — generated React Query client used by the mobile app
- `lib/api-zod/` — API validation schemas shared with the server
- `lib/db/` — Drizzle schema and database access used by the server

The removed web console, historical relay projects, standalone Magentic adapter,
mockup workspace, and repository-specific design materials are maintained
outside this repository.