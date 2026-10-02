import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import type { Project, SerpResearch } from "@/lib/types";
import { isIgnoredDomain, rootDomain } from "../competitors/domains";
import { crawlPage } from "../crawler/crawl";
import { closeBrowser } from "../crawler/render";
import { FILE_EXT } from "../crawler/select";
import { getSerp } from "../keywords/serper";
import { mapWithConcurrency } from "../keywords/text";

/** Only look at this many results when picking pages to crawl. */
const CANDIDATE_RESULTS = 8;

/** Google results + questions for the keyword (1 Serper credit unless cached). */
export async function fetchSerpResearch(project: Project, keyword: string): Promise<Omit<SerpResearch, "competitorPages">> {
  const serp = await getSerp(keyword, project.country, project.language, { withQuestions: true });
  return {
    keyword,
    organic: serp.organic.map((r) => ({ position: r.position, title: r.title, url: r.link, snippet: r.snippet ?? "" })),
    peopleAlsoAsk: serp.peopleAlsoAsk ?? [],
    relatedSearches: serp.relatedSearches ?? [],
  };
}

/**
 * Crawl a few accessible top-ranking pages for their outline (headings + length only).
 * Skips the user's own site, forums/social/directories and files. Failures are simply skipped.
 */
export async function crawlCompetitorOutlines(
  project: Project,
  organic: SerpResearch["organic"],
): Promise<SerpResearch["competitorPages"]> {
  const own = rootDomain(project.domain);
  const candidates = organic
    .filter((r) => {
      try {
        const u = new URL(r.url);
        return rootDomain(u.hostname) !== own && !isIgnoredDomain(u.hostname) && !FILE_EXT.test(u.pathname);
      } catch {
        return false;
      }
    })
    .slice(0, CANDIDATE_RESULTS);

  try {
    const results = await mapWithConcurrency(candidates, 3, async (r) => {
      try {
        const { page } = await crawlPage(r.url);
        if (!page || page.wordCount < 150) return null;
        return {
          url: page.url,
          title: page.title,
          h1: page.h1,
          h2s: page.h2s.slice(0, 20),
          h3s: page.h3s.slice(0, 25),
          wordCount: page.wordCount,
        };
      } catch (err) {
        logger.warn("competitor page crawl failed", { url: r.url, error: errorMessage(err) });
        return null;
      }
    });
    return results.filter((p): p is NonNullable<typeof p> => p !== null).slice(0, env().ARTICLE_RESEARCH_PAGES);
  } finally {
    await closeBrowser();
  }
}
