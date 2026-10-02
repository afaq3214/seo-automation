import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import type { BusinessAnalysis } from "@/lib/types";
import type { CrawledPage } from "./crawler/crawl";

// Kept free of min/max constraints: structured outputs enforce the shape, the prompt sets list sizes.
const analysisSchema = z.object({
  businessType: z.string(),
  mainOfferings: z.array(z.string()),
  targetCustomer: z.string(),
  likelyIndustries: z.array(z.string()),
  importantTopics: z.array(z.string()),
  businessSummary: z.string(),
}) satisfies z.ZodType<BusinessAnalysis>;

const MAX_SUMMARY_CHARS = 14_000;

const SYSTEM_PROMPT = [
  "You are an SEO strategist. You analyze a website's crawled content and describe the business behind it.",
  "Only use evidence from the content provided. Be specific and concise.",
  "Fields:",
  '- businessType: short label, e.g. "Local plumbing contractor" or "B2B SaaS for payroll"',
  "- mainOfferings: main services or products, at most 10",
  "- targetCustomer: who buys, one or two sentences",
  "- likelyIndustries: industries the business operates in or sells to, at most 8",
  "- importantTopics: key subjects the site covers or should rank for, at most 15",
  "- businessSummary: 2-4 sentence plain-English summary",
  "Write all values in English.",
].join("\n");

/** Compact, token-friendly text snapshot of the crawled site. Homepage gets the most room. */
export function buildSiteSummary(pages: CrawledPage[]): string {
  const parts: string[] = [];
  let total = 0;

  pages.forEach((p, i) => {
    const excerptLen = i === 0 ? 2000 : 500;
    const block = [
      `URL: ${p.url}`,
      p.title && `Title: ${p.title}`,
      p.metaDescription && `Meta: ${p.metaDescription}`,
      p.h1 && `H1: ${p.h1}`,
      p.h2s.length && `H2s: ${p.h2s.slice(0, 8).join(" | ")}`,
      p.bodyText && `Text: ${p.bodyText.slice(0, excerptLen)}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (total + block.length > MAX_SUMMARY_CHARS) return;
    parts.push(block);
    total += block.length;
  });

  return parts.join("\n\n---\n\n");
}

export async function analyzeBusiness(input: {
  domain: string;
  country: string;
  language: string;
  pages: CrawledPage[];
}): Promise<BusinessAnalysis> {
  const summary = buildSiteSummary(input.pages);
  return claudeJson({
    label: "business analysis",
    schema: analysisSchema,
    system: SYSTEM_PROMPT,
    user: `Website: ${input.domain}
Target country: ${input.country}
Content language: ${input.language}
Pages crawled: ${input.pages.length}

${summary}`,
  });
}
