import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { env } from "@/lib/env";
import type { ArticleBlock, ArticleContent, BusinessAnalysis, ContentBrief } from "@/lib/types";

// One flat block shape keeps the JSON schema simple; it's narrowed into ArticleBlock afterwards.
export const blockSchema = z.object({
  type: z.enum(["paragraph", "list", "table", "callout"]),
  text: z.string().optional(),
  ordered: z.boolean().optional(),
  items: z.array(z.string()).optional(),
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
});

export const articleSchema = z.object({
  title: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  slug: z.string(),
  intro: z.array(z.string()),
  sections: z.array(z.object({ heading: z.string(), level: z.number().int(), blocks: z.array(blockSchema) })),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  cta: z.object({ heading: z.string(), text: z.string(), buttonLabel: z.string(), buttonUrl: z.string() }),
});

export interface SiteLink {
  url: string;
  title: string;
}

const SYSTEM = [
  "You are an expert content writer. Write an original, genuinely useful article from the content brief.",
  "",
  "Quality rules:",
  "- Follow the brief's outline, intent and reader. Answer the search query early (first 2-3 sentences).",
  "- Short paragraphs (1-3 sentences). Clear, specific, practical. Concrete examples and scenarios.",
  "- Use lists for steps/options. Use a table ONLY where it genuinely helps (comparisons, pricing factors, checklists).",
  "- Use callouts sparingly for key tips or warnings.",
  "- Write in your own words. Never copy or closely paraphrase competitor wording.",
  "- Facts: only state facts about the business that appear in the provided business facts. Do not invent",
  "  features, statistics, customer names, testimonials or awards. When unsure, don't state it.",
  "- Never state specific prices, plan names or discounts — not for this business and not for anyone else.",
  "  Explain pricing models in general terms and link to the business's pricing page instead.",
  "- Other companies: never attribute specific features, prices, limitations, availability or ratings to a",
  "  named third-party company, and never build a table comparing named companies. Compare categories",
  "  (e.g. AI vs human services) or give an evaluation checklist instead. Naming a few providers neutrally",
  "  as examples is fine.",
  "- Do not add an FAQ section to 'sections' — FAQs go only in the 'faq' field.",
  "- Mention the business naturally where it genuinely helps the reader — not in every section.",
  "- Use the primary keyword in the title, the intro and at least one H2; use secondary keywords naturally.",
  "",
  "Formatting inside text: **bold** for emphasis, and [anchor text](url) links — ONLY to URLs from the",
  "provided site pages list (2-5 internal links where relevant). No other markup, no HTML, no headings in text.",
  "",
  "Output fields:",
  "- title: the H1 · metaTitle: max 60 characters · metaDescription: max 155 characters, compelling",
  "- slug: lowercase-hyphenated, based on the primary keyword",
  "- intro: 2-4 short paragraphs before the first heading",
  "- sections: heading + level (2 for H2, 3 for H3 under the preceding H2) + blocks",
  "  block types: paragraph{text} · list{ordered, items} · table{headers, rows} · callout{text}",
  "- faq: 4-6 questions from the brief with concise answers (2-4 sentences)",
  "- cta: heading, text, buttonLabel, buttonUrl (choose from the site pages list)",
].join("\n");

export async function writeArticle(input: {
  brief: ContentBrief;
  analysis: BusinessAnalysis;
  domain: string;
  businessFacts: string;
  siteLinks: SiteLink[];
}): Promise<ArticleContent> {
  const { brief: b, analysis: a } = input;
  const raw = await claudeJson({
    label: "article",
    schema: articleSchema,
    // ~1.7 tokens per word of article JSON, plus headroom.
    maxTokens: Math.min(16000, Math.round(env().ARTICLE_MAX_WORDS * 2.2) + 1500),
    system: SYSTEM,
    user: [
      "CONTENT BRIEF",
      JSON.stringify(b, null, 2),
      "",
      `BUSINESS: ${input.domain} — ${a.businessType}`,
      `Summary: ${a.businessSummary}`,
      `Offerings: ${a.mainOfferings.join("; ")}`,
      `Customers: ${a.targetCustomer}`,
      "",
      "BUSINESS FACTS (from the business's own website — the only facts you may state about it):",
      input.businessFacts,
      "",
      "SITE PAGES YOU MAY LINK TO:",
      ...input.siteLinks.map((l) => `- ${l.title}: ${l.url}`),
      "",
      `Target length: about ${b.recommendedWordCount} words. HARD LIMIT: no more than ${env().ARTICLE_MAX_WORDS} words in total,`,
      "counting intro, sections, FAQ and CTA. Cover the outline concisely rather than exceeding the limit.",
    ].join("\n"),
  });
  return normalizeArticle(raw);
}

/** Narrow the flat blocks into typed blocks and drop anything malformed. */
export function normalizeArticle(raw: z.infer<typeof articleSchema>): ArticleContent {
  const blocks = (list: z.infer<typeof blockSchema>[]): ArticleBlock[] =>
    list.flatMap((bl): ArticleBlock[] => {
      if (bl.type === "paragraph" && bl.text?.trim()) return [{ type: "paragraph", text: bl.text.trim() }];
      if (bl.type === "callout" && bl.text?.trim()) return [{ type: "callout", text: bl.text.trim() }];
      if (bl.type === "list" && bl.items?.length) return [{ type: "list", ordered: !!bl.ordered, items: bl.items }];
      if (bl.type === "table" && bl.headers?.length && bl.rows?.length) {
        const width = bl.headers.length;
        return [{ type: "table", headers: bl.headers, rows: bl.rows.map((r) => r.slice(0, width)) }];
      }
      return [];
    });

  // FAQs live in `faq`; drop FAQ sections and headings left without content.
  const sections = raw.sections
    .map((s) => ({ heading: s.heading.trim(), level: (s.level === 3 ? 3 : 2) as 2 | 3, blocks: blocks(s.blocks) }))
    .filter((s) => s.heading && !/^(faqs?|frequently asked questions?)/i.test(s.heading))
    .filter((s, i, all) => s.blocks.length > 0 || (s.level === 2 && all[i + 1]?.level === 3));

  return {
    title: raw.title.trim(),
    metaTitle: raw.metaTitle.trim().slice(0, 70),
    metaDescription: raw.metaDescription.trim().slice(0, 170),
    slug: raw.slug,
    intro: raw.intro.filter((p) => p.trim()),
    sections,
    faq: raw.faq.filter((f) => f.question.trim() && f.answer.trim()),
    cta: raw.cta,
  };
}
