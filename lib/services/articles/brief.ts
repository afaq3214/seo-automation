import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { env } from "@/lib/env";
import type { BusinessAnalysis, ContentBrief, ContentOpportunity, SerpResearch } from "@/lib/types";

const briefSchema = z.object({
  searchIntent: z.enum(["informational", "commercial", "transactional", "navigational"]),
  targetReader: z.string(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  mustCoverTopics: z.array(z.string()),
  commonQuestions: z.array(z.string()),
  differentiatingAngles: z.array(z.string()),
  recommendedWordCount: z.number().int(),
  outline: z.object({
    h1: z.string(),
    sections: z.array(z.object({ h2: z.string(), h3s: z.array(z.string()), notes: z.string() })),
  }),
  ctaIdea: z.string(),
});

const SYSTEM = [
  "You are an SEO content strategist writing a content brief for one page.",
  "You get the target keyword, the business, today's Google top 10 (titles + snippets), 'People also ask'",
  "questions, related searches, and the heading outlines of top-ranking pages.",
  "Produce a brief that would let a writer create the most useful page for this search:",
  "- searchIntent and targetReader (who searches this and what they need)",
  "- mustCoverTopics: what the top results consistently cover (the baseline to match)",
  "- commonQuestions: real questions searchers have (prefer 'People also ask'), 5-8",
  "- differentiatingAngles: what the top results miss or do poorly that this business can add",
  "  (first-hand expertise, local specifics, pricing transparency, decision frameworks, examples)",
  "- outline: H1 plus 5-9 H2 sections with H3s where useful; notes say what each section must deliver",
  "- recommendedWordCount: roughly the competitive length, but never above the maximum given",
  "- ctaIdea: a relevant next step for this reader with this business",
  "Keep the primary keyword as given. Pick secondary keywords only from the provided list.",
  "Do not reuse competitor headings verbatim: describe topics in your own words.",
  "Do not plan tables or sections comparing named competitors' features or prices: plan category",
  "comparisons (e.g. AI vs human) or evaluation checklists instead. Do not include specific prices.",
  "Do not put an FAQ section in the outline: FAQs are generated separately from commonQuestions.",
].join("\n");

export async function createBrief(input: {
  opportunity: ContentOpportunity;
  analysis: BusinessAnalysis;
  research: SerpResearch;
  domain: string;
}): Promise<ContentBrief> {
  const { opportunity: o, analysis: a, research: r } = input;
  const maxWords = env().ARTICLE_MAX_WORDS;
  const brief = await claudeJson({
    label: "content brief",
    schema: briefSchema,
    maxTokens: 6000,
    system: SYSTEM,
    user: [
      `PRIMARY KEYWORD: ${o.primary_keyword}`,
      `Maximum article length: ${maxWords} words (plan the outline to fit: fewer, tighter sections beat padding).`,
      `Secondary keyword candidates: ${o.secondary_keywords.join("; ") || "-"}`,
      `Planned content type: ${o.content_type} · intent: ${o.search_intent}`,
      `Why this page: ${o.reason}`,
      "",
      `BUSINESS (${input.domain}): ${a.businessType}`,
      `Summary: ${a.businessSummary}`,
      `Offerings: ${a.mainOfferings.join("; ")}`,
      `Customers: ${a.targetCustomer}`,
      "",
      "GOOGLE TOP 10:",
      ...r.organic.map((x) => `#${x.position} ${x.title} — ${x.snippet}`),
      "",
      `People also ask: ${r.peopleAlsoAsk.join(" | ") || "none shown"}`,
      `Related searches: ${r.relatedSearches.join(" | ") || "none shown"}`,
      "",
      "TOP-RANKING PAGE OUTLINES:",
      ...r.competitorPages.map((p, i) =>
        [
          `Page ${i + 1} (${p.wordCount} words): ${p.title ?? p.url}`,
          `  H1: ${p.h1 ?? "-"}`,
          `  H2: ${p.h2s.join(" | ") || "-"}`,
          p.h3s.length ? `  H3: ${p.h3s.join(" | ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n"),
  });

  // Keep the chosen keywords honest.
  const allowed = new Set(o.secondary_keywords.map((k) => k.toLowerCase()));
  return {
    ...brief,
    primaryKeyword: o.primary_keyword,
    secondaryKeywords: brief.secondaryKeywords.filter((k) => allowed.has(k.toLowerCase())).slice(0, 10),
    // Aim at ~85% of the hard limit: writers tend to overshoot their target slightly.
    recommendedWordCount: Math.max(Math.min(800, maxWords), Math.min(Math.round(maxWords * 0.85), brief.recommendedWordCount)),
  };
}
