import type { ConversationStore } from "../store/index.js";
import type { Connector, ContextItem } from "../types.js";

export function createLnkzConnector(store: ConversationStore): Connector {
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
      const matches = await store.search(query, limit);
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
