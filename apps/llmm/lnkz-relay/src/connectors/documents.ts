import { fetchJson, matchesQuery } from "../http.js";
import type { Connector, ContextItem } from "../types.js";

interface FeedDocument {
  id?: string;
  title?: string;
  text?: string;
  url?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export function createDocumentsConnector(env: NodeJS.ProcessEnv = process.env): Connector | null {
  const urls = (env.DOCUMENT_FEED_URLS ?? "").split(",").map((url) => url.trim()).filter(Boolean);
  if (urls.length === 0) return null;
  const token = env.DOCUMENT_FEED_BEARER_TOKEN?.trim();

  return {
    id: "documents",
    label: "Documentation feeds",
    status: () => ({
      id: "documents",
      label: "Documentation feeds",
      configured: true,
      detail: `${urls.length} normalized JSON feed(s) configured.`,
    }),
    search: async (query, limit) => {
      const feeds = await Promise.all(urls.map(async (url) => {
        const body = await fetchJson<FeedDocument[] | { items?: FeedDocument[] }>(url, {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
        });
        return { url, documents: Array.isArray(body) ? body : body.items ?? [] };
      }));
      return feeds.flatMap(({ url, documents }) => documents
        .filter((document) => matchesQuery(query, document.title, document.text))
        .map((document, index): ContextItem => ({
          source: "documents",
          id: document.id ?? `${url}:${index}`,
          title: document.title ?? "Untitled document",
          text: document.text ?? "",
          url: document.url,
          updatedAt: document.updatedAt,
          metadata: { feedUrl: url, ...document.metadata },
        })))
        .slice(0, limit);
    },
  };
}
