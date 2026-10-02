import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import type { BusinessAnalysis } from "@/lib/types";
import type { KeywordIdea } from "./googleAds";
import { chunk, mapWithConcurrency, normalizeKeyword, tokens } from "./text";

export interface CandidateKeyword {
  keyword: string;
  tokens: string[];
  searchVolume: number | null;
  competition: KeywordIdea["competition"];
  competitionIndex: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
  /** 0-1: how closely the keyword matches the business vocabulary */
  relevance: number;
  /** 0-1 estimated demand when real search volume isn't available */
  demand: number | null;
  isSeed: boolean;
}

const MIN_VOLUME = 10;
const REVIEW_BATCH = 400;

/**
 * Clean Google Ads ideas: normalize, merge duplicates, drop malformed/no-volume/off-topic keywords,
 * then let Claude remove irrelevant ones and unrelated brands. Returns at most `maxKeywords`.
 */
export async function cleanKeywords(input: {
  ideas: KeywordIdea[];
  seeds: string[];
  analysis: BusinessAnalysis;
  brand: string;
  country: string;
  maxKeywords: number;
}): Promise<{ keywords: CandidateKeyword[]; removedByReview: number }> {
  const seeds = new Set(input.seeds);
  // Serper discovery has no volumes — then keep keywords regardless and rank by estimated demand.
  const hasVolume = input.ideas.some((i) => i.avgMonthlySearches != null);
  const vocab = buildVocabulary(input.seeds, input.analysis, input.brand);

  // 1. Normalize + merge duplicates (keep the entry with the highest volume).
  const merged = new Map<string, KeywordIdea>();
  for (const idea of input.ideas) {
    const k = normalizeKeyword(idea.text);
    if (!k) continue;
    const existing = merged.get(k);
    if (!existing || strength(idea) > strength(existing)) merged.set(k, idea);
  }

  // 2. Rule-based filtering.
  const candidates: CandidateKeyword[] = [];
  for (const [keyword, idea] of merged) {
    const isSeed = seeds.has(keyword);
    if (hasVolume && !isSeed && (idea.avgMonthlySearches == null || idea.avgMonthlySearches < MIN_VOLUME)) continue;

    const toks = tokens(keyword);
    if (!toks.length) continue;
    const relevance = isSeed ? 1 : scoreRelevance(keyword, toks, vocab, input.seeds);
    if (relevance === 0) continue;

    candidates.push({
      keyword,
      tokens: toks,
      searchVolume: idea.avgMonthlySearches,
      competition: idea.competition,
      competitionIndex: idea.competitionIndex,
      cpcLow: idea.lowTopOfPageBid,
      cpcHigh: idea.highTopOfPageBid,
      relevance,
      demand: idea.demand ?? null,
      isSeed,
    });
  }

  // 3. Keep the most promising ones (a margin above the cap), then AI relevance review.
  candidates.sort((a, b) => rank(b) - rank(a));
  const shortlist = candidates.slice(0, Math.round(input.maxKeywords * 1.3));
  const removed = await reviewRelevance(shortlist, input.analysis, input.brand, input.country);
  const kept = shortlist.filter((c) => c.isSeed || !removed.has(c.keyword));

  logger.info("keywords cleaned", {
    ideas: input.ideas.length,
    unique: merged.size,
    afterRules: candidates.length,
    removedByReview: shortlist.length - kept.length,
    kept: Math.min(kept.length, input.maxKeywords),
  });
  return { keywords: kept.slice(0, input.maxKeywords), removedByReview: shortlist.length - kept.length };
}

function rank(c: CandidateKeyword): number {
  if (c.searchVolume == null && c.demand != null) return c.relevance * (1 + c.demand);
  return c.relevance * Math.log10((c.searchVolume ?? 0) + 10);
}

function strength(i: KeywordIdea): number {
  return i.avgMonthlySearches ?? i.demand ?? 0;
}

/** Token → weight. Seeds matter most, then offerings/topics, then the wider business context. */
function buildVocabulary(seeds: string[], a: BusinessAnalysis, brand: string): Map<string, number> {
  const vocab = new Map<string, number>();
  const add = (texts: string[], weight: number) => {
    for (const text of texts) for (const t of tokens(text)) vocab.set(t, Math.max(vocab.get(t) ?? 0, weight));
  };
  add([a.businessSummary, a.targetCustomer], 0.3);
  add([a.businessType, ...a.likelyIndustries], 0.5);
  add([...a.mainOfferings, ...a.importantTopics], 0.8);
  add([...seeds, brand], 1);
  return vocab;
}

function scoreRelevance(keyword: string, toks: string[], vocab: Map<string, number>, seeds: string[]): number {
  const avg = toks.reduce((sum, t) => sum + (vocab.get(t) ?? 0), 0) / toks.length;
  const containsSeed = seeds.some((s) => keyword.includes(s));
  return Math.round(Math.min(1, containsSeed ? Math.max(avg, 0.85) : avg) * 1000) / 1000;
}

const reviewSchema = z.object({ removeIndexes: z.array(z.number().int()) });

/** Ask Claude which keywords to drop. On failure, keeps everything (rules already filtered). */
async function reviewRelevance(
  list: CandidateKeyword[],
  analysis: BusinessAnalysis,
  brand: string,
  country: string,
): Promise<Set<string>> {
  const removed = new Set<string>();
  const batches = chunk(list, REVIEW_BATCH);

  await mapWithConcurrency(batches, 3, async (batch) => {
    try {
      const result = await claudeJson({
        label: "keyword relevance review",
        schema: reviewSchema,
        maxTokens: 4000,
        system: [
          "You clean keyword research lists for SEO. Given a business and a numbered keyword list,",
          "return the indexes of keywords to REMOVE because they:",
          "- are about a different product or meaning that merely shares a word (e.g. 'front desk meaning')",
          "- name another company's brand or product that isn't a generic category term",
          "- are job/career/salary/course searches, unless the business is in recruitment or training",
          `- explicitly target a country other than the target country (${country}), e.g. 'usa', 'uk', 'philippines'`,
          "KEEP keywords for any industry, business type or use case this kind of product could serve,",
          "even if the business doesn't list that industry (e.g. restaurants, salons, auto repair).",
          "KEEP question keywords, cost/pricing, comparisons, 'free', 'best' and reddit/review variants.",
          `Keep keywords containing the business's own brand "${brand}".`,
          "When unsure, keep the keyword.",
        ].join("\n"),
        user: [
          `Business: ${analysis.businessType}`,
          `Offerings: ${analysis.mainOfferings.join("; ")}`,
          `Customers: ${analysis.targetCustomer}`,
          "",
          batch.map((c, i) => `${i}. ${c.keyword}`).join("\n"),
        ].join("\n"),
      });
      for (const i of result.removeIndexes) if (batch[i]) removed.add(batch[i].keyword);
    } catch (err) {
      logger.warn("keyword relevance review failed, keeping batch", { error: errorMessage(err) });
    }
  });
  return removed;
}
