/**
 * Small, dependency-free similarity helpers. Two conversations relayed between
 * clients are frequently near-copies of each other, so LNKZ needs to recognize
 * "this is the same chat again" without an embedding service.
 */

export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function shingles(text: string, size = 3): Set<string> {
  const words = normalizeForCompare(text).split(" ").filter(Boolean);
  const result = new Set<string>();
  if (words.length < size) {
    if (words.length) result.add(words.join(" "));
    return result;
  }
  for (let index = 0; index + size <= words.length; index += 1) {
    result.add(words.slice(index, index + size).join(" "));
  }
  return result;
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) if (large.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function textSimilarity(left: string, right: string, shingleSize = 3): number {
  return jaccard(shingles(left, shingleSize), shingles(right, shingleSize));
}

/** Cheap cosine over term counts. Used for short sentence pairs. */
export function cosineSimilarity(left: string, right: string): number {
  const leftCounts = termCounts(left);
  const rightCounts = termCounts(right);
  let dot = 0;
  for (const [term, count] of leftCounts) dot += count * (rightCounts.get(term) ?? 0);
  const magnitude = Math.sqrt(magnitudeSquared(leftCounts)) * Math.sqrt(magnitudeSquared(rightCounts));
  return magnitude === 0 ? 0 : dot / magnitude;
}

function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of normalizeForCompare(text).split(" ")) {
    if (term.length < 2) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

function magnitudeSquared(counts: Map<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count * count;
  return total;
}
