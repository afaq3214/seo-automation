/**
 * Competitor score (0-100):
 *   relevance 50% · SERP frequency 30% · product/audience similarity 20%
 * SERP frequency = 70% share of discovery queries the domain ranked for + 30% how high it ranked.
 */
export function serpFrequencyScore(appearances: number, totalQueries: number, positions: number[]): number {
  if (!totalQueries || !positions.length) return 0;
  const share = Math.min(1, appearances / totalQueries);
  const positionScore = positions.reduce((s, p) => s + Math.max(0, (11 - p) / 10), 0) / positions.length;
  return Math.round(100 * (0.7 * share + 0.3 * positionScore));
}

export function competitorScore(input: {
  relevance: number | null;
  frequency: number;
  productSimilarity: number | null;
  audienceSimilarity: number | null;
}): number {
  // Unclassified (pending review): only the SERP signal is known.
  if (input.relevance == null) return Math.round(0.3 * input.frequency);
  const similarity = ((input.productSimilarity ?? 0) + (input.audienceSimilarity ?? 0)) / 2;
  const score = 0.5 * input.relevance + 0.3 * input.frequency + 0.2 * similarity;
  return Math.max(0, Math.min(100, Math.round(score)));
}
