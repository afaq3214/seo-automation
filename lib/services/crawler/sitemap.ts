import * as cheerio from "cheerio";
import { logger } from "@/lib/logger";
import { fetchText } from "./http";

const MAX_SITEMAP_FILES = 10;
const MAX_URLS = 2000;

export interface SitemapResult {
  /** First sitemap that returned URLs, for reference */
  sitemapUrl: string | null;
  urls: string[];
}

/**
 * Collect page URLs from sitemaps listed in robots.txt, falling back to /sitemap.xml.
 * Follows sitemap indexes (breadth-first, capped). Gzipped sitemaps are skipped.
 */
export async function fetchSitemapUrls(origin: string, robotsSitemaps: string[]): Promise<SitemapResult> {
  // robots.txt sitemaps first, then the conventional locations (robots entries are often stale).
  const queue = [...robotsSitemaps, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const visited = new Set<string>();
  const urls = new Set<string>();
  let sitemapUrl: string | null = null;

  while (queue.length && visited.size < MAX_SITEMAP_FILES && urls.size < MAX_URLS) {
    const current = queue.shift()!;
    if (visited.has(current) || /\.gz($|\?)/i.test(current)) continue;
    visited.add(current);

    const res = await fetchText(current, 15_000);
    if (!res || !res.ok || !/<(urlset|sitemapindex)[\s>]/i.test(res.text)) continue;

    const $ = cheerio.load(res.text, { xml: true });

    const children = $("sitemapindex > sitemap > loc")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    // Visit page/service/product sitemaps before blog/post/tag ones.
    children.sort((a, b) => sitemapPriority(a) - sitemapPriority(b));
    queue.push(...children);

    $("urlset > url > loc").each((_, el) => {
      const loc = $(el).text().trim();
      if (loc && urls.size < MAX_URLS) urls.add(loc);
    });

    if (!sitemapUrl && $("urlset > url > loc").length) sitemapUrl = current;
  }

  logger.info("sitemap collected", { origin, sitemapsRead: visited.size, urls: urls.size });
  return { sitemapUrl, urls: [...urls] };
}

function sitemapPriority(url: string): number {
  if (/page|service|product|solution|categor/i.test(url)) return 0;
  if (/post|blog|news|article|tag|author/i.test(url)) return 2;
  return 1;
}
