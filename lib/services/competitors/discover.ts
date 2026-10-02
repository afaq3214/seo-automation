import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import type { CompetitorDiscoveryEvent, Project, SerpResult } from "@/lib/types";
import { closeBrowser } from "../crawler/render";
import { getSerp, SerperError, serperConfigured } from "../keywords/serper";
import { mapWithConcurrency } from "../keywords/text";
import { getProject, updateProject } from "../projects";
import { classifyCompetitor, type Classification } from "./classify";
import { isIgnoredDomain, rootDomain } from "./domains";
import { fetchCompetitorHomepage, type CompetitorHomepage } from "./homepage";
import { generateDiscoveryQueries } from "./queries";
import {
  competitorStats,
  getUserManagedDomains,
  listCompetitors,
  replaceSerpResults,
  saveDiscoveredCompetitors,
  type NewCompetitorRow,
  type SerpResultRow,
} from "./repository";
import { competitorScore, serpFrequencyScore } from "./scoring";

const STALE_RUN_MS = 10 * 60_000;
/** Final list keeps direct competitors above this relevance, adjacent ones above the second. */
const MIN_DIRECT_RELEVANCE = 30;
const MIN_ADJACENT_RELEVANCE = 50;
/** Unclassified competitors kept for manual review, at most. */
const MAX_PENDING_REVIEW = 3;

export class CompetitorError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

export interface DomainCandidate {
  domain: string;
  /** Best position per query the domain ranked for */
  positions: Map<string, number>;
  titles: string[];
  descriptions: string[];
}

/**
 * Module 03 pipeline: queries → Serper → repeated domains → homepages → Claude classification
 * → score → keep the top 5–10 → save. Reuses recent results unless `refresh` is true.
 */
export async function discoverCompetitors(
  projectId: string,
  options: { refresh: boolean },
  emit: (event: CompetitorDiscoveryEvent) => void,
): Promise<void> {
  const cfg = env();
  const project = await getProject(projectId);
  if (!project) throw new CompetitorError("Project not found", 404);
  if (!project.analysis) throw new CompetitorError("Run the website analysis for this project first", 409);
  if (!serperConfigured()) throw new CompetitorError("SERPER_API_KEY is not set — competitor discovery needs Serper.dev", 500);
  if (
    project.competitors_status === "running" &&
    project.competitors_started_at &&
    Date.now() - Date.parse(project.competitors_started_at) < STALE_RUN_MS
  ) {
    throw new CompetitorError("Competitor discovery is already running for this project", 409);
  }

  if (!options.refresh && isFresh(project.competitors_discovered_at, cfg.COMPETITOR_TTL_DAYS)) {
    const competitors = await listCompetitors(projectId);
    if (competitors.length) {
      emit({ type: "complete", reused: true, stats: competitorStats(competitors), competitors, warnings: [] });
      return;
    }
  }

  await updateProject(projectId, {
    competitors_status: "running",
    competitors_error: null,
    competitors_started_at: new Date().toISOString(),
  });

  try {
    const warnings = await runPipeline(project, emit);
    await updateProject(projectId, { competitors_status: "complete", competitors_discovered_at: new Date().toISOString() });
    const competitors = await listCompetitors(projectId);
    emit({ type: "step", step: "complete", message: "Complete" });
    emit({ type: "complete", reused: false, stats: competitorStats(competitors), competitors, warnings });
  } catch (err) {
    const message = errorMessage(err);
    logger.error("competitor discovery failed", { projectId, error: message });
    await updateProject(projectId, { competitors_status: "failed", competitors_error: message }).catch(() => {});
    throw err;
  } finally {
    await closeBrowser();
  }
}

async function runPipeline(project: Project, emit: (e: CompetitorDiscoveryEvent) => void): Promise<string[]> {
  const cfg = env();
  const warnings: string[] = [];

  // 1. Discovery queries
  emit({ type: "step", step: "queries", message: "Generating search queries" });
  const queries = await generateDiscoveryQueries(project, cfg.COMPETITOR_MAX_QUERIES);
  if (!queries.length) throw new CompetitorError("Could not generate discovery queries from the website analysis");
  await updateProject(project.id, { competitor_queries: queries });

  // 2. Google results (7-day cache — repeat queries cost nothing)
  emit({ type: "step", step: "searching", message: "Searching Google" });
  const serps = await mapWithConcurrency(queries, 3, async (q) => {
    try {
      return { query: q, organic: (await getSerp(q, project.country, project.language)).organic };
    } catch (err) {
      if (err instanceof SerperError && err.fatal) throw new CompetitorError(err.message);
      logger.warn("discovery search failed", { query: q, error: errorMessage(err) });
      return { query: q, organic: [] as SerpResult[] };
    }
  });
  const searched = serps.filter((s) => s.organic.length);
  if (!searched.length) throw new CompetitorError("Google returned no results for the discovery searches");
  if (searched.length < serps.length) warnings.push(`${serps.length - searched.length} discovery searches returned no results.`);

  const serpRows: SerpResultRow[] = searched.flatMap((s) =>
    s.organic.map((r) => ({
      project_id: project.id,
      query: s.query,
      position: r.position,
      domain: rootDomain(r.domain || hostOf(r.link)),
      url: r.link,
      title: r.title || null,
      description: r.snippet || null,
    })),
  );
  await replaceSerpResults(project.id, serpRows);

  // 3. Repeated domains
  emit({ type: "step", step: "domains", message: "Finding repeated domains" });
  const { removed, manual } = await getUserManagedDomains(project.id);
  const candidates = collectCandidates(searched, rootDomain(project.domain), removed, manual).slice(
    0,
    cfg.COMPETITOR_MAX_CANDIDATES,
  );
  logger.info("competitor candidates", { projectId: project.id, candidates: candidates.map((c) => c.domain) });
  if (!candidates.length) {
    throw new CompetitorError("No competitor candidates found — every result was the site itself or an ignored domain");
  }

  // 4. Homepages + classification
  emit({ type: "step", step: "analyzing", message: "Analyzing competitors" });
  const analyzed = await mapWithConcurrency(candidates, 4, async (c) => {
    const homepage = await fetchCompetitorHomepage(c.domain);
    const classification = await classifyCompetitor({
      analysis: project.analysis!,
      domain: c.domain,
      homepage,
      serpTitles: c.titles,
      serpDescriptions: c.descriptions,
      queries: [...c.positions.keys()],
    });
    return { candidate: c, homepage, classification };
  });

  const unreachable = analyzed.filter((a) => a.homepage.status === "blocked" || a.homepage.status === "failed").length;
  if (unreachable) warnings.push(`${unreachable} homepages couldn't be fetched; those were classified from Google results.`);
  const unclassified = analyzed.filter((a) => !a.classification).length;
  if (unclassified) warnings.push(`Classification failed for ${unclassified} domains; kept ones are marked pending review.`);

  // 5. Score + select
  emit({ type: "step", step: "ranking", message: "Ranking competitors" });
  const rows = analyzed.map(({ candidate, homepage, classification }) =>
    toRow(project.id, candidate, homepage, classification, searched.length, false),
  );
  const qualified = rows
    .filter(
      (r) =>
        r.status === "active" &&
        ((r.competitor_type === "direct" && (r.relevance_score ?? 0) >= MIN_DIRECT_RELEVANCE) ||
          (r.competitor_type === "adjacent" && (r.relevance_score ?? 0) >= MIN_ADJACENT_RELEVANCE)),
    )
    .sort((a, b) => b.competitor_score - a.competitor_score)
    .slice(0, cfg.COMPETITOR_MAX_FINAL);
  const pending = rows
    .filter((r) => r.status === "pending_review")
    .sort((a, b) => b.serp_appearances - a.serp_appearances)
    .slice(0, Math.min(MAX_PENDING_REVIEW, cfg.COMPETITOR_MAX_FINAL - qualified.length));

  if (!qualified.length && !pending.length) {
    warnings.push("None of the candidates looked like a direct or adjacent competitor. Try adding competitors manually.");
  }
  await saveDiscoveredCompetitors(project.id, [...qualified, ...pending]);

  logger.info("competitors saved", {
    projectId: project.id,
    queries: queries.length,
    candidates: candidates.length,
    kept: qualified.length,
    pending: pending.length,
  });
  return warnings;
}

/** Count how many queries each root domain ranked for; skip the project's own site and ignored domains. */
export function collectCandidates(
  serps: { query: string; organic: SerpResult[] }[],
  ownDomain: string,
  removed: Set<string>,
  manual: Set<string>,
): DomainCandidate[] {
  const byDomain = new Map<string, DomainCandidate>();
  for (const { query, organic } of serps) {
    for (const r of organic) {
      const host = r.domain || hostOf(r.link);
      if (!host || isIgnoredDomain(host)) continue;
      const domain = rootDomain(host);
      if (domain === ownDomain || removed.has(domain) || manual.has(domain)) continue;

      const c: DomainCandidate = byDomain.get(domain) ?? { domain, positions: new Map(), titles: [], descriptions: [] };
      const prev = c.positions.get(query);
      if (prev == null || r.position < prev) c.positions.set(query, r.position);
      if (r.title && c.titles.length < 5) c.titles.push(r.title);
      if (r.snippet && c.descriptions.length < 5) c.descriptions.push(r.snippet);
      byDomain.set(domain, c);
    }
  }
  const bestPosition = (c: DomainCandidate) => Math.min(...c.positions.values());
  return [...byDomain.values()].sort(
    (a, b) => b.positions.size - a.positions.size || bestPosition(a) - bestPosition(b),
  );
}

export function toRow(
  projectId: string,
  candidate: DomainCandidate,
  homepage: CompetitorHomepage,
  classification: Classification | null,
  totalQueries: number,
  isManual: boolean,
): NewCompetitorRow {
  const positions = [...candidate.positions.values()];
  const frequency = serpFrequencyScore(candidate.positions.size, totalQueries, positions);
  return {
    project_id: projectId,
    domain: candidate.domain,
    homepage_url: homepage.homepageUrl,
    title: homepage.title ?? candidate.titles[0] ?? null,
    meta_description: homepage.metaDescription ?? candidate.descriptions[0] ?? null,
    h1: homepage.h1,
    nav_labels: homepage.navLabels,
    homepage_status: homepage.status,
    competitor_type: classification?.type ?? null,
    relevance_score: classification?.relevanceScore ?? null,
    product_similarity: classification?.productSimilarity ?? null,
    audience_similarity: classification?.audienceSimilarity ?? null,
    serp_appearances: candidate.positions.size,
    best_position: positions.length ? Math.min(...positions) : null,
    competitor_score: competitorScore({
      relevance: classification?.relevanceScore ?? null,
      frequency,
      productSimilarity: classification?.productSimilarity ?? null,
      audienceSimilarity: classification?.audienceSimilarity ?? null,
    }),
    reason: classification?.reason ?? "Classification failed — review this competitor manually.",
    status: classification ? "active" : "pending_review",
    is_manual: isManual,
  };
}

function isFresh(at: string | null, ttlDays: number): boolean {
  return !!at && ttlDays > 0 && Date.now() - Date.parse(at) < ttlDays * 86_400_000;
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return "";
  }
}
