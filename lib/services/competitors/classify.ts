import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import type { BusinessAnalysis, CompetitorType } from "@/lib/types";
import type { CompetitorHomepage } from "./homepage";

export interface Classification {
  type: CompetitorType;
  relevanceScore: number;
  productSimilarity: number;
  audienceSimilarity: number;
  reason: string;
}

const schema = z.object({
  type: z.enum(["direct", "adjacent", "publisher", "marketplace", "directory", "ugc", "irrelevant"]),
  relevanceScore: z.number().int(),
  productSimilarity: z.number().int(),
  audienceSimilarity: z.number().int(),
  reason: z.string(),
});

const SYSTEM = [
  "You classify whether a website is a business competitor of the user's business.",
  "Types:",
  "- direct: sells a very similar product or service to similar customers",
  "- adjacent: solves a similar problem with a different product/service, or targets a different segment",
  "- publisher: mainly informational content (blogs, guides, media)",
  "- marketplace: lists or sells many unrelated providers/products",
  "- directory: listing, review or comparison directory of providers",
  "- ugc: forum or user-generated content",
  "- irrelevant: not meaningfully related",
  "Scores are integers 0-100:",
  "- relevanceScore: how relevant this site is as a competitor overall",
  "- productSimilarity: how similar its product/service is to the user's",
  "- audienceSimilarity: how similar its target customers are to the user's",
  "reason: one or two sentences citing concrete evidence from the site.",
  "If the homepage content is missing, judge from the domain and the Google result titles/descriptions,",
  "and be more conservative with scores.",
].join("\n");

/**
 * Classify one candidate with Claude. Returns null on failure so the caller can save the
 * competitor as pending_review instead of failing the whole run.
 */
export async function classifyCompetitor(input: {
  analysis: BusinessAnalysis;
  domain: string;
  homepage: CompetitorHomepage;
  serpTitles: string[];
  serpDescriptions: string[];
  queries: string[];
}): Promise<Classification | null> {
  const { analysis: a, homepage: h } = input;
  const hasHomepage = h.status === "ok" || h.status === "rendered";

  try {
    const out = await claudeJson({
      label: "competitor classification",
      schema,
      maxTokens: 1000,
      system: SYSTEM,
      user: [
        "USER'S BUSINESS",
        `Type: ${a.businessType}`,
        `Summary: ${a.businessSummary}`,
        `Products/services: ${a.mainOfferings.join("; ")}`,
        `Target customers: ${a.targetCustomer}`,
        `Industries: ${a.likelyIndustries.join("; ")}`,
        "",
        "CANDIDATE WEBSITE",
        `Domain: ${input.domain}`,
        hasHomepage
          ? [
              `Homepage title: ${h.title ?? "-"}`,
              `Meta description: ${h.metaDescription ?? "-"}`,
              `H1: ${h.h1 ?? "-"}`,
              h.navLabels.length ? `Navigation: ${h.navLabels.join(" | ")}` : "",
              `Homepage text: ${h.bodyText || "-"}`,
            ].join("\n")
          : `Homepage: could not be fetched (${h.status})`,
        input.queries.length ? `Ranks on Google for: ${input.queries.join("; ")}` : "",
        input.serpTitles.length ? `Google result titles: ${input.serpTitles.slice(0, 5).join(" | ")}` : "",
        input.serpDescriptions.length
          ? `Google result descriptions: ${input.serpDescriptions.filter(Boolean).slice(0, 3).join(" | ")}`
          : "",
      ].join("\n"),
    });
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    return {
      type: out.type,
      relevanceScore: clamp(out.relevanceScore),
      productSimilarity: clamp(out.productSimilarity),
      audienceSimilarity: clamp(out.audienceSimilarity),
      reason: out.reason.trim(),
    };
  } catch (err) {
    logger.warn("competitor classification failed", { domain: input.domain, error: errorMessage(err) });
    return null;
  }
}
