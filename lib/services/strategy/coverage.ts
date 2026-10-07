import { logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import { siteBase } from "@/lib/url";
import { fetchSitemapUrls } from "../crawler/sitemap";
import { coverage, tokenSet } from "../keywords/text";

/**
 * Does the user's site already have a page for a topic? Uses the crawled pages from Module 01
 * (title, H1, URL) plus sitemap URLs for pages the crawl didn't reach (e.g. blog posts).
 */

export interface SitePage {
  url: string;
  headingTokens: Set<string>; // title + H1
  slugTokens: Set<string>;
  wordCount: number | null; // null = only known from the sitemap
}

export interface CoverageResult {
  level: "covered" | "partial" | "none";
  pageUrl: string | null;
}

/** A page covers a topic when its title/H1 (or URL) contains ≥80% of the keyword's words. */
const COVERED = 0.8;
const PARTIAL = 0.5;
/** Crawled pages thinner than this don't count as a strong existing page. */
const MIN_STRONG_WORDS = 300;
/** URL words that say nothing about a page's topic. */
const GENERIC_SLUG = new Set(["industry", "industri", "solution", "blog", "resource", "page", "post", "feature", "en", "au", "us", "uk"]);

/** The project's pages as stored by the crawl (no network). */
export async function loadCrawledPages(projectId: string): Promise<SitePage[]> {
  const { data, error } = await supabaseAdmin()
    .from("project_pages")
    .select("url,title,h1,word_count,crawl_status")
    .eq("project_id", projectId)
    .limit(5000);
  if (error) throw new Error(`Failed to load site pages: ${error.message}`);

  return (data ?? []).map((p) => ({
    url: p.url,
    headingTokens: tokenSet(`${p.title ?? ""} ${p.h1 ?? ""}`),
    slugTokens: slugTokens(p.url),
    // Not crawled yet (or failed): only the URL is known, like a sitemap-only page.
    wordCount: p.crawl_status === "crawled" ? p.word_count : null,
  }));
}

export async function loadSitePages(projectId: string, siteUrl: string): Promise<SitePage[]> {
  const pages = await loadCrawledPages(projectId);

  const crawled = new Set(pages.map((p) => p.url.replace(/\/$/, "")));
  try {
    const { urls } = await fetchSitemapUrls(siteBase(siteUrl), []);
    for (const url of urls) {
      if (crawled.has(url.replace(/\/$/, ""))) continue;
      pages.push({ url, headingTokens: new Set(), slugTokens: slugTokens(url), wordCount: null });
    }
  } catch (err) {
    logger.warn("sitemap lookup for coverage failed", { siteUrl, error: String(err) });
  }
  return pages;
}

/**
 * Only the first (primary) keyword can make a topic "covered"; the other keywords can only find a
 * partially covering page — one matching secondary keyword doesn't mean the topic has a page.
 */
export function topicCoverage(keywords: string[], pages: SitePage[]): CoverageResult {
  const thinSite = isThinSite(pages);
  let best: CoverageResult = { level: "none", pageUrl: null };
  let bestScore = 0;

  for (const [index, keyword] of keywords.entries()) {
    const kw = tokenSet(keyword);
    if (!kw.size) continue;
    for (const p of pages) {
      const score = Math.max(coverage(kw, p.headingTokens), 0.9 * coverage(kw, p.slugTokens));
      if (score <= bestScore || score < PARTIAL) continue;
      // A page about something narrower (e.g. /industries/healthcare for "ai phone answering")
      // doesn't cover a broader keyword at all.
      const narrower = [...p.slugTokens].some((t) => !GENERIC_SLUG.has(t) && !/^\d+$/.test(t) && !kw.has(t));
      if (narrower) continue;
      bestScore = score;
      // On a client-rendered site the crawl reads almost no text from any page, so word counts say nothing
      // about a page's strength: an existing blog post with a matching title or URL then covers the topic.
      // (Product and landing pages still don't: a blog post on their subject is a different page.)
      const strong = p.wordCount == null || p.wordCount >= MIN_STRONG_WORDS || (thinSite && ARTICLE_URL.test(p.url));
      best = {
        level: index === 0 && score >= COVERED && strong && !narrower ? "covered" : "partial",
        pageUrl: p.url,
      };
    }
  }
  return best;
}

/** URLs of posts and articles, as opposed to product or landing pages. */
const ARTICLE_URL = /\/(blog|news|posts?|articles?|insights|resources|guides?)\/[^/]+/i;

const thinSiteCache = new WeakMap<SitePage[], boolean>();

/** True when most crawled pages came back nearly empty (the site renders in the browser). */
function isThinSite(pages: SitePage[]): boolean {
  const cached = thinSiteCache.get(pages);
  if (cached !== undefined) return cached;
  const counts = pages.map((p) => p.wordCount).filter((n): n is number => n != null);
  const thin = counts.length >= 3 && counts.filter((n) => n < MIN_STRONG_WORDS).length / counts.length > 0.7;
  thinSiteCache.set(pages, thin);
  return thin;
}

function slugTokens(url: string): Set<string> {
  try {
    return tokenSet(decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, " "));
  } catch {
    return new Set();
  }
}
