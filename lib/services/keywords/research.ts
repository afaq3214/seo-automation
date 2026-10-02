import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import type { KeywordResearchEvent, Project, SearchIntent } from "@/lib/types";
import { getProject, updateProject } from "../projects";
import { cleanKeywords, type CandidateKeyword } from "./clean";
import { clusterKeywords, type ClusterAssignment } from "./cluster";
import { estimateDifficulty, type DifficultyResult } from "./difficulty";
import { getKeywordIdeas } from "./keywordIdeas";
import { classifyIntents } from "./intent";
import { countKeywords, keywordStats, replaceProjectKeywords, type NewKeywordRow } from "./repository";
import { buildScoringContext, opportunityScore } from "./scoring";
import { generateSeedKeywords } from "./seeds";
import { getSerp, SerperError, serperConfigured, type SerpData } from "./serper";
import { mapWithConcurrency } from "./text";

/** A run older than this is assumed dead (e.g. the serverless function timed out). */
const STALE_RUN_MS = 10 * 60_000;

export class KeywordResearchError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

interface ScoredKeyword extends CandidateKeyword {
  intent: SearchIntent;
  cluster: ClusterAssignment;
  opportunity: number;
  difficulty: DifficultyResult | null;
  difficultyStatus: NewKeywordRow["difficulty_status"];
  serp: SerpData | null;
}

/**
 * Module 02 pipeline: seeds → Google Ads ideas → clean → intent → clusters → initial scores
 * → SERP check for the best 20–50 → Estimated SEO Difficulty → final scores → save.
 * Reuses recent results unless `refresh` is true.
 */
export async function researchKeywords(
  projectId: string,
  options: { refresh: boolean },
  emit: (event: KeywordResearchEvent) => void,
): Promise<void> {
  const cfg = env();
  const project = await getProject(projectId);
  if (!project) throw new KeywordResearchError("Project not found", 404);
  if (!project.analysis) {
    throw new KeywordResearchError("Run the website analysis for this project before keyword research", 409);
  }
  if (
    project.keywords_status === "running" &&
    project.keywords_started_at &&
    Date.now() - Date.parse(project.keywords_started_at) < STALE_RUN_MS
  ) {
    throw new KeywordResearchError("Keyword research is already running for this project", 409);
  }

  // Cost control: reuse recent research unless the user explicitly refreshes.
  if (!options.refresh && isFresh(project, cfg.KEYWORD_RESEARCH_TTL_DAYS) && (await countKeywords(projectId)) > 0) {
    const { stats } = await keywordStats(projectId);
    emit({ type: "complete", reused: true, stats, warnings: [] });
    return;
  }

  await updateProject(projectId, {
    keywords_status: "running",
    keywords_error: null,
    keywords_started_at: new Date().toISOString(),
  });

  try {
    const warnings = await runPipeline(project, emit);
    const { stats } = await keywordStats(projectId);
    await updateProject(projectId, { keywords_status: "complete", keywords_researched_at: new Date().toISOString() });
    emit({ type: "step", step: "complete", message: "Complete" });
    emit({ type: "complete", reused: false, stats, warnings });
  } catch (err) {
    const message = errorMessage(err);
    logger.error("keyword research failed", { projectId, error: message });
    await updateProject(projectId, { keywords_status: "failed", keywords_error: message }).catch(() => {});
    throw err;
  }
}

async function runPipeline(project: Project, emit: (e: KeywordResearchEvent) => void): Promise<string[]> {
  const cfg = env();
  const analysis = project.analysis!;
  const brand = brandFromDomain(project.domain);
  const warnings: string[] = [];

  // 1. Seeds
  emit({ type: "step", step: "seeds", message: "Generating seed keywords" });
  const seeds = await generateSeedKeywords(project);
  await updateProject(project.id, { keyword_seeds: seeds });
  logger.info("seed keywords", { projectId: project.id, seeds });

  // 2. Google Ads keyword ideas
  emit({ type: "step", step: "ideas", message: "Getting keyword ideas" });
  const { provider, ideas } = await getKeywordIdeas({
    seeds,
    url: project.url,
    country: project.country,
    language: project.language,
  });
  if (!ideas.length) {
    throw new KeywordResearchError(
      "No keyword ideas were returned for this website. Check the country/language or try again later.",
    );
  }

  // 3. Clean, filter, intent
  emit({ type: "step", step: "processing", message: "Processing search volume" });
  const { keywords } = await cleanKeywords({
    ideas,
    seeds,
    analysis,
    brand,
    country: project.country,
    maxKeywords: cfg.KEYWORD_MAX_PER_PROJECT,
  });
  if (!keywords.length) {
    throw new KeywordResearchError("No relevant keywords with search volume were found for this website.");
  }
  const intents = await classifyIntents(
    keywords.map((k) => k.keyword),
    brand,
    analysis.businessType,
  );

  // 4. Initial opportunity (neutral difficulty) + clusters
  emit({ type: "step", step: "grouping", message: "Grouping keywords" });
  const ctx = buildScoringContext(keywords);
  const initial = keywords
    .map((k) => {
      const intent = intents.get(k.keyword) ?? "commercial";
      return { ...k, intent, opportunity: opportunityScore({ ...k, intent, difficulty: null }, ctx) };
    })
    .sort((a, b) => b.opportunity - a.opportunity);
  const clusters = await clusterKeywords(initial, analysis.businessType);

  const scored: ScoredKeyword[] = initial.map((k) => ({
    ...k,
    cluster: clusters.get(k.keyword)!,
    difficulty: null,
    difficultyStatus: "not_selected",
    serp: null,
  }));

  // 5. SERP check for the best opportunities only
  emit({ type: "step", step: "difficulty", message: "Checking SEO difficulty" });
  const selected = selectForSerpCheck(scored, cfg.SERP_CHECK_LIMIT);
  if (selected.length && !serperConfigured()) {
    warnings.push("SERPER_API_KEY is not set — Estimated SEO Difficulty is pending for the top keywords.");
    selected.forEach((k) => (k.difficultyStatus = "pending"));
  } else if (selected.length) {
    let stopReason: string | null = null;
    await mapWithConcurrency(selected, 3, async (k) => {
      if (stopReason) {
        k.difficultyStatus = "pending";
        return;
      }
      try {
        k.serp = await getSerp(k.keyword, project.country, project.language);
        k.difficulty = estimateDifficulty(k.keyword, k.serp.organic);
        k.difficultyStatus = "checked";
      } catch (err) {
        k.difficultyStatus = "pending";
        if (err instanceof SerperError && err.fatal) stopReason = err.message;
        logger.warn("serp check failed", { keyword: k.keyword, error: errorMessage(err) });
      }
    });
    const pending = selected.filter((k) => k.difficultyStatus === "pending").length;
    if (stopReason) warnings.push(`${stopReason} — Estimated SEO Difficulty is pending for ${pending} keywords.`);
    else if (pending) warnings.push(`SERP check failed for ${pending} keywords; their difficulty is pending.`);
  }

  // 6. Final scores + save
  const now = new Date().toISOString();
  const rows: NewKeywordRow[] = scored.map((k) => ({
    project_id: project.id,
    keyword: k.keyword,
    search_volume: k.searchVolume,
    competition: k.competition,
    competition_index: k.competitionIndex,
    cpc_low: k.cpcLow,
    cpc_high: k.cpcHigh,
    intent: k.intent,
    cluster_name: k.cluster.clusterName,
    is_primary_keyword: k.cluster.isPrimary,
    relevance_score: k.relevance,
    demand_score: k.demand,
    estimated_difficulty: k.difficulty?.score ?? null,
    difficulty_label: k.difficulty?.label ?? null,
    difficulty_status: k.difficultyStatus,
    opportunity_score: opportunityScore({ ...k, difficulty: k.difficulty?.score ?? null }, ctx),
    serp_top10: k.serp?.organic ?? null,
    serp_checked_at: k.serp ? now : null,
    country: project.country,
    language: project.language,
    source: provider,
  }));
  await replaceProjectKeywords(project.id, rows);

  logger.info("keyword research saved", {
    projectId: project.id,
    keywords: rows.length,
    serpChecked: selected.filter((k) => k.difficultyStatus === "checked").length,
  });
  return warnings;
}

/**
 * The best opportunities for a SERP check: cluster primaries first (one per topic), then fill
 * with the next-best keywords. Navigational keywords are skipped.
 */
function selectForSerpCheck(scored: ScoredKeyword[], limit: number): ScoredKeyword[] {
  const eligible = scored.filter((k) => k.intent !== "navigational");
  const primaries = eligible.filter((k) => k.cluster.isPrimary);
  const picked = new Set(primaries.slice(0, limit));
  for (const k of eligible) {
    if (picked.size >= limit) break;
    picked.add(k);
  }
  return [...picked];
}

function isFresh(project: Project, ttlDays: number): boolean {
  if (!project.keywords_researched_at || ttlDays <= 0) return false;
  return Date.now() - Date.parse(project.keywords_researched_at) < ttlDays * 86_400_000;
}

/** "callacy.com" → "callacy". Very short labels are ignored to avoid false brand matches. */
function brandFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? "";
  return label.length >= 4 ? label.toLowerCase() : "";
}
