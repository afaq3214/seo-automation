import type { DifficultyLabel, SearchIntent } from "@/lib/types";

/**
 * SEO Keyword Opportunity Score (0-100):
 *   search volume 30 · estimated difficulty 25 · relevance 20 · intent 15 · CPC value 10
 * Volume is log-scaled against the project's biggest keyword; CPC is ranked within the project.
 * Without a SERP check, difficulty counts as neutral (50). Without search volume (Serper discovery),
 * the estimated demand score (0-1) is used for the volume component.
 */
const WEIGHTS = { volume: 30, difficulty: 25, relevance: 20, intent: 15, cpc: 10 };
const NEUTRAL_DIFFICULTY = 50;

const INTENT_VALUE: Record<SearchIntent, number> = {
  transactional: 1,
  commercial: 0.9,
  informational: 0.55,
  navigational: 0.15,
};

export interface ScoringContext {
  maxVolume: number;
  sortedCpcs: number[];
}

export function buildScoringContext(items: { searchVolume: number | null; cpcHigh: number | null }[]): ScoringContext {
  return {
    maxVolume: Math.max(0, ...items.map((i) => i.searchVolume ?? 0)),
    sortedCpcs: items
      .map((i) => i.cpcHigh)
      .filter((c): c is number => c != null && c > 0)
      .sort((a, b) => a - b),
  };
}

export function opportunityScore(
  k: {
    searchVolume: number | null;
    demand: number | null;
    cpcHigh: number | null;
    relevance: number;
    intent: SearchIntent;
    difficulty: number | null;
  },
  ctx: ScoringContext,
): number {
  const volume =
    k.searchVolume == null && k.demand != null
      ? k.demand
      : ctx.maxVolume > 0
        ? Math.log10((k.searchVolume ?? 0) + 1) / Math.log10(ctx.maxVolume + 1)
        : 0;
  const ease = 1 - (k.difficulty ?? NEUTRAL_DIFFICULTY) / 100;
  const cpc = cpcPercentile(k.cpcHigh, ctx.sortedCpcs);

  const score =
    WEIGHTS.volume * volume +
    WEIGHTS.difficulty * ease +
    WEIGHTS.relevance * k.relevance +
    WEIGHTS.intent * INTENT_VALUE[k.intent] +
    WEIGHTS.cpc * cpc;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function cpcPercentile(cpc: number | null, sorted: number[]): number {
  if (cpc == null || cpc <= 0 || !sorted.length) return 0.3;
  let below = 0;
  while (below < sorted.length && sorted[below] <= cpc) below++;
  return below / sorted.length;
}

export function difficultyLabel(score: number): DifficultyLabel {
  if (score <= 30) return "Easy";
  if (score <= 60) return "Medium";
  if (score <= 80) return "Hard";
  return "Very Hard";
}
