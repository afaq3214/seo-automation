import { isInSite, normalizePageUrl } from "@/lib/url";
import { isAllowedByRobots, type RobotsInfo } from "./robots";

export const FILE_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|rar|docx?|xlsx?|pptx?|csv|mp4|mov|mp3|wav|xml|json|txt|css|js)$/i;
const LOW_VALUE =
  /\/(tag|tags|author|feed|wp-json|wp-admin|wp-content|cart|checkout|my-account|account|login|register|search|cdn-cgi)(\/|$)|\/page\/\d+|[?&](s|page|p|add-to-cart|replytocom)=/i;
const LEGAL = /\/(privacy|terms|cookie|disclaimer|sitemap|legal)[^/]*\/?$/i;
const HIGH_VALUE =
  /(service|product|solution|about|pricing|price|industr|feature|platform|what-we-do|who-we-are|shop|collection|categor|location|team|how-it-works|offer)/i;
const ARTICLE = /\/(blog|news|posts?|articles?|insights|resources)\/.+|\/\d{4}\/\d{2}\//i;

/**
 * Pick the most useful pages to crawl for understanding the business:
 * shallow pages and service/product/about pages first, blog posts and utility pages last.
 */
export function selectImportantUrls(options: {
  homepage: string;
  /** Site base URL (origin, or origin + region folder): pages outside it are skipped */
  base: string;
  sitemapUrls: string[];
  homepageLinks: string[];
  robots: RobotsInfo;
  max: number;
}): string[] {
  const { homepage, base, sitemapUrls, homepageLinks, robots, max } = options;
  const linkedFromHome = new Set(homepageLinks);
  const homeKey = dedupeKey(homepage);

  const scored = new Map<string, number>();
  const seen = new Set<string>([homeKey]);
  for (const raw of [...homepageLinks, ...sitemapUrls]) {
    const url = normalizePageUrl(raw);
    if (!url || !isInSite(url, base)) continue;
    const key = dedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);

    const { pathname } = new URL(url);
    if (FILE_EXT.test(pathname) || LOW_VALUE.test(url) || LEGAL.test(pathname)) continue;
    if (!isAllowedByRobots(url, robots)) continue;

    const depth = pathname.split("/").filter(Boolean).length;
    let score = 10 - depth * 2;
    if (HIGH_VALUE.test(pathname)) score += 5;
    if (linkedFromHome.has(raw) || linkedFromHome.has(url)) score += 3;
    if (ARTICLE.test(pathname)) score -= 4;
    if (new URL(url).search) score -= 3;
    scored.set(url, score);
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, max)
    .map(([url]) => url);
}

/** Treat http/https, www/non-www and trailing slashes as the same page. */
export function dedupeKey(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.hostname.replace(/^www\./, "")}${path}${u.search}`;
}
