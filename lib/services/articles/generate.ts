import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import { siteBase } from "@/lib/url";
import type { ArticleContent, ArticleEdit, ArticleEvent, ArticleRow, ContentBrief, ContentOpportunity, Project, SerpResearch } from "@/lib/types";
import { coverage, tokenSet } from "../keywords/text";
import { getProject } from "../projects";
import { autoLinkIndustries, industryLinkTargets } from "./autolink";
import { createBrief } from "./brief";
import { countWords, renderArticleHtml, slugify, wordLimits } from "./html";
import { enforceWordLimit, revise } from "./optimize";
import { refreshArticleOutputs } from "./render";
import { saveDraft } from "./repository";
import { crawlCompetitorOutlines, fetchDataSources, fetchSerpResearch } from "./research";
import { writeArticle, type SiteLink } from "./writer";

const MAX_SITE_LINKS = 30;
const FACTS_CHARS = { homepage: 1500, pricing: 1000, related: 700 };

export class ArticleError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

/**
 * Module 05: opportunity → SERP research → competitor outlines → brief → article JSON → HTML → draft.
 */
export async function generateArticle(
  projectId: string,
  opportunityId: string,
  emit: (e: ArticleEvent) => void,
): Promise<void> {
  const project = await getProject(projectId);
  if (!project) throw new ArticleError("Project not found", 404);
  if (!project.analysis) throw new ArticleError("Run the website analysis for this project first", 409);
  const opportunity = await loadOpportunity(projectId, opportunityId);
  const prepared = await prepareArticle(project, opportunity, emit);
  await writePreparedArticle(project, opportunity, prepared, emit);
}

export interface PreparedArticle {
  brief: ContentBrief;
  research: SerpResearch;
}

/** First half: Google research, competitor outlines, real-world data and the content brief. */
export async function prepareArticle(project: Project, opportunity: ContentOpportunity, emit: (e: ArticleEvent) => void): Promise<PreparedArticle> {
  if (!project.analysis) throw new ArticleError("Run the website analysis for this project first", 409);
  emit({ type: "step", step: "serp", message: "Researching Google results" });
  const serp = await fetchSerpResearch(project, opportunity.primary_keyword);
  if (!serp.organic.length) throw new ArticleError(`Google returned no results for "${opportunity.primary_keyword}"`);

  emit({ type: "step", step: "pages", message: "Reading top-ranking pages" });
  const competitorPages = await crawlCompetitorOutlines(project, serp.organic);

  emit({ type: "step", step: "data", message: "Finding real-world data and statistics" });
  const dataSources = await fetchDataSources(project, opportunity.primary_keyword);
  const research = { ...serp, competitorPages, dataSources };
  logger.info("article research", {
    keyword: opportunity.primary_keyword,
    results: serp.organic.length,
    questions: serp.peopleAlsoAsk.length,
    pagesRead: competitorPages.length,
    dataSources: dataSources.length,
    dataPoints: dataSources.reduce((n, s) => n + s.facts.length, 0),
  });

  emit({ type: "step", step: "brief", message: "Creating content brief" });
  const brief = await createBrief({ opportunity, analysis: project.analysis, research, domain: project.domain });
  return { brief, research };
}

/** Second half: write the article from a prepared brief, bring it into the word range and save the draft. */
export async function writePreparedArticle(
  project: Project,
  opportunity: ContentOpportunity,
  { brief, research }: PreparedArticle,
  emit: (e: ArticleEvent) => void,
): Promise<ArticleRow> {
  if (!project.analysis) throw new ArticleError("Run the website analysis for this project first", 409);
  const projectId = project.id;
  const dataSources = research.dataSources ?? [];

  emit({ type: "step", step: "writing", message: "Writing article" });
  const { facts, links } = await siteContext(project, brief);
  let content = await writeArticle({
    brief,
    analysis: project.analysis,
    domain: project.domain,
    businessFacts: facts,
    siteLinks: links,
    dataSources,
  });

  // Too short: deepen the thinnest sections once (never with filler; the reviser keeps the same rules).
  const { min: minWords, max: maxWords } = wordLimits();
  const written = countWords(content);
  if (written < minWords) {
    emit({ type: "step", step: "writing", message: `Expanding the draft to at least ${minWords} words (${written} so far)` });
    const edits = expansionEdits(content, minWords - written);
    if (edits.length) {
      const revisions = await revise(content, brief, edits, facts, links.map((l) => l.url));
      content = enforceWordLimit(content, edits, revisions, maxWords).content;
    }
    logger.info("article expanded", { before: written, after: countWords(content), minWords });
  }

  // Trade and industry words (slang included) link to the site's industry pages.
  const autoLinked = autoLinkIndustries(content, await industryLinkTargets(projectId, project.url));
  content = autoLinked.content;
  if (autoLinked.added) logger.info("industry links added", { added: autoLinked.added });

  emit({ type: "step", step: "saving", message: "Saving draft" });
  const siteHost = new URL(project.url).hostname;
  const article = await saveDraft({
    project_id: projectId,
    opportunity_id: opportunity.id,
    title: content.title,
    slug: slugify(content.slug || opportunity.primary_keyword),
    meta_title: content.metaTitle,
    meta_description: content.metaDescription,
    primary_keyword: opportunity.primary_keyword,
    secondary_keywords: brief.secondaryKeywords,
    brief,
    serp_research: research,
    content_json: content,
    content_html: renderArticleHtml(content, siteHost, null, dataSources.map((s) => s.url)),
    word_count: countWords(content),
  });

  // Schema, excerpt, FAQ and canonical URL for the new draft.
  const saved = await refreshArticleOutputs(projectId, article.id);

  logger.info("article draft saved", { projectId, articleId: saved.id, words: saved.word_count });
  emit({ type: "step", step: "complete", message: "Complete" });
  emit({ type: "complete", article: saved });
  return saved;
}

/** Edits that deepen the thinnest H2 sections, sharing the missing words between them (with headroom). */
function expansionEdits(content: ArticleContent, missing: number): ArticleEdit[] {
  const sectionWords = (s: ArticleContent["sections"][number]) =>
    countWords({ ...content, title: "", intro: [], sections: [s], faq: [], cta: { heading: "", text: "", buttonLabel: "", buttonUrl: "" } });
  const thinnest = content.sections
    .map((s, index) => ({ s, index, words: sectionWords(s) }))
    .filter((x) => x.s.level === 2)
    .sort((a, b) => a.words - b.words)
    .slice(0, 4);
  const each = Math.max(80, Math.round((missing * 1.2) / Math.max(1, thinnest.length)));
  return thinnest.map(({ index, words }) => ({
    target: "section" as const,
    index,
    checkIds: ["seo_length"],
    instruction:
      `Deepen this section from ~${words} to ~${words + each} words. Keep its heading, existing content and links; add what a ` +
      "reader actually needs here: a concrete example or real situation, practical steps, specifics or a short checklist. No filler or repetition.",
  }));
}

async function loadOpportunity(projectId: string, opportunityId: string): Promise<ContentOpportunity> {
  const { data, error } = await supabaseAdmin()
    .from("content_opportunities")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", opportunityId)
    .maybeSingle();
  if (error) throw new ArticleError(`Failed to load the opportunity: ${error.message}`);
  if (!data) throw new ArticleError("Content opportunity not found", 404);
  return data as ContentOpportunity;
}

/**
 * What the writer may say about the business (homepage, pricing and the most related pages,
 * straight from the crawl) and which of the site's pages it may link to.
 */
export async function siteContext(project: Project, brief: ContentBrief): Promise<{ facts: string; links: SiteLink[] }> {
  const { data, error } = await supabaseAdmin()
    .from("project_pages")
    .select("url,title,body_text,crawl_status")
    .eq("project_id", project.id)
    .eq("crawl_status", "crawled")
    .limit(1000);
  if (error) {
    logger.warn("site context unavailable", { error: errorMessage(error) });
    return { facts: project.analysis!.businessSummary, links: [{ url: project.url, title: "Homepage" }] };
  }
  const pages = (data ?? []).filter((p) => p.title) as { url: string; title: string; body_text: string | null }[];

  const topic = tokenSet([brief.primaryKeyword, ...brief.secondaryKeywords, ...brief.mustCoverTopics].join(" "));
  const scored = pages
    .map((p) => ({ ...p, score: coverage(tokenSet(`${p.title} ${p.url.replace(/[-/_]/g, " ")}`), topic) }))
    .sort((a, b) => b.score - a.score);

  const path = (p: { url: string }) => new URL(p.url).pathname.replace(/\/$/, "");
  const homePath = new URL(siteBase(project.url)).pathname.replace(/\/$/, ""); // "" or a region folder like "/au"
  const homepage = pages.find((p) => path(p) === homePath);
  // Prefer the target country's version (e.g. /nz/pricing) — pricing pages often vary by region.
  const cc = project.country.toLowerCase();
  const pricingPages = pages.filter((p) => /pricing|price|plans/.test(path(p)));
  const pricing = pricingPages.find((p) => path(p).startsWith(`/${cc}/`)) ?? pricingPages.sort((a, b) => path(a).length - path(b).length)[0];
  const related = scored.filter((p) => p !== homepage && p !== pricing && p.score > 0).slice(0, 3);

  const facts = [
    homepage && `[${homepage.url}] ${(homepage.body_text ?? "").slice(0, FACTS_CHARS.homepage)}`,
    pricing && `[${pricing.url}] ${(pricing.body_text ?? "").slice(0, FACTS_CHARS.pricing)}`,
    ...related.map((p) => `[${p.url}] ${(p.body_text ?? "").slice(0, FACTS_CHARS.related)}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  // Most related pages first, then the site's main (shortest-path) pages so there's enough to link to.
  const linkable = (p: { url: string }) => !/privacy|terms|cookie|legal|login|sign-?in|sign-?up|account|cart|checkout|\/tag\/|\/author\//i.test(path(p));
  const mainPages = scored.filter((p) => p.score === 0).sort((a, b) => path(a).length - path(b).length);
  const links = [homepage, pricing, ...scored.filter((p) => p.score > 0), ...mainPages]
    .filter((p) => !p || linkable(p))
    .filter((p): p is (typeof pages)[number] => !!p)
    .filter((p, i, all) => all.findIndex((x) => x.url === p.url) === i)
    .slice(0, MAX_SITE_LINKS)
    .map((p) => ({ url: p.url, title: p.title }));

  return { facts: facts || project.analysis!.businessSummary, links };
}
