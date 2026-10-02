const TRACKING_PARAMS = /^(utm_|gclid$|fbclid$|msclkid$|mc_cid$|mc_eid$)/i;
const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[)/i;

/**
 * Normalize user input into a crawlable absolute URL.
 * Adds https:// when missing, lowercases the host, drops hash and tracking params.
 * Throws a readable error for anything that isn't a public http(s) site.
 */
export function normalizeInputUrl(input: string): string {
  let raw = input.trim();
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Please enter a valid website URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }
  if (!url.hostname.includes(".") || PRIVATE_HOST.test(url.hostname)) {
    throw new Error("Please enter a public website domain");
  }

  const normalized = normalizePageUrl(url.toString());
  if (!normalized) throw new Error("Please enter a valid website URL");
  return normalized;
}

/** Resolve an href against a base and clean it. Returns null for non-http(s) links. */
export function normalizePageUrl(href: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(href, base) : new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/** Hostname without a leading "www." */
export function bareHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/** True when both URLs belong to the same site (www and non-www treated as equal). */
export function isSameSite(a: string, b: string): boolean {
  try {
    return bareHost(a) === bareHost(b);
  } catch {
    return false;
  }
}
