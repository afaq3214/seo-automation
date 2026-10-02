import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import type { AnalyzeEvent, PageSummary, Project } from "@/lib/types";
import { bareHost } from "@/lib/url";
import { analyzeBusiness } from "./businessAnalysis";
import { crawlSite } from "./crawler/crawl";
import { createProject, saveProjectPages, updateProject } from "./projects";

export interface AnalyzeProjectInput {
  /** Already normalized with normalizeInputUrl */
  url: string;
  country: string;
  language: string;
}

/**
 * Full Module 01 pipeline: create project → crawl → save pages → OpenAI analysis → save.
 * Progress is reported through `emit`; project.status mirrors it in the database.
 */
export async function analyzeProject(
  input: AnalyzeProjectInput,
  emit: (event: AnalyzeEvent) => void,
): Promise<{ project: Project; pages: PageSummary[] }> {
  emit({ type: "step", step: "creating", message: "Creating project" });
  const project = await createProject({
    url: input.url,
    domain: bareHost(input.url),
    country: input.country,
    language: input.language,
  });
  const projectId = project.id;
  logger.info("project created", { projectId, url: input.url });

  try {
    emit({ type: "step", step: "reading", message: "Reading site", projectId });
    await updateProject(projectId, { status: "crawling" });
    const crawl = await crawlSite(input.url, env().CRAWL_MAX_PAGES);
    await saveProjectPages(projectId, crawl.pages);
    await updateProject(projectId, {
      status: "analyzing",
      url: crawl.homepageUrl,
      robots_found: crawl.robots.found,
      sitemap_url: crawl.sitemapUrl,
      pages_crawled: crawl.pages.length,
    });

    emit({ type: "step", step: "analyzing", message: "Analyzing business", projectId });
    const analysis = await analyzeBusiness({
      domain: project.domain,
      country: input.country,
      language: input.language,
      pages: crawl.pages,
    });
    const saved = await updateProject(projectId, {
      status: "complete",
      error: null,
      analysis,
      analyzed_at: new Date().toISOString(),
    });

    emit({ type: "step", step: "complete", message: "Complete", projectId });
    return {
      project: saved,
      pages: crawl.pages.map((p) => ({
        url: p.url,
        title: p.title,
        wordCount: p.wordCount,
        renderedWith: p.renderedWith,
      })),
    };
  } catch (err) {
    const message = errorMessage(err);
    logger.error("project analysis failed", { projectId, error: message });
    await updateProject(projectId, { status: "failed", error: message }).catch((e) =>
      logger.error("could not mark project failed", { projectId, error: errorMessage(e) }),
    );
    throw Object.assign(new Error(message), { projectId });
  }
}
