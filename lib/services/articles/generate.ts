import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type { ArticleEvent, ContentBrief, ContentOpportunity, Project } from "@/lib/types";
import { coverage, tokenSet } from "../keywords/text";
import { getProject } from "../projects";
import { createBrief } from "./brief";
import { countWords, renderArticleHtml, slugify } from "./html";
import { refreshArticleOutputs } from "./render";
import { saveDraft } from "./repository";
import { crawlCompetitorOutlines, fetchSerpResearch } from "./research";
import { writeArticle, type SiteLink } from "./writer";

const MAX_SITE_LINKS = 15;
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

  emit({ type: "step", step: "serp", message: "Researching Google results" });
  const serp = await fetchSerpResearch(project, opportunity.primary_keyword);
  if (!serp.organic.length) throw new ArticleError(`Google returned no results for "${opportunity.primary_keyword}"`);

  emit({ type: "step", step: "pages", message: "Reading top-ranking pages" });
  const competitorPages = await crawlCompetitorOutlines(project, serp.organic);
  const research = { ...serp, competitorPages };
  logger.info("article research", {
    keyword: opportunity.primary_keyword,
    results: serp.organic.length,
    questions: serp.peopleAlsoAsk.length,
    pagesRead: competitorPages.length,
  });

  emit({ type: "step", step: "brief", message: "Creating content brief" });
  const brief = await createBrief({ opportunity, analysis: project.analysis, research, domain: project.domain });

  emit({ type: "step", step: "writing", message: "Writing article" });
  const { facts, links } = await siteContext(project, brief);
  const content = await writeArticle({
    brief,
    analysis: project.analysis,
    domain: project.domain,
    businessFacts: facts,
    siteLinks: links,
  });

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
    content_html: renderArticleHtml(content, siteHost),
    word_count: countWords(content),
  });

  // Schema, excerpt, FAQ and canonical URL for the new draft.
  const saved = await refreshArticleOutputs(projectId, article.id);

  logger.info("article draft saved", { projectId, articleId: saved.id, words: saved.word_count });
  emit({ type: "step", step: "complete", message: "Complete" });
  emit({ type: "complete", article: saved });
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
  const homepage = pages.find((p) => path(p) === "");
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

  const links = [homepage, pricing, ...scored.filter((p) => p.score > 0)]
    .filter((p): p is (typeof pages)[number] => !!p)
    .filter((p, i, all) => all.findIndex((x) => x.url === p.url) === i)
    .slice(0, MAX_SITE_LINKS)
    .map((p) => ({ url: p.url, title: p.title }));

  return { facts: facts || project.analysis!.businessSummary, links };
}
