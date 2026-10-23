import { configuredExternalConnectors } from "./connectors/index.js";
import { createLnkzConnector } from "./connectors/lnkz.js";
import { toIdentityDocument } from "./identity.js";
import { PostgresConversationStore, SqliteConversationStore } from "./store/index.js";
import { resolveDatabaseUrl } from "./store/postgres.js";
import { PostgresRateLimiter } from "./store/rate-limit.js";
import type { ConversationStore } from "./store/index.js";
import type { Connector, InstanceIdentityDocument } from "./types.js";

export interface Runtime {
  store: ConversationStore;
  core: Connector;
  connectors: Connector[];
  sharedRateLimiter?: PostgresRateLimiter;
  identity: Promise<InstanceIdentityDocument>;
}

export function createRuntime(
  store?: ConversationStore,
  options: { instanceName?: string } = {},
): Runtime {
  const postgresConfigured = Boolean(resolveDatabaseUrl());
  const selectedStore = store
    ?? (postgresConfigured ? new PostgresConversationStore() : new SqliteConversationStore());
  const core = createLnkzConnector(selectedStore);
  const sharedRateLimiter = postgresConfigured ? new PostgresRateLimiter() : undefined;
  const identity = selectedStore
    .ensureInstanceIdentity(options.instanceName)
    .then(toIdentityDocument);
  return {
    store: selectedStore,
    core,
    connectors: [core, ...configuredExternalConnectors()],
    sharedRateLimiter,
    identity,
  };
}
