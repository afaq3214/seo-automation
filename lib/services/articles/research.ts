import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import type { DataSource, Project, SerpResearch } from "@/lib/types";
import { isIgnoredDomain, rootDomain } from "../competitors/domains";
import { crawlPage } from "../crawler/crawl";
import { closeBrowser } from "../crawler/render";
import { FILE_EXT } from "../crawler/select";
import { getSerp } from "../keywords/serper";
import { coverage, mapWithConcurrency, tokenSet } from "../keywords/text";

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

/** Sites whose numbers aren't citable (forums, social, video, Q&A). */
const UNCITABLE = /(^|\.)(reddit|quora|youtube|facebook|instagram|tiktok|linkedin|x|twitter|pinterest|medium)\.com$/;
const MAX_DATA_SOURCES = 5;
const MAX_FACTS_PER_SOURCE = 6;

/**
 * Real-world data for the article: Google "<keyword> statistics" results, then sentences containing numbers
 * from those pages (plus the result snippets). The writer may only use numbers from this list, each cited
 * with a link to its source. 1 Serper credit unless cached; failures just mean no data.
 */
export async function fetchDataSources(project: Project, keyword: string): Promise<DataSource[]> {
  const own = rootDomain(project.domain);
  try {
    const serp = await getSerp(`${keyword} statistics`, project.country, project.language);
    const candidates = serp.organic.filter((r) => {
      try {
        const u = new URL(r.link);
        return rootDomain(u.hostname) !== own && !UNCITABLE.test(u.hostname.replace(/^www\./, "")) && !FILE_EXT.test(u.pathname);
      } catch {
        return false;
      }
    });

    const topic = tokenSet(keyword);
    const sources = await mapWithConcurrency(candidates.slice(0, MAX_DATA_SOURCES + 2), 3, async (r) => {
      let body = "";
      try {
        const { page } = await crawlPage(r.link);
        body = page?.bodyText ?? "";
      } catch (err) {
        logger.warn("data source crawl failed", { url: r.link, error: errorMessage(err) });
      }
      const facts = dataSentences(`${r.snippet ?? ""} ${body}`, topic).slice(0, MAX_FACTS_PER_SOURCE);
      return facts.length ? { url: r.link, title: r.title, facts } : null;
    });
    return sources.filter((s): s is DataSource => s !== null).slice(0, MAX_DATA_SOURCES);
  } catch (err) {
    logger.warn("data research failed", { keyword, error: errorMessage(err) });
    return [];
  } finally {
    await closeBrowser();
  }
}

/** Sentences with a statistic (percentage, "x in y", large number or multiplier), most on-topic first. */
function dataSentences(text: string, topic: Set<string>): string[] {
  const STAT = /\d+(\.\d+)?\s?%|\b\d+\s+(in|out of)\s+\d+\b|\b\d{1,3}(,\d{3})+\b|\b\d+(\.\d+)?\s?(million|billion|x|times)\b/i;
  const seen = new Set<string>();
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 300 && STAT.test(s) && !/[$€£]\s?\d/.test(s))
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)))
    .map((s) => ({ s, score: coverage(topic, tokenSet(s)) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}
