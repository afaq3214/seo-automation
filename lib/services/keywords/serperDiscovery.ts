import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import type { KeywordIdea } from "./googleAds";
import { getAutocomplete, SerperError } from "./serper";
import { mapWithConcurrency, normalizeKeyword } from "./text";

/**
 * Keyword discovery from Google autocomplete via Serper — no search volume or CPC.
 * Each keyword gets an estimated demand score (0-1) instead:
 *   Google lists the most-searched completions first, so a keyword that appears high up,
 *   and for several different queries, is likely searched more.
 */

/** Query templates per seed. The plain seed counts most; variations add long-tail ideas. */
const TEMPLATES: { make: (seed: string) => string; weight: number }[] = [
  { make: (s) => s, weight: 1 },
  { make: (s) => `${s} for`, weight: 0.7 },
  { make: (s) => `best ${s}`, weight: 0.7 },
  { make: (s) => `${s} vs`, weight: 0.6 },
  { make: (s) => `what is ${s}`, weight: 0.6 },
  { make: (s) => `${s} cost`, weight: 0.6 },
];
/** Second round: plain autocomplete on the strongest discovered keywords. */
const SECOND_ROUND_WEIGHT = 0.5;
const SECOND_ROUND_SHARE = 0.25;

export async function generateKeywordIdeasSerper(input: {
  seeds: string[];
  country: string;
  language: string;
}): Promise<KeywordIdea[]> {
  const budget = env().SERPER_DISCOVERY_MAX_QUERIES;
  const demand = new Map<string, number>();
  let failures = 0;

  const run = async (queries: { q: string; weight: number }[]) => {
    await mapWithConcurrency(queries, 4, async ({ q, weight }) => {
      try {
        const suggestions = await getAutocomplete(q, input.country, input.language);
        suggestions.forEach((s, i) => {
          const k = normalizeKeyword(s);
          if (!k) return;
          const positionWeight = Math.max(0.3, 1 - i * 0.07);
          demand.set(k, (demand.get(k) ?? 0) + weight * positionWeight);
        });
      } catch (err) {
        if (err instanceof SerperError && err.fatal) throw err;
        failures++;
        logger.warn("autocomplete failed", { query: q, error: errorMessage(err) });
      }
    });
  };

  // Round 1: templates × seeds, most important template first, within ~75% of the budget.
  const round1Budget = Math.max(input.seeds.length, Math.floor(budget * (1 - SECOND_ROUND_SHARE)));
  const round1 = TEMPLATES.flatMap((t) => input.seeds.map((s) => ({ q: t.make(s), weight: t.weight }))).slice(
    0,
    round1Budget,
  );
  await run(round1);

  // Round 2: expand the strongest new keywords (not already queried).
  const queried = new Set(round1.map((r) => r.q));
  const round2 = [...demand.entries()]
    .filter(([k]) => !queried.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, budget - round1.length))
    .map(([k]) => ({ q: k, weight: SECOND_ROUND_WEIGHT }));
  await run(round2);

  // Seeds always count as ideas, even if autocomplete never echoed them.
  for (const s of input.seeds) if (!demand.has(s)) demand.set(s, 0.4);

  logger.info("serper keyword discovery", {
    seeds: input.seeds.length,
    queries: round1.length + round2.length,
    failures,
    ideas: demand.size,
  });

  // Relative scale: the project's strongest keyword = 1; square root spreads out the long tail.
  const maxRaw = Math.max(...demand.values(), 0.0001);
  return [...demand.entries()].map(([text, raw]) => ({
    text,
    avgMonthlySearches: null,
    competition: null,
    competitionIndex: null,
    lowTopOfPageBid: null,
    highTopOfPageBid: null,
    demand: Math.round(Math.sqrt(raw / maxRaw) * 1000) / 1000,
  }));
}
