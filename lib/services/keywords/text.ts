// Small text helpers shared by keyword cleaning, intent, clustering and difficulty.

const STOPWORDS = new Set(
  (
    "a an the and or for of to in on at by with from as is are be can do does how what why when where who which " +
    "my your our their its it this that these those i you we they me us near vs versus best top &"
  ).split(" "),
);

/**
 * Lowercase, strip punctuation and collapse whitespace.
 * Returns null for malformed keywords (too short/long, no letters, URLs, too many words).
 */
export function normalizeKeyword(raw: string): string | null {
  const k = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}\s&+'./-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (k.length < 2 || k.length > 80) return null;
  if (!/\p{L}/u.test(k)) return null;
  if (/https?:|www\.|\.(com|net|org|io|au|uk)\/\S/.test(k)) return null;
  if (k.split(" ").length > 10) return null;
  return k;
}

/** Very small suffix stemmer — only needs to be consistent, not linguistically correct. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && /(sses|xes|ches|shes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);

  if (w.length > 6 && w.endsWith("ation")) w = w.slice(0, -5) + "at";
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 5 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 6 && w.endsWith("er")) w = w.slice(0, -2);
  return w;
}

/** Meaningful stemmed tokens of a keyword or phrase. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokens(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Share of `needle` tokens present in `haystack` (0-1). */
export function coverage(needle: Set<string>, haystack: Set<string>): number {
  if (!needle.size) return 0;
  let hit = 0;
  for (const t of needle) if (haystack.has(t)) hit++;
  return hit / needle.size;
}

export function titleCase(text: string): string {
  return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
