import type { SearchIntent } from "@/lib/types";

/**
 * Content opportunity score (0-100):
 *   relevance 25 · search volume/demand 20 · difficulty 20 · commercial intent 15 · competitor gap 20
 * Volume is log-scaled against the biggest topic in this run. Unchecked difficulty counts as 50.
 * Gap: 3+ competitors in the top 10 = full points; a partially covering page on the user's site
 * reduces the gap (an existing page could be expanded instead).
 */
const WEIGHTS = { relevance: 25, volume: 20, difficulty: 20, intent: 15, gap: 20 };

const INTENT_VALUE: Record<SearchIntent, number> = {
  transactional: 1,
  commercial: 0.9,
  informational: 0.6,
  navigational: 0.1,
};

export function opportunityScore(input: {
  relevance: number; // 0-1
  volume: number; // topic volume (or demand × 100)
  maxVolume: number;
  difficulty: number | null;
  intent: SearchIntent;
  competitorCount: number;
  partialCoverage: boolean;
}): number {
  const volume = input.maxVolume > 0 ? Math.log1p(input.volume) / Math.log1p(input.maxVolume) : 0;
  const ease = 1 - (input.difficulty ?? 50) / 100;
  const gap = Math.min(1, input.competitorCount / 3) * (input.partialCoverage ? 0.7 : 1);

  const score =
    WEIGHTS.relevance * input.relevance +
    WEIGHTS.volume * volume +
    WEIGHTS.difficulty * ease +
    WEIGHTS.intent * INTENT_VALUE[input.intent] +
    WEIGHTS.gap * gap;
  return Math.max(0, Math.min(100, Math.round(score)));
}
