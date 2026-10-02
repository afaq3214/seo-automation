import { logger } from "@/lib/logger";
import { extractPage, type ExtractedPage } from "./extract";
import { fetchText, isHtml } from "./http";
import { closeBrowser, renderWithPlaywright } from "./render";
import { fetchRobots, isAllowedByRobots, type RobotsInfo } from "./robots";
import { dedupeKey, selectImportantUrls } from "./select";
import { fetchSitemapUrls } from "./sitemap";

export interface CrawledPage extends ExtractedPage {
  statusCode: number;
  renderedWith: "fetch" | "playwright";
}

export interface CrawlResult {
  homepageUrl: string;
  robots: RobotsInfo;
  sitemapUrl: string | null;
  pages: CrawledPage[];
}

/** Pages with fewer words than this are assumed to be JS-rendered. */
const THIN_PAGE_WORDS = 50;
const CONCURRENCY = 4;

/** Crawl the homepage plus the most important sitemap/nav pages, up to `maxPages` total. */
export async function crawlSite(startUrl: string, maxPages: number): Promise<CrawlResult> {
  try {
    const home = await crawlPage(startUrl);
    if (!home.page) {
      throw new Error(`Could not read the homepage (${home.reason}). Check the URL and that the site is public.`);
    }

    const origin = new URL(home.page.url).origin;
    const robots = await fetchRobots(origin);
    const sitemap = await fetchSitemapUrls(origin, robots.sitemaps);

    const targets = selectImportantUrls({
      homepage: home.page.url,
      sitemapUrls: sitemap.urls,
      homepageLinks: home.page.internalLinks,
      robots,
      max: maxPages - 1,
    });
    logger.info("crawl targets selected", {
      origin,
      robotsFound: robots.found,
      sitemapUrls: sitemap.urls.length,
      targets: targets.length,
    });

    const results = await mapWithConcurrency(targets, CONCURRENCY, crawlPage);

    // Redirects can land several URLs on the same page; keep the first of each.
    const pages: CrawledPage[] = [home.page];
    const seen = new Set([dedupeKey(home.page.url)]);
    for (const r of results) {
      if (!r.page || !isAllowedByRobots(r.page.url, robots)) continue;
      const key = dedupeKey(r.page.url);
      if (seen.has(key)) continue;
      seen.add(key);
      pages.push(r.page);
    }

    logger.info("crawl finished", { origin, pages: pages.length, failed: targets.length - (pages.length - 1) });
    return { homepageUrl: home.page.url, robots, sitemapUrl: sitemap.sitemapUrl, pages };
  } finally {
    await closeBrowser();
  }
}

export async function crawlPage(url: string): Promise<{ page: CrawledPage | null; reason?: string }> {
  const res = await fetchText(url);
  if (!res) return { page: null, reason: "network error or timeout" };
  if (!res.ok) return { page: null, reason: `HTTP ${res.status}` };
  if (!isHtml(res.contentType)) return { page: null, reason: `not HTML (${res.contentType})` };

  let page: CrawledPage = { ...extractPage(res.text, res.url), statusCode: res.status, renderedWith: "fetch" };

  if (page.wordCount < THIN_PAGE_WORDS) {
    const rendered = await renderWithPlaywright(res.url);
    if (rendered) {
      const extracted = extractPage(rendered, res.url);
      if (extracted.wordCount > page.wordCount) {
        page = { ...extracted, statusCode: res.status, renderedWith: "playwright" };
      }
    }
  }
  return { page };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
