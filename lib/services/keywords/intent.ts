import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import type { SearchIntent } from "@/lib/types";
import { chunk, mapWithConcurrency } from "./text";

const NAVIGATIONAL = /\b(login|log in|sign in|signin|my account|customer portal)\b/;
const TRANSACTIONAL =
  /\b(buy|price|prices|pricing|cost|costs|cheap|cheapest|quote|quotes|hire|order|trial|demo|sign up|signup|subscribe|near me|for sale|discount|coupon|deals?|book|plans?|free)\b/;
const COMMERCIAL = /\b(best|top|vs|versus|compare|comparison|reviews?|alternatives?|rated|recommended|leading)\b/;
const INFORMATIONAL =
  /^(what|how|why|when|where|who|which|can|does|do|is|are|should|will)\b|\b(guide|tutorial|meaning|definition|define|examples?|ideas|tips|learn|course|explained|benefits|pros and cons|history|statistics|jobs?|salary|template)\b/;
/** Weaker commercial signals — only used when the keyword isn't clearly informational. */
const PROVIDER_TERMS = /\b(providers?|companies|company|software|tools?|services?|agency|agencies|platform|solutions?)\b/;

/** Rule-based intent. Returns null when the keyword gives no clear signal. */
export function ruleIntent(keyword: string, brand: string): SearchIntent | null {
  if ((brand && keyword.includes(brand)) || NAVIGATIONAL.test(keyword)) return "navigational";
  if (TRANSACTIONAL.test(keyword)) return "transactional";
  if (COMMERCIAL.test(keyword)) return "commercial";
  if (INFORMATIONAL.test(keyword)) return "informational";
  if (PROVIDER_TERMS.test(keyword)) return "commercial";
  return null;
}

const intentSchema = z.object({
  informational: z.array(z.number().int()),
  commercial: z.array(z.number().int()),
  transactional: z.array(z.number().int()),
  navigational: z.array(z.number().int()),
});

/**
 * Classify every keyword: rules first, Claude only for the unclear ones.
 * Anything Claude doesn't return defaults to "commercial" (unclear keywords are mostly product terms).
 */
export async function classifyIntents(
  keywords: string[],
  brand: string,
  businessType: string,
): Promise<Map<string, SearchIntent>> {
  const result = new Map<string, SearchIntent>();
  const unclear: string[] = [];

  for (const k of keywords) {
    const intent = ruleIntent(k, brand);
    if (intent) result.set(k, intent);
    else unclear.push(k);
  }

  await mapWithConcurrency(chunk(unclear, 300), 3, async (batch) => {
    try {
      const out = await claudeJson({
        label: "search intent",
        schema: intentSchema,
        maxTokens: 4000,
        system: [
          "Classify the search intent of each numbered keyword. Put every index in exactly one list:",
          "- informational: wants to learn or understand something",
          "- commercial: researching products/services/providers before choosing",
          "- transactional: ready to buy, sign up, hire or get a price",
          "- navigational: looking for a specific brand's website or page",
          `Context: the searches are relevant to a ${businessType}.`,
        ].join("\n"),
        user: batch.map((k, i) => `${i}. ${k}`).join("\n"),
      });
      for (const intent of ["informational", "commercial", "transactional", "navigational"] as const) {
        for (const i of out[intent]) if (batch[i] && !result.has(batch[i])) result.set(batch[i], intent);
      }
    } catch (err) {
      logger.warn("intent classification via Claude failed, defaulting batch", { error: errorMessage(err) });
    }
  });

  for (const k of unclear) if (!result.has(k)) result.set(k, "commercial");
  logger.info("intent classified", { total: keywords.length, byRules: keywords.length - unclear.length, byClaude: unclear.length });
  return result;
}
