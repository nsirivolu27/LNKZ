import type { ConversationStore } from "../store/index.js";
import type { Actor, Connector, ContextItem } from "../types.js";

export function createLnkzConnector(store: ConversationStore, scopedActor?: Actor): Connector {
  const actor = scopedActor ?? { id: "connector", workspaceId: process.env.LNKZ_WORKSPACE_ID || "default", role: "owner" as const, auth: "stdio" as const };
  return {
    id: "lnkz",
    label: "LNKZ conversations",
    status: () => ({
      id: "lnkz",
      label: "LNKZ conversations",
      configured: true,
      detail: "Portable conversation storage, packets, and handoffs are available.",
    }),
    search: async (query, limit) => {
      const matches = await store.search(query, limit, actor);
      return matches.map((match): ContextItem => ({
        source: "lnkz",
        id: match.id,
        title: match.title,
        text: match.snippet || match.summary || `${match.messageCount} messages from ${match.source.provider}`,
        url: match.source.url,
        updatedAt: match.updatedAt,
        metadata: {
          provider: match.source.provider,
          app: match.source.app,
          participants: match.participants,
          tags: match.tags,
          messageCount: match.messageCount,
          relevance: match.relevance,
        },
      }));
    },
  };
}
