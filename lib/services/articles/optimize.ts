import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type {
  ArticleContent,
  ArticleEdit,
  ArticleMetrics,
  ArticleRow,
  CheckResult,
  ContentBrief,
  OptimizationReport,
  OptimizeEvent,
} from "@/lib/types";
import { getProject } from "../projects";
import { CHECKS, CHECK_IDS, measureArticle, pillarScores } from "./checks";
import { ArticleError, siteContext } from "./generate";
import { countWords, renderArticleHtml, wordLimits } from "./html";
import { refreshArticleOutputs, sourceUrlsOf } from "./render";
import { getArticle } from "./repository";
import { dateContext, HUMAN_VOICE, stripArticleDashes } from "./style";
import { blockSchema, normalizeArticle } from "./writer";

const MAX_EDITS = 8;

export const DISCLAIMER =
  "These checks follow common SEO, GEO and AEO best practices. They make the article clearer and easier to " +
  "quote, but they do not guarantee rankings or inclusion in AI-generated answers (such as Google AI Overviews, " +
  "ChatGPT or Perplexity).";

/**
 * Module 06: measure → audit (grade 18 checks + plan targeted edits) → revise only the weak parts →
 * apply the patches (everything else stays byte-for-byte) → re-measure + re-audit → save.
 * Always starts from the original draft, so re-running never compounds earlier rewrites.
 */
export async function optimizeArticle(projectId: string, articleId: string, emit: (e: OptimizeEvent) => void) {
  const article = await getArticle(projectId, articleId);
  if (!article) throw new ArticleError("Article not found", 404);
  const project = await getProject(projectId);
  if (!project?.analysis) throw new ArticleError("Project analysis not found", 409);
  const original = article.content_json;
  const { brief } = article;

  emit({ type: "step", step: "measuring", message: "Measuring the draft" });
  const metricsBefore = measureArticle(original, article.primary_keyword, article.secondary_keywords, new URL(project.url).hostname);

  emit({ type: "step", step: "auditing", message: "Auditing SEO, GEO & AEO" });
  const before = await audit(original, brief, metricsBefore, article, true);

  let optimized = original;
  let applied = 0;
  if (before.edits.length) {
    emit({ type: "step", step: "revising", message: `Revising ${before.edits.length} weak parts` });
    const { facts, links } = await siteContext(project, brief);
    const revisions = await revise(original, brief, before.edits, facts, links.map((l) => l.url));
    const limited = enforceWordLimit(original, before.edits, revisions, wordLimits().max, wordLimits().min);
    optimized = limited.content;
    applied = limited.applied;
  }

  emit({ type: "step", step: "rechecking", message: "Re-checking the result" });
  const metricsAfter = measureArticle(optimized, article.primary_keyword, article.secondary_keywords, new URL(project.url).hostname);
  // Unchanged article → keep the original grades (a second audit would only add grading noise).
  const after = applied > 0 ? await audit(optimized, brief, metricsAfter, article, false) : before;

  emit({ type: "step", step: "saving", message: "Saving optimized version" });
  const report: OptimizationReport = {
    checksBefore: before.checks,
    checksAfter: after.checks,
    scoresBefore: pillarScores(before.checks),
    scoresAfter: pillarScores(after.checks),
    metricsBefore,
    metricsAfter,
    edits: before.edits,
    appliedEdits: applied,
    note: !before.edits.length
      ? "No weak parts found — nothing was changed."
      : applied === 0
        ? "No revisions applied — the article is already at the word limit and every revision would have made it longer."
        : applied < before.edits.length
          ? `${before.edits.length - applied} planned revision(s) were skipped to stay within the ${env().ARTICLE_MAX_WORDS}-word limit.`
          : undefined,
    disclaimer: DISCLAIMER,
  };
  const siteHost = new URL(project.url).hostname;
  const { error } = await supabaseAdmin()
    .from("articles")
    .update({
      optimized_json: optimized,
      optimized_html: renderArticleHtml(optimized, siteHost, null, sourceUrlsOf(article)),
      optimized_word_count: countWords(optimized),
      optimization_report: report,
      optimized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", articleId);
  if (error) throw new ArticleError(`Failed to save the optimized article: ${error.message}`);
  await refreshArticleOutputs(projectId, articleId); // keeps image, schema, excerpt and FAQ in sync

  logger.info("article optimized", { articleId, edits: before.edits.length, before: report.scoresBefore, after: report.scoresAfter });
  emit({ type: "step", step: "complete", message: "Complete" });
  emit({ type: "complete", report });
}

// ---- Audit -------------------------------------------------------------------------------

const auditSchema = z.object({
  checks: z.array(z.object({ id: z.enum(CHECK_IDS as [string, ...string[]]), status: z.enum(["pass", "warn", "fail"]), note: z.string() })),
  edits: z.array(
    z.object({
      target: z.enum(["intro", "section", "insert_after", "faq", "cta"]),
      index: z.number().int().nullable(),
      checkIds: z.array(z.string()),
      instruction: z.string(),
    }),
  ),
});

const AUDIT_SYSTEM = [
  "You audit a blog article for SEO, GEO (generative-engine optimization) and AEO (answer-engine optimization).",
  "Grade every check as pass, warn or fail with a one-sentence note citing evidence. Use the rule-based metrics",
  "as evidence; guidelines: primary keyword density above 3% = stuffing (fail), above 2% = warn; primary keyword",
  "missing from title or intro = warn; intro under 40 or over 180 words = warn; hierarchy issues = warn/fail;",
  "question headings should mostly be followed by a short direct answer (≤60 words) as the first paragraph;",
  "FAQ answers should be 2-4 sentences.",
  "Checks:",
  ...CHECKS.map((c) => `- ${c.id} (${c.pillar}): ${c.label}`),
  "",
  "Then plan targeted edits ONLY for checks graded warn or fail: at most " + MAX_EDITS + " edits, smallest change that fixes",
  "the problem. Never plan edits for parts that are already good. Edit targets:",
  "- intro (index null): rewrite the introduction (e.g. answer-first summary, definition, keyword in first sentence)",
  "- section (index = section index): rewrite that section's heading and/or blocks (e.g. question-style heading with",
  "  a direct answer first, shorter paragraphs, fewer exact keyword repeats, clearer definitions)",
  "- insert_after (index = section index, or -1 for right after the intro): add ONE new section, e.g. a",
  "  'Key takeaways' summary list, a short definition section, or a decision/comparison table where it truly helps",
  "- faq (index null): rewrite the FAQ list (concise, self-contained answers)",
  "- cta (index null): rewrite the call to action",
  "Each edit lists the checkIds it fixes and a precise instruction.",
  "Never plan edits that add prices, price ranges, statistics, studies, quotes or claims about named competitors : ",
  "for geo_facts, ask for concise, specific statements using facts already in the article; never ask for new numbers.",
  "Never plan a heading that duplicates another heading in the article.",
].join("\n");

export async function audit(
  content: ArticleContent,
  brief: ContentBrief,
  metrics: ArticleMetrics,
  article: ArticleRow,
  planEdits: boolean,
): Promise<{ checks: CheckResult[]; edits: ArticleEdit[] }> {
  const out = await claudeJson({
    label: planEdits ? "article audit" : "article re-audit",
    schema: auditSchema,
    maxTokens: 5000,
    system: AUDIT_SYSTEM + (planEdits ? "" : "\n\nThis is a re-check after revisions: return edits as an empty list."),
    user: [
      `LENGTH: ${wordLimits().min}-${wordLimits().max} words (now ${countWords(content)}). If the article is over the maximum, plan edits`,
      "that tighten the longest sections; if it is under the minimum, plan edits that deepen the thinnest sections.",
      "Never plan edits that would push it outside the range.",
      `PRIMARY KEYWORD: ${article.primary_keyword}`,
      `SECONDARY KEYWORDS: ${article.secondary_keywords.join("; ") || "-"}`,
      `INTENT: ${brief.searchIntent} · READER: ${brief.targetReader}`,
      `MUST-COVER TOPICS: ${brief.mustCoverTopics.join("; ")}`,
      "",
      "RULE-BASED METRICS:",
      JSON.stringify(metrics),
      "",
      "ARTICLE (sections carry their index):",
      JSON.stringify(indexed(content)),
    ].join("\n"),
  });

  const byId = new Map(out.checks.map((c) => [c.id, c]));
  const checks: CheckResult[] = CHECKS.map((c) => {
    const r = byId.get(c.id);
    return { ...c, status: r?.status ?? "warn", note: r?.note ?? "Not graded." };
  });
  const sectionCount = content.sections.length;
  const edits = planEdits
    ? out.edits
        .filter((e) => (e.target === "section" ? e.index != null && e.index >= 0 && e.index < sectionCount : true))
        .filter((e) => (e.target === "insert_after" ? e.index != null && e.index >= -1 && e.index < sectionCount : true))
        .slice(0, MAX_EDITS)
    : [];
  return { checks, edits };
}

// ---- Revise ------------------------------------------------------------------------------

const reviseSchema = z.object({
  revisions: z.array(
    z.object({
      editIndex: z.number().int(),
      heading: z.string().optional(),
      level: z.number().int().optional(),
      blocks: z.array(blockSchema).optional(),
      intro: z.array(z.string()).optional(),
      faq: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
      cta: z.object({ heading: z.string(), text: z.string(), buttonLabel: z.string(), buttonUrl: z.string() }).optional(),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
    }),
  ),
});
export type Revision = z.infer<typeof reviseSchema>["revisions"][number];

const REVISE_SYSTEM = [
  "You revise specific weak parts of an article. Return one revision per numbered edit, and ONLY for those edits.",
  "Everything you don't return stays exactly as it is, so keep each revision self-contained and consistent with",
  "the surrounding article. Preserve good content and the article's meaning; make the smallest change that fixes",
  "the listed checks. Write in the article's language and tone.",
  "",
  "Fields per target: intro → intro (paragraphs) · section → heading and/or blocks (full replacement of that",
  "section's blocks) · insert_after → heading, level (2 or 3), blocks · faq → faq · cta → cta ·",
  "meta → metaTitle (max 60 characters, includes the primary keyword) and/or metaDescription (120-160 characters).",
  "Block types: paragraph{text} · list{ordered, items} · table{headers, rows} · callout{text}.",
  "",
  "Optimization style: answer first (the first sentence answers the heading's question); concise definitions",
  "('X is …'); short, quotable, self-contained factual sentences; question-style headings where natural;",
  "use the primary keyword naturally: replace repeated exact matches with natural variants; no stuffing.",
  "",
  "Hard rules: only state facts about the business that are in the provided business facts; no specific prices;",
  "no claims about named competitors; no invented statistics, studies or quotes. Keep every statistic that is",
  "already in the part you revise exactly as written, with its source named in words. Keep the internal links of",
  "the part you revise (rewording the anchor is fine). Inline formatting: **bold** and [anchor](url) links only to",
  "the allowed URLs, which are all pages of the site itself: never link to another website. No HTML. Never write",
  "that the article is optimized for AI answers.",
  "",
  HUMAN_VOICE,
].join("\n");

export async function revise(
  content: ArticleContent,
  brief: ContentBrief,
  edits: ArticleEdit[],
  facts: string,
  allowedUrls: string[],
): Promise<Revision[]> {
  const out = await claudeJson({
    label: "article revision",
    schema: reviseSchema,
    maxTokens: 12000,
    system: REVISE_SYSTEM,
    user: [
      dateContext(),
      `PRIMARY KEYWORD: ${brief.primaryKeyword} · READER: ${brief.targetReader}`,
      `LENGTH: the whole article (now ${countWords(content)} words) must stay between ${wordLimits().min} and ${wordLimits().max} words.`,
      countWords(content) < wordLimits().min
        ? "It is below the minimum: revisions should ADD depth (examples, steps, specifics) to reach it, never filler."
        : "Revisions should keep about the same length as what they replace; new sections at most ~120 words.",
      "",
      "EDITS TO MAKE:",
      ...edits.map((e, i) => `${i}. target=${e.target}${e.index != null ? ` index=${e.index}` : ""} fixes=${e.checkIds.join(",")} → ${e.instruction}`),
      "",
      "BUSINESS FACTS:",
      facts,
      "",
      `ALLOWED LINK URLS: ${allowedUrls.join(" ")}`,
      "",
      "CURRENT ARTICLE (sections carry their index):",
      JSON.stringify(indexed(content)),
    ].join("\n"),
  });
  return out.revisions;
}

/** Prices like "$89", "€20", "A$1,200" — revisions may never introduce them. */
const PRICE = /[$€£]\s?\d/;
const hasPrice = (value: unknown) => PRICE.test(JSON.stringify(value));

/**
 * Apply revisions as patches; anything missing or malformed leaves the original part untouched.
 * Guards: a revision that adds a price where the original part had none is rejected, and a heading that
 * would duplicate another heading is ignored.
 */
export function applyRevisions(original: ArticleContent, edits: ArticleEdit[], revisions: Revision[]): ArticleContent {
  const result: ArticleContent = structuredClone(original);
  const inserts: { index: number; section: ArticleContent["sections"][number] }[] = [];
  const headingTaken = (heading: string, except?: number) =>
    result.sections.some((s, i) => i !== except && s.heading.toLowerCase() === heading.toLowerCase()) ||
    inserts.some((x) => x.section.heading.toLowerCase() === heading.toLowerCase());
  const addsPrice = (before: unknown, after: unknown) => hasPrice(after) && !hasPrice(before);

  for (const r of revisions) {
    const edit = edits[r.editIndex];
    if (!edit) continue;
    const blocks = r.blocks ? toBlocks(r.blocks, r.level === 3 ? 3 : 2) : [];
    const heading = r.heading?.trim() ?? "";

    if (edit.target === "intro" && r.intro?.some((p) => p.trim())) {
      const intro = r.intro.filter((p) => p.trim());
      if (!addsPrice(result.intro, intro)) result.intro = intro;
    } else if (edit.target === "section" && edit.index != null && result.sections[edit.index]) {
      const s = result.sections[edit.index];
      if (heading && !headingTaken(heading, edit.index)) s.heading = heading;
      if (blocks.length && !addsPrice(s.blocks, blocks)) s.blocks = blocks;
    } else if (edit.target === "insert_after" && edit.index != null && heading && blocks.length) {
      if (!headingTaken(heading) && !hasPrice(blocks)) {
        inserts.push({ index: edit.index, section: { heading, level: r.level === 3 ? 3 : 2, blocks } });
      }
    } else if (edit.target === "faq" && r.faq && r.faq.length >= 3) {
      const faq = r.faq.filter((f) => f.question.trim() && f.answer.trim());
      if (!addsPrice(result.faq, faq)) result.faq = faq;
    } else if (edit.target === "meta") {
      // Out-of-range meta text is rejected rather than cut off mid-word.
      const title = r.metaTitle?.trim() ?? "";
      const description = r.metaDescription?.trim() ?? "";
      if (title.length >= 20 && title.length <= 60 && !hasPrice(title)) result.metaTitle = title;
      if (description.length >= 70 && description.length <= 160 && !hasPrice(description)) result.metaDescription = description;
    } else if (edit.target === "cta" && r.cta?.heading.trim() && r.cta.text.trim()) {
      const cta = { ...r.cta, buttonUrl: r.cta.buttonUrl || original.cta.buttonUrl };
      if (!addsPrice(result.cta, cta)) result.cta = cta;
    }
  }

  // Insert from the back so earlier indices stay valid.
  for (const { index, section } of inserts.sort((a, b) => b.index - a.index)) {
    result.sections.splice(index + 1, 0, section);
  }
  return stripArticleDashes(result);
}

/**
 * Apply revisions, then keep the article within the word range: while the result is over the maximum and
 * longer than the original, drop the revision that added the most words (often an inserted section); while
 * it is under the minimum and shorter than the original, drop the revision that removed the most words.
 */
export function enforceWordLimit(
  original: ArticleContent,
  edits: ArticleEdit[],
  revisions: Revision[],
  maxWords: number,
  minWords = 0,
): { content: ArticleContent; applied: number } {
  const baseWords = countWords(original);
  const ceiling = Math.max(maxWords, baseWords);
  const floor = Math.min(minWords, baseWords);
  const growth = new Map(revisions.map((r) => [r, countWords(applyRevisions(original, edits, [r])) - baseWords]));
  let kept = [...revisions];
  let result = applyRevisions(original, edits, kept);

  while (countWords(result) > ceiling && kept.length) {
    const largest = kept.reduce((a, b) => ((growth.get(b) ?? 0) > (growth.get(a) ?? 0) ? b : a));
    if ((growth.get(largest) ?? 0) <= 0) break; // nothing left that adds words
    kept = kept.filter((r) => r !== largest);
    result = applyRevisions(original, edits, kept);
  }
  while (countWords(result) < floor && kept.length) {
    const smallest = kept.reduce((a, b) => ((growth.get(b) ?? 0) < (growth.get(a) ?? 0) ? b : a));
    if ((growth.get(smallest) ?? 0) >= 0) break; // nothing left that removes words
    kept = kept.filter((r) => r !== smallest);
    result = applyRevisions(original, edits, kept);
  }
  if (kept.length < revisions.length) {
    logger.info("revisions dropped to respect word range", { dropped: revisions.length - kept.length, words: countWords(result), minWords, maxWords });
  }
  // Count only revisions that actually changed something.
  const applied = kept.filter((r) => JSON.stringify(applyRevisions(original, edits, [r])) !== JSON.stringify(original)).length;
  return { content: result, applied };
}

/** Reuse the writer's normalizer for revised blocks (drops malformed lists/tables). */
function toBlocks(raw: z.infer<typeof blockSchema>[], level: 2 | 3) {
  const normalized = normalizeArticle({
    title: "-",
    metaTitle: "-",
    metaDescription: "-",
    slug: "-",
    intro: [],
    sections: [{ heading: "section", level, blocks: raw }],
    faq: [],
    cta: { heading: "-", text: "-", buttonLabel: "-", buttonUrl: "" },
  });
  return normalized.sections[0]?.blocks ?? [];
}

function indexed(content: ArticleContent) {
  return { ...content, sections: content.sections.map((s, index) => ({ index, ...s })) };
}
