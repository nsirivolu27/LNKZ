export async function fetchJson<T>(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2);
}

export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  const terms = queryTerms(query);
  return terms.length === 0 || terms.every((term) => haystack.includes(term));
}

export function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return [row.text, row.content].map(textFromUnknown).filter(Boolean).join(" ");
  }
  return "";
}
