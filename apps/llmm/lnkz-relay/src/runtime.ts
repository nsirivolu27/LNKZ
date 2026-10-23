import { configuredExternalConnectors } from "./connectors/index.js";
import { createLnkzConnector } from "./connectors/lnkz.js";
import { PostgresConversationStore, SqliteConversationStore } from "./store/index.js";
import { resolveDatabaseUrl } from "./store/postgres.js";
import { PostgresRateLimiter } from "./store/rate-limit.js";
import type { ConversationStore } from "./store/index.js";
import type { Connector } from "./types.js";

export interface Runtime {
  store: ConversationStore;
  core: Connector;
  connectors: Connector[];
  sharedRateLimiter?: PostgresRateLimiter;
}

export function createRuntime(store?: ConversationStore): Runtime {
  const postgresConfigured = Boolean(resolveDatabaseUrl());
  const selectedStore = store
    ?? (postgresConfigured ? new PostgresConversationStore() : new SqliteConversationStore());
  const core = createLnkzConnector(selectedStore);
  const sharedRateLimiter = postgresConfigured ? new PostgresRateLimiter() : undefined;
  return { store: selectedStore, core, connectors: [core, ...configuredExternalConnectors()], sharedRateLimiter };
}
