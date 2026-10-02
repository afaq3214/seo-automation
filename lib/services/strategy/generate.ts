import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import type { CompetitorRanking, Project, SerpResult, StrategyEvent } from "@/lib/types";
import { rootDomain } from "../competitors/domains";
import { listCompetitors } from "../competitors/repository";
import { getSerp, SerperError, serperConfigured } from "../keywords/serper";
import { mapWithConcurrency } from "../keywords/text";
import { getProject, updateProject } from "../projects";
import { loadSitePages, topicCoverage, type CoverageResult } from "./coverage";
import { saveOpportunities, type NewOpportunity } from "./repository";
import { opportunityScore } from "./scoring";
import { buildTopics, keywordStrength, loadProjectKeywords, type Topic } from "./topics";
import { writeStrategies } from "./writer";

const STALE_RUN_MS = 10 * 60_000;
/** Keywords of a topic checked for coverage against existing pages. */
const COVERAGE_KEYWORDS = 3;

export class StrategyError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

interface Candidate {
  topic: Topic;
  coverage: CoverageResult;
  preScore: number;
  rankings: CompetitorRanking[];
  userRanks: boolean;
  checked: boolean;
}

/**
 * Module 04 pipeline: keyword topics → drop topics the site already covers → Google check of the
 * best topics for competitor rankings → keep gaps (competitors rank, the site doesn't) → score →
 * Claude writes the strategy → save to content_opportunities.
 */
export async function generateStrategy(projectId: string, emit: (e: StrategyEvent) => void): Promise<void> {
  const project = await getProject(projectId);
  if (!project) throw new StrategyError("Project not found", 404);
  if (!project.analysis) throw new StrategyError("Run the website analysis for this project first", 409);
  if (
    project.strategy_status === "running" &&
    project.strategy_started_at &&
    Date.now() - Date.parse(project.strategy_started_at) < STALE_RUN_MS
  ) {
    throw new StrategyError("The strategy is already being generated for this project", 409);
  }

  await updateProject(projectId, { strategy_status: "running", strategy_error: null, strategy_started_at: new Date().toISOString() });
  try {
    const { saved, warnings } = await runPipeline(project, emit);
    await updateProject(projectId, { strategy_status: "complete", strategy_generated_at: new Date().toISOString() });
    emit({ type: "step", step: "complete", message: "Complete" });
    emit({ type: "complete", opportunities: saved, warnings });
  } catch (err) {
    const message = errorMessage(err);
    logger.error("strategy generation failed", { projectId, error: message });
    await updateProject(projectId, { strategy_status: "failed", strategy_error: message }).catch(() => {});
    throw err;
  }
}

async function runPipeline(project: Project, emit: (e: StrategyEvent) => void) {
  const cfg = env();
  const warnings: string[] = [];

  // 1. Inputs from Modules 01–03
  emit({ type: "step", step: "loading", message: "Loading keywords & competitors" });
  const [keywords, competitors, pages] = await Promise.all([
    loadProjectKeywords(project.id),
    listCompetitors(project.id),
    loadSitePages(project.id, project.url),
  ]);
  if (!keywords.length) throw new StrategyError("Run keyword research for this project first", 409);
  const competitorDomains = new Set(
    competitors.filter((c) => c.status === "active").map((c) => rootDomain(c.domain)),
  );
  if (!competitorDomains.size) throw new StrategyError("Run competitor discovery for this project first", 409);
  const ownDomain = rootDomain(project.domain);

  // 2. Topics the site doesn't already cover with a strong page
  emit({ type: "step", step: "coverage", message: "Checking existing pages" });
  const topics = buildTopics(keywords).filter((t) => t.intent !== "navigational");
  const maxStrength = Math.max(0, ...topics.map(topicVolume));
  let covered = 0;
  const candidates: Candidate[] = [];
  for (const topic of topics) {
    const coverage = topicCoverage(
      topic.members.slice(0, COVERAGE_KEYWORDS).map((m) => m.keyword),
      pages,
    );
    if (coverage.level === "covered") {
      covered++;
      continue;
    }
    candidates.push({
      topic,
      coverage,
      // Before the Google check the gap is unknown — assume one competitor.
      preScore: score(topic, coverage, 1, maxStrength),
      rankings: [],
      userRanks: false,
      checked: false,
    });
  }
  logger.info("strategy topics", { projectId: project.id, topics: topics.length, coveredByExistingPages: covered });

  // 3. Competitor rankings for the best topics (saved Module 02 SERPs first, then Serper's 7-day cache)
  emit({ type: "step", step: "rankings", message: "Checking competitor rankings" });
  const toCheck = candidates.sort((a, b) => b.preScore - a.preScore).slice(0, cfg.STRATEGY_MAX_TOPICS);
  let stopReason: string | null = null;
  await mapWithConcurrency(toCheck, 3, async (c) => {
    const saved = c.topic.members.find((m) => m.serp_top10?.length)?.serp_top10 ?? null;
    let organic: SerpResult[] | null = saved;
    if (!organic && !stopReason && serperConfigured()) {
      try {
        organic = (await getSerp(c.topic.primary.keyword, project.country, project.language)).organic;
      } catch (err) {
        if (err instanceof SerperError && err.fatal) stopReason = err.message;
        logger.warn("strategy serp check failed", { keyword: c.topic.primary.keyword, error: errorMessage(err) });
      }
    }
    if (!organic) return;
    c.checked = true;
    c.userRanks = organic.some((r) => rootDomain(r.domain) === ownDomain);
    c.rankings = competitorRankings(organic, competitorDomains);
  });
  if (stopReason) warnings.push(`${stopReason} — some topics couldn't be checked against competitor rankings.`);

  // 4. Gaps: competitors rank, the site doesn't
  emit({ type: "step", step: "scoring", message: "Scoring opportunities" });
  const gaps = toCheck
    .filter((c) => c.checked && !c.userRanks && c.rankings.length > 0)
    .map((c) => ({ ...c, finalScore: score(c.topic, c.coverage, c.rankings.length, maxStrength) }))
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, cfg.STRATEGY_MAX_OPPORTUNITIES);
  const alreadyRanking = toCheck.filter((c) => c.userRanks).length;
  if (alreadyRanking) warnings.push(`${alreadyRanking} checked topics were skipped because the site already ranks for them.`);
  if (!gaps.length) {
    warnings.push("No gaps found: competitors don't rank for the top uncovered topics. Try refreshing competitor discovery.");
    await saveOpportunities(project.id, []);
    return { saved: 0, warnings };
  }

  // 5. Strategy per opportunity
  emit({ type: "step", step: "writing", message: "Writing strategy" });
  const strategies = await writeStrategies(
    project.analysis!,
    gaps.map((g) => ({ topic: g.topic, rankings: g.rankings, existingPageUrl: g.coverage.pageUrl })),
  );

  const rows: NewOpportunity[] = gaps.map((g, i) => {
    const s = strategies[i];
    const volumes = g.topic.members.map((m) => m.search_volume).filter((v): v is number => v != null);
    const demand = g.topic.members.reduce((sum, m) => sum + (m.demand_score ?? 0), 0);
    const difficulties = g.topic.members.map((m) => m.estimated_difficulty).filter((d): d is number => d != null);
    return {
      project_id: project.id,
      topic: s.topic,
      primary_keyword: s.primaryKeyword,
      secondary_keywords: s.secondaryKeywords,
      content_type: s.contentType,
      search_intent: s.searchIntent,
      reason: s.reason,
      opportunity_score: g.finalScore,
      relevance_score: Math.max(...g.topic.members.map((m) => m.relevance_score)),
      search_volume: volumes.length ? volumes.reduce((a, b) => a + b, 0) : null,
      demand_score: volumes.length ? null : Math.round(demand * 1000) / 1000,
      estimated_difficulty: difficulties.length ? Math.min(...difficulties) : null,
      competitor_count: g.rankings.length,
      competitor_rankings: g.rankings,
      existing_page_url: g.coverage.pageUrl,
      coverage: g.coverage.level === "partial" ? "partial" : "none",
    };
  });

  // Two topics can end up with the same primary keyword — keep the higher-scoring one.
  const seen = new Set<string>();
  const unique = rows.filter((r) => !seen.has(r.primary_keyword) && seen.add(r.primary_keyword));
  await saveOpportunities(project.id, unique);
  logger.info("strategy saved", { projectId: project.id, checked: toCheck.length, gaps: gaps.length, saved: unique.length });
  return { saved: unique.length, warnings };
}

function topicVolume(t: Topic): number {
  return t.members.reduce((sum, m) => sum + keywordStrength(m), 0);
}

function score(topic: Topic, coverage: CoverageResult, competitorCount: number, maxVolume: number): number {
  const difficulties = topic.members.map((m) => m.estimated_difficulty).filter((d): d is number => d != null);
  return opportunityScore({
    relevance: Math.max(...topic.members.map((m) => m.relevance_score)),
    volume: topicVolume(topic),
    maxVolume,
    difficulty: difficulties.length ? Math.min(...difficulties) : null,
    intent: topic.intent,
    competitorCount,
    partialCoverage: coverage.level === "partial",
  });
}

/** Best position per competitor domain in a top-10 result list. */
function competitorRankings(organic: SerpResult[], competitors: Set<string>): CompetitorRanking[] {
  const best = new Map<string, CompetitorRanking>();
  for (const r of organic) {
    const domain = rootDomain(r.domain);
    if (!competitors.has(domain)) continue;
    const prev = best.get(domain);
    if (!prev || r.position < prev.position) best.set(domain, { domain, position: r.position, url: r.link, title: r.title });
  }
  return [...best.values()].sort((a, b) => a.position - b.position);
}
