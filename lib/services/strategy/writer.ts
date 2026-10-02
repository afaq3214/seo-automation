import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import type { BusinessAnalysis, CompetitorRanking, ContentType, SearchIntent } from "@/lib/types";
import { chunk, mapWithConcurrency } from "../keywords/text";
import { keywordStrength, type Topic } from "./topics";

export interface StrategyInput {
  topic: Topic;
  rankings: CompetitorRanking[];
  existingPageUrl: string | null;
}

export interface StrategyOutput {
  topic: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  contentType: ContentType;
  searchIntent: SearchIntent;
  reason: string;
}

const CONTENT_TYPES = ["blog_post", "guide", "comparison", "listicle", "landing_page", "faq"] as const;
const INTENTS = ["informational", "commercial", "transactional", "navigational"] as const;
const MAX_SECONDARY = 8;
const BATCH = 8;

const schema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      topic: z.string(),
      primaryKeyword: z.string(),
      secondaryKeywords: z.array(z.string()),
      contentType: z.enum(CONTENT_TYPES),
      searchIntent: z.enum(INTENTS),
      reason: z.string(),
    }),
  ),
});

const SYSTEM = [
  "You are an SEO strategist planning new content for a business website.",
  "For each numbered topic you get its keyword group, the competitor pages ranking for it and,",
  "if any, the user's existing page that only partially covers it. Return for every topic:",
  "- topic: a specific, compelling title for the page to create (not clickbait)",
  "- primaryKeyword: the best keyword to target, copied exactly from the topic's keyword list",
  `- secondaryKeywords: up to ${MAX_SECONDARY} supporting keywords, copied exactly from the same list`,
  "- contentType: landing_page for commercial/transactional service or industry searches;",
  "  comparison for 'best', 'vs', 'alternative' searches; guide for how-to/what-is; listicle for",
  "  lists/ideas; faq for question clusters; blog_post otherwise",
  "- searchIntent: informational | commercial | transactional | navigational",
  "- reason: 1-2 sentences on why this is worth creating, citing the competitor gap and demand",
  "Write in the language of the keywords.",
].join("\n");

/** Claude writes the strategy per topic; any topic it fails on gets a rule-based fallback. */
export async function writeStrategies(analysis: BusinessAnalysis, inputs: StrategyInput[]): Promise<StrategyOutput[]> {
  const results: (StrategyOutput | null)[] = inputs.map(() => null);

  await mapWithConcurrency(chunk(inputs.map((input, i) => ({ input, i })), BATCH), 3, async (batch) => {
    try {
      const out = await claudeJson({
        label: "content strategy",
        schema,
        maxTokens: 6000,
        system: SYSTEM,
        user: [
          `Business: ${analysis.businessType}`,
          `Offerings: ${analysis.mainOfferings.join("; ")}`,
          `Customers: ${analysis.targetCustomer}`,
          "",
          ...batch.map(({ input }, n) => describe(n, input)),
        ].join("\n"),
      });
      for (const item of out.items) {
        const entry = batch[item.index];
        if (entry) results[entry.i] = sanitize(item, entry.input);
      }
    } catch (err) {
      logger.warn("strategy writing failed for a batch, using fallback", { error: errorMessage(err) });
    }
  });

  return results.map((r, i) => r ?? fallback(inputs[i]));
}

function describe(n: number, { topic, rankings, existingPageUrl }: StrategyInput): string {
  const keywords = topic.members
    .slice(0, 20)
    .map((k) => `${k.keyword} [${k.intent}${k.search_volume != null ? `, ${k.search_volume}/mo` : ""}]`)
    .join("; ");
  const competitors = rankings.map((r) => `#${r.position} ${r.domain} "${r.title}"`).join("; ");
  return [
    `TOPIC ${n}`,
    `Keywords: ${keywords}`,
    `Competitors ranking: ${competitors || "none found"}`,
    existingPageUrl ? `User's partially covering page: ${existingPageUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Keep Claude to the topic's real keywords; fall back to the strongest ones. */
function sanitize(item: z.infer<typeof schema>["items"][number], input: StrategyInput): StrategyOutput {
  const byText = new Map(input.topic.members.map((m) => [m.keyword.toLowerCase(), m.keyword]));
  const primary = byText.get(item.primaryKeyword.trim().toLowerCase()) ?? input.topic.primary.keyword;
  const secondary = [
    ...new Set(item.secondaryKeywords.map((k) => byText.get(k.trim().toLowerCase())).filter((k): k is string => !!k)),
  ]
    .filter((k) => k !== primary)
    .slice(0, MAX_SECONDARY);
  return {
    topic: item.topic.trim() || primary,
    primaryKeyword: primary,
    secondaryKeywords: secondary.length ? secondary : defaultSecondary(input, primary),
    contentType: item.contentType,
    searchIntent: item.searchIntent,
    reason: item.reason.trim(),
  };
}

function fallback(input: StrategyInput): StrategyOutput {
  const primary = input.topic.primary.keyword;
  const k = primary.toLowerCase();
  const contentType: ContentType = /\b(best|top|vs|versus|alternative|compare)\b/.test(k)
    ? "comparison"
    : /^(what|how|why|when|can|does|is)\b/.test(k)
      ? "guide"
      : input.topic.intent === "commercial" || input.topic.intent === "transactional"
        ? "landing_page"
        : "blog_post";
  const names = input.rankings.slice(0, 3).map((r) => r.domain);
  return {
    topic: primary.replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
    primaryKeyword: primary,
    secondaryKeywords: defaultSecondary(input, primary),
    contentType,
    searchIntent: input.topic.intent,
    reason: names.length
      ? `${names.join(", ")} rank for this topic and the site has no dedicated page for it yet.`
      : "The site has no dedicated page for this topic yet.",
  };
}

function defaultSecondary(input: StrategyInput, primary: string): string[] {
  return [...input.topic.members]
    .sort((a, b) => keywordStrength(b) - keywordStrength(a))
    .map((m) => m.keyword)
    .filter((k) => k !== primary)
    .slice(0, MAX_SECONDARY);
}
