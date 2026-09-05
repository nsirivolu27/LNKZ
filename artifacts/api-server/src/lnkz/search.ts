import { queryTerms } from "./http.js";
import type { Connector, ConnectorId, ContextItem, SearchRequest, SearchResponse } from "./types.js";

export async function aggregateSearch(
  connectors: Connector[],
  request: SearchRequest,
): Promise<SearchResponse> {
  const query = request.query.trim();
  if (!query) throw new Error("A search query is required.");
  const limit = Math.max(1, Math.min(request.limit ?? 10, 50));
  const included = request.sources ? new Set<ConnectorId>(request.sources) : null;
  const excluded = new Set<ConnectorId>(request.excludeSources ?? []);
  const selected = connectors.filter(
    (connector) => connector.status().configured
      && !excluded.has(connector.id)
      && (!included || included.has(connector.id)),
  );

  const settled = await Promise.allSettled(
    selected.map(async (connector) => ({ connector, items: await connector.search(query, limit) })),
  );
  const errors: SearchResponse["errors"] = [];
  const items: ContextItem[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...result.value.items);
    else errors.push({
      source: selected[index].id,
      message: result.reason instanceof Error ? result.reason.message : "Unknown connector error.",
    });
  });

  const terms = queryTerms(query);
  const score = (item: ContextItem) => {
    const title = item.title.toLowerCase();
    const text = item.text.toLowerCase();
    return terms.reduce((sum, term) => sum + (title.includes(term) ? 3 : 0) + (text.includes(term) ? 1 : 0), 0);
  };
  const seen = new Set<string>();
  const ranked = items
    .sort((a, b) => score(b) - score(a) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .filter((item) => {
      const key = `${item.source}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);

  return { items: ranked, errors, searchedSources: selected.map((connector) => connector.id) };
}
