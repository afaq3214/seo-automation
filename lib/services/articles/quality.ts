import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type {
  ArticleContent,
  ArticleEdit,
  ArticleRow,
  CheckStatus,
  CriterionResult,
  Pillar,
  Project,
  QualityEvent,
  QualityReport,
  QualityRound,
} from "@/lib/types";
import { getProject } from "../projects";
import { measureArticle } from "./checks";
import { ArticleError, siteContext } from "./generate";
import { countWords } from "./html";
import { measureContent, type ContentMeasures } from "./measures";
import { DISCLAIMER, enforceWordLimit, revise } from "./optimize";
import { refreshArticleOutputs } from "./render";
import { getArticle } from "./repository";

/**
 * Module 09 — "pure" scoring:
 *   · 20 of 24 criteria are deterministic rules measured against the brief and the Google research
 *     (same article → same result, every reason is a measurement);
 *   · the 4 criteria that need judgment are graded by an independent judge model (not the writer),
 *     blind, with a fixed rubric; the final grade is the median of several judge runs;
 *   · edits are planned separately by the writer model, only for failed criteria, max N rounds.
 */

type Criterion = { id: string; pillar: Pillar; label: string; source: "rule" | "ai"; weight: number };

export const CRITERIA: Criterion[] = [
  // SEO
  { id: "seo_intent", pillar: "seo", label: "Search intent match", source: "ai", weight: 1.5 },
  { id: "seo_quality", pillar: "seo", label: "Content quality", source: "ai", weight: 1.5 },
  { id: "seo_topic", pillar: "seo", label: "Topic coverage (brief)", source: "rule", weight: 1.5 },
  { id: "seo_keyword", pillar: "seo", label: "Keyword targeting", source: "rule", weight: 1.5 },
  { id: "seo_headings", pillar: "seo", label: "Heading structure", source: "rule", weight: 1 },
  { id: "seo_metadata", pillar: "seo", label: "Meta title, description & slug", source: "rule", weight: 1 },
  { id: "seo_internal_links", pillar: "seo", label: "Internal links", source: "rule", weight: 1 },
  { id: "seo_image", pillar: "seo", label: "Image SEO (featured image + alt)", source: "rule", weight: 1 },
  { id: "seo_schema", pillar: "seo", label: "Structured data (schema)", source: "rule", weight: 0.5 },
  { id: "seo_length", pillar: "seo", label: "Length within limits", source: "rule", weight: 0.5 },
  { id: "seo_readability", pillar: "seo", label: "Readability", source: "rule", weight: 0.5 },
  // GEO
  { id: "geo_answerability", pillar: "geo", label: "Answerability", source: "ai", weight: 1 },
  { id: "geo_factual", pillar: "geo", label: "Factual clarity", source: "ai", weight: 1 },
  { id: "geo_entity", pillar: "geo", label: "Entity clarity (definition + brand)", source: "rule", weight: 1 },
  { id: "geo_semantic", pillar: "geo", label: "Semantic coverage (top-ranking terms)", source: "rule", weight: 1 },
  { id: "geo_structure", pillar: "geo", label: "Structure (sections & paragraphs)", source: "rule", weight: 1 },
  { id: "geo_summaries", pillar: "geo", label: "Concise summaries", source: "rule", weight: 1 },
  { id: "geo_brand", pillar: "geo", label: "Brand / entity context", source: "rule", weight: 1 },
  // AEO
  { id: "aeo_direct", pillar: "aeo", label: "Direct answers", source: "rule", weight: 1 },
  { id: "aeo_questions", pillar: "aeo", label: "Question coverage", source: "rule", weight: 1 },
  { id: "aeo_heading_alignment", pillar: "aeo", label: "Heading-answer alignment", source: "rule", weight: 1 },
  { id: "aeo_definitions", pillar: "aeo", label: "Concise definitions", source: "rule", weight: 1 },
  { id: "aeo_faq", pillar: "aeo", label: "FAQ usefulness", source: "rule", weight: 1 },
  { id: "aeo_structured", pillar: "aeo", label: "Structured answers (lists/tables)", source: "rule", weight: 1 },
];

const JUDGE_IDS = CRITERIA.filter((c) => c.source === "ai").map((c) => c.id) as [string, ...string[]];
/** Criteria text edits can't fix. */
const NOT_TEXT_FIXABLE = new Set(["seo_image", "seo_schema"]);
const MAX_EDITS_PER_ROUND = 6;
type Grade = { status: CheckStatus; reason: string };

export function targets(): Record<Pillar, number> {
  const e = env();
  return { seo: e.QUALITY_TARGET_SEO, geo: e.QUALITY_TARGET_GEO, aeo: e.QUALITY_TARGET_AEO };
}

interface Ctx {
  article: ArticleRow;
  project: Project;
  brand: string;
}

// ---- Rule criteria ---------------------------------------------------------------------

const ratio = (n: number, d: number) => (d ? n / d : 1);
const band = (r: number, pass: number, warn: number): CheckStatus => (r >= pass ? "pass" : r >= warn ? "warn" : "fail");
const listMissing = (items: string[], n = 3) => (items.length ? ` Missing: ${items.slice(0, n).join("; ")}${items.length > n ? "…" : ""}.` : "");

function ruleGrades(content: ArticleContent, ctx: Ctx): { grades: Record<string, Grade>; measures: ContentMeasures } {
  const { article, project } = ctx;
  const maxWords = env().ARTICLE_MAX_WORDS;
  const m = measureArticle(content, article.primary_keyword, article.secondary_keywords);
  const x = measureContent(content, {
    brief: article.brief,
    research: article.serp_research,
    primaryKeyword: article.primary_keyword,
    brand: ctx.brand,
    language: project.language,
  });
  const keyword = article.primary_keyword.toLowerCase();
  const g: Record<string, Grade> = {};

  const t = x.topicCoverage;
  g.seo_topic = { status: t.total ? band(ratio(t.covered, t.total), 0.85, 0.6) : "pass", reason: `Covers ${t.covered}/${t.total} must-cover topics from the brief.${listMissing(t.missing)}` };

  const kwIssues = [
    !m.primaryInTitle && "not in the title",
    !m.primaryInIntro && "not in the introduction",
    !m.primaryInH2 && "not in any H2",
    m.primaryKeywordDensity > 2.5 && `density ${m.primaryKeywordDensity}% is too high`,
    m.primaryKeywordDensity < 0.3 && `density ${m.primaryKeywordDensity}% is very low`,
  ].filter(Boolean) as string[];
  g.seo_keyword = {
    status: m.primaryKeywordDensity > 3 ? "fail" : kwIssues.length ? "warn" : "pass",
    reason: kwIssues.length ? `Primary keyword ${kwIssues.join(", ")}.` : `Used ${m.primaryKeywordCount}× (${m.primaryKeywordDensity}%), in title, intro and an H2.`,
  };

  g.seo_headings = m.hierarchyIssues.length
    ? { status: "fail", reason: `${m.hierarchyIssues.join("; ")}.` }
    : { status: "pass", reason: `${m.h2Count} H2 and ${m.h3Count} H3 headings in a valid hierarchy.` };

  const metaIssues = [
    (content.metaTitle.length < 30 || content.metaTitle.length > 60) && `meta title ${content.metaTitle.length} chars (30-60)`,
    !content.metaTitle.toLowerCase().includes(keyword) && "meta title lacks the primary keyword",
    (content.metaDescription.length < 110 || content.metaDescription.length > 160) && `meta description ${content.metaDescription.length} chars (120-160)`,
    article.slug.length > 75 && "slug over 75 chars",
  ].filter(Boolean) as string[];
  g.seo_metadata = {
    status: metaIssues.length === 0 ? "pass" : metaIssues.length === 1 ? "warn" : "fail",
    reason: metaIssues.length ? `${metaIssues.join("; ")}.` : "Meta title, description and slug within limits.",
  };

  g.seo_internal_links = { status: m.internalLinks >= 3 ? "pass" : m.internalLinks >= 1 ? "warn" : "fail", reason: `${m.internalLinks} internal link(s) (aim 3+).` };

  // Storage always works (R2 or the Supabase Storage fallback), so only the OpenAI key matters.
  const imageConfigured = !!env().OPENAI_API_KEY;
  g.seo_image =
    article.featured_image_status === "ready" && article.featured_image_url
      ? (article.featured_image_alt?.length ?? 0) >= 20
        ? { status: "pass", reason: "Featured image with descriptive alt text." }
        : { status: "warn", reason: "Featured image alt text is too short." }
      : article.featured_image_status === "failed"
        ? { status: "fail", reason: `Featured image failed: ${article.featured_image_error ?? "unknown error"} — retry it.` }
        : imageConfigured
          ? { status: "fail", reason: "No featured image yet — generate one." }
          : { status: "warn", reason: "No featured image (image generation isn't configured yet)." };

  const hasImage = article.featured_image_status === "ready";
  g.seo_schema = {
    status: content.faq.length >= 2 && hasImage ? "pass" : "warn",
    reason: `BlogPosting${content.faq.length >= 2 ? " + FAQPage" : ""} schema${hasImage ? " with image" : " (no image yet)"}.`,
  };

  g.seo_length = { status: m.words > maxWords * 1.05 ? "warn" : m.words < 600 ? "fail" : "pass", reason: `${m.words} words (limit ${maxWords}).` };

  const fre = x.readability.fleschReadingEase;
  g.seo_readability =
    fre == null
      ? { status: "pass", reason: `Reading ease isn't measured for language "${project.language}".` }
      : { status: fre >= 50 ? "pass" : fre >= 35 ? "warn" : "fail", reason: `Flesch reading ease ${fre} (aim 50+ for business readers).` };

  const def = x.definition;
  const b = x.brand;
  const entityOk = [def.found, b.mentions >= 2].filter(Boolean).length;
  g.geo_entity = {
    status: entityOk === 2 ? "pass" : entityOk === 1 ? "warn" : "fail",
    reason: `${def.found ? "Defines the topic" : "No definition sentence for the topic"}; brand "${b.name}" named ${b.mentions}×.`,
  };

  const s = x.semanticCoverage;
  g.geo_semantic =
    s.total < 5
      ? { status: "pass", reason: "Not enough top-ranking pages were read to measure shared terms." }
      : { status: band(ratio(s.covered, s.total), 0.7, 0.5), reason: `Uses ${s.covered}/${s.total} terms shared by top-ranking pages.${listMissing(s.missing, 5)}` };

  const st = x.structure;
  const structIssues = [
    st.wordsPerH2 > 350 && `${st.wordsPerH2} words per H2 section (aim ≤350)`,
    st.avgParagraphWords > 60 && `paragraphs average ${st.avgParagraphWords} words (aim ≤60)`,
    st.longParagraphs > 0 && `${st.longParagraphs} paragraph(s) over 80 words`,
  ].filter(Boolean) as string[];
  g.geo_structure = {
    status: structIssues.length === 0 ? "pass" : structIssues.length === 1 ? "warn" : "fail",
    reason: structIssues.length ? `${structIssues.join("; ")}.` : `${st.wordsPerH2} words per section, ${st.avgParagraphWords}-word paragraphs on average.`,
  };

  const sm = x.summaries;
  const sumOk = [sm.hasSummaryBlock, sm.avgOpenerWords <= 45].filter(Boolean).length;
  g.geo_summaries = {
    status: sumOk === 2 ? "pass" : sumOk === 1 ? "warn" : "fail",
    reason: `${sm.hasSummaryBlock ? "Has a summary/takeaways block" : "No summary or key-takeaways block"}; section openers average ${sm.avgOpenerWords} words (aim ≤45).`,
  };

  const brandOk = [b.mentions >= 2, b.inCta, m.internalLinks >= 1].filter(Boolean).length;
  g.geo_brand = {
    status: brandOk === 3 ? "pass" : brandOk === 2 ? "warn" : "fail",
    reason: `"${b.name}" named ${b.mentions}×, ${b.inCta ? "in" : "not in"} the CTA, ${m.internalLinks} link(s) to the site.`,
  };

  g.aeo_direct =
    m.questionHeadings === 0
      ? { status: "warn", reason: "No question-style headings to answer directly." }
      : { status: band(ratio(m.directAnswers, m.questionHeadings), 0.8, 0.5), reason: `${m.directAnswers}/${m.questionHeadings} question headings start with a ≤60-word answer.` };

  const q = x.questionCoverage;
  g.aeo_questions = {
    status: q.total ? band(ratio(q.answered, q.total), 0.8, 0.5) : "pass",
    reason: `Answers ${q.answered}/${q.total} questions from the brief and Google's "People also ask".${listMissing(q.missing, 2)}`,
  };

  const ha = x.headingAlignment;
  g.aeo_heading_alignment =
    ha.questionHeadings === 0
      ? { status: "warn", reason: "No question-style headings." }
      : { status: band(ratio(ha.aligned, ha.questionHeadings), 0.8, 0.5), reason: `${ha.aligned}/${ha.questionHeadings} question headings are answered by their first paragraph.${listMissing(ha.misaligned, 3).replace("Missing", "Not answered first")}` };

  g.aeo_definitions = def.early
    ? { status: "pass", reason: "Concise definition near the top." }
    : def.found
      ? { status: "warn", reason: "A definition exists but not near the top." }
      : { status: "fail", reason: `No concise "${article.primary_keyword} is …" definition (≤40 words).` };

  const f = x.faq;
  g.aeo_faq = {
    status: f.count >= 4 && f.longAnswers === 0 && f.indirectAnswers === 0 ? "pass" : f.count >= 3 ? "warn" : "fail",
    reason: `${f.count} FAQs; ${f.longAnswers} answer(s) over 80 words; ${f.indirectAnswers} that don't answer in the first sentence.`,
  };

  g.aeo_structured = {
    status: st.structuredBlocksPer500 >= 1 ? "pass" : st.structuredBlocksPer500 >= 0.5 ? "warn" : "fail",
    reason: `${st.structuredBlocksPer500} lists/tables per 500 words (aim 1+).`,
  };

  return { grades: g, measures: x };
}

// ---- Independent judge (4 criteria) ------------------------------------------------------

const judgeSchema = z.object({
  criteria: z.array(z.object({ id: z.enum(JUDGE_IDS), status: z.enum(["pass", "warn", "fail"]), reason: z.string() })),
});

const JUDGE_SYSTEM = [
  "You are an independent editor grading a web article. Grade ONLY these criteria, each pass / warn / fail,",
  "with one short reason quoting or pointing to concrete evidence.",
  "",
  "seo_intent — Search intent match. PASS: the article gives exactly what someone searching the keyword wants,",
  "  in the format they expect, early. WARN: relevant but takes too long or partly answers a different need.",
  "  FAIL: mostly about something else or the wrong format (e.g. a sales page for a how-to search).",
  "seo_quality — Content quality. PASS: specific, accurate, practical, no filler or repetition; a domain expert",
  "  would publish it. WARN: useful but generic in places, some padding or repetition. FAIL: thin, vague or salesy.",
  "geo_answerability — Could an AI assistant quote a single sentence from this article to answer the main",
  "  questions? PASS: clear standalone answer sentences throughout. WARN: answers exist but are buried in",
  "  context. FAIL: answers must be pieced together.",
  "geo_factual — Factual clarity. PASS: claims are precise and verifiable or clearly framed as general guidance;",
  "  no unsupported numbers. WARN: some vague or hedged claims. FAIL: unsupported statistics or confident",
  "  claims that can't be verified.",
  "",
  "Judge only the text in front of you. Ignore who wrote it.",
].join("\n");

async function judgeOnce(content: ArticleContent, article: ArticleRow, model: string): Promise<Record<string, Grade>> {
  const out = await claudeJson({
    label: "quality judge",
    schema: judgeSchema,
    model,
    effort: "low",
    maxTokens: 8000,
    system: JUDGE_SYSTEM,
    user: [
      `TARGET KEYWORD: ${article.primary_keyword}`,
      `SEARCH INTENT: ${article.brief.searchIntent} · READER: ${article.brief.targetReader}`,
      "",
      "ARTICLE:",
      JSON.stringify({ title: content.title, intro: content.intro, sections: content.sections, faq: content.faq, cta: content.cta }),
    ].join("\n"),
  });
  return Object.fromEntries(out.criteria.map((c) => [c.id, { status: c.status, reason: c.reason }]));
}

const RANK: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2 };

/** Median of N judge runs per criterion. Falls back to the writer model if the judge model is unavailable. */
async function judge(content: ArticleContent, article: ArticleRow, votes: number): Promise<{ grades: Record<string, Grade>; model: string }> {
  let model = env().QUALITY_JUDGE_MODEL;
  const runs: Record<string, Grade>[] = [];
  for (let i = 0; i < votes; i++) {
    try {
      runs.push(await judgeOnce(content, article, model));
    } catch (err) {
      if (runs.length === 0 && model !== env().ANTHROPIC_MODEL) {
        logger.warn("judge model failed, falling back to the writer model", { model, error: errorMessage(err) });
        model = env().ANTHROPIC_MODEL;
        runs.push(await judgeOnce(content, article, model));
      } else throw err;
    }
  }
  const grades: Record<string, Grade> = {};
  for (const id of JUDGE_IDS) {
    const votesFor = runs.map((r) => r[id]).filter(Boolean).sort((a, b) => RANK[a.status] - RANK[b.status]);
    grades[id] = votesFor[Math.floor(votesFor.length / 2)] ?? { status: "warn", reason: "Not graded." };
    if (runs.length > 1) grades[id] = { ...grades[id], reason: `${grades[id].reason} (median of ${runs.length} runs)` };
  }
  return { grades, model };
}

// ---- Evaluate + plan ---------------------------------------------------------------------

const VALUE: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };

function weighted(list: CriterionResult[]): number | null {
  const total = list.reduce((s, c) => s + c.weight, 0);
  return total ? Math.round((list.reduce((s, c) => s + c.weight * VALUE[c.status], 0) / total) * 100) : null;
}

function scoresOf(criteria: CriterionResult[]) {
  const pillars: Pillar[] = ["seo", "geo", "aeo"];
  const scores = Object.fromEntries(pillars.map((p) => [p, weighted(criteria.filter((c) => c.pillar === p)) ?? 0])) as Record<Pillar, number>;
  const breakdown = Object.fromEntries(
    pillars.map((p) => [
      p,
      {
        rules: weighted(criteria.filter((c) => c.pillar === p && c.source === "rule")),
        judge: weighted(criteria.filter((c) => c.pillar === p && c.source === "ai")),
      },
    ]),
  ) as Record<Pillar, { rules: number | null; judge: number | null }>;
  return { scores, breakdown };
}

export const meetsTargets = (s: Record<Pillar, number>, t: Record<Pillar, number>) => s.seo >= t.seo && s.geo >= t.geo && s.aeo >= t.aeo;

export async function evaluate(content: ArticleContent, ctx: Ctx, votes: number) {
  const { grades: rules, measures } = ruleGrades(content, ctx);
  const { grades: judged, model } = await judge(content, ctx.article, votes);
  const criteria: CriterionResult[] = CRITERIA.map((c) => {
    const g = c.source === "rule" ? rules[c.id] : judged[c.id];
    return { ...c, status: g?.status ?? "warn", reason: g?.reason ?? "Not graded." };
  });
  return { criteria, ...scoresOf(criteria), measures, words: countWords(content), judgeModel: model };
}

const planSchema = z.object({
  edits: z.array(
    z.object({
      target: z.enum(["intro", "section", "insert_after", "faq", "cta", "meta"]),
      index: z.number().int().nullable(),
      checkIds: z.array(z.string()),
      instruction: z.string(),
    }),
  ),
});

/** The writer model plans the smallest edits that fix the failed criteria (the judge never plans). */
async function planEdits(content: ArticleContent, ctx: Ctx, failing: CriterionResult[], measures: ContentMeasures): Promise<ArticleEdit[]> {
  const out = await claudeJson({
    label: "quality edit plan",
    schema: planSchema,
    maxTokens: 3000,
    system: [
      `Plan at most ${MAX_EDITS_PER_ROUND} targeted edits that fix the failed criteria below — nothing else.`,
      "Each edit names the smallest part to change: intro · section (index) · insert_after (index, -1 = after the intro)",
      "· faq · cta · meta (meta title/description), the checkIds it fixes, and a precise instruction that uses the",
      "measured gaps (e.g. which topics/questions/terms are missing, which paragraph is too long).",
      "Never rewrite the whole article, never plan duplicate headings, never ask for prices, statistics, quotes or",
      `claims about named competitors. Keep the article within ${env().ARTICLE_MAX_WORDS} words (prefer replacing over adding).`,
    ].join("\n"),
    user: [
      `PRIMARY KEYWORD: ${ctx.article.primary_keyword}`,
      "FAILED CRITERIA:",
      ...failing.map((c) => `- ${c.id} (${c.status}): ${c.reason}`),
      "",
      `MISSING TOPICS: ${measures.topicCoverage.missing.join("; ") || "-"}`,
      `UNANSWERED QUESTIONS: ${measures.questionCoverage.missing.join("; ") || "-"}`,
      `MISSING TOP-RANKING TERMS: ${measures.semanticCoverage.missing.join(", ") || "-"}`,
      `QUESTION HEADINGS WHOSE FIRST PARAGRAPH DOESN'T ANSWER THEM: ${measures.headingAlignment.misaligned.join(" | ") || "-"}`,
      "",
      "ARTICLE (sections carry their index):",
      JSON.stringify({ ...content, sections: content.sections.map((s, index) => ({ index, ...s })) }),
    ].join("\n"),
  });
  const n = content.sections.length;
  return out.edits
    .filter((e) => (e.target === "section" ? e.index != null && e.index >= 0 && e.index < n : true))
    .filter((e) => (e.target === "insert_after" ? e.index != null && e.index >= -1 && e.index < n : true))
    .slice(0, MAX_EDITS_PER_ROUND);
}

// ---- Loop --------------------------------------------------------------------------------

export async function runQualityLoop(projectId: string, articleId: string, emit: (e: QualityEvent) => void): Promise<void> {
  const article = await getArticle(projectId, articleId);
  if (!article) throw new ArticleError("Article not found", 404);
  const project = await getProject(projectId);
  if (!project?.analysis) throw new ArticleError("Project analysis not found", 409);

  const e = env();
  const goal = targets();
  const label = project.domain.split(".")[0];
  const ctx: Ctx = { article, project, brand: label.charAt(0).toUpperCase() + label.slice(1) };
  let content = article.optimized_json ?? article.content_json;
  const rounds: QualityRound[] = [];
  let changed = false;

  emit({ type: "step", step: "scoring", message: "Scoring (rules + independent judge)" });
  let current = await evaluate(content, ctx, 1);
  rounds.push({ round: 0, scores: current.scores, failed: failed(current.criteria).map((c) => c.id), editsApplied: 0, words: current.words });

  for (let round = 1; round <= e.QUALITY_MAX_ROUNDS && !meetsTargets(current.scores, goal); round++) {
    const fixable = failed(current.criteria).filter((c) => !NOT_TEXT_FIXABLE.has(c.id));
    if (!fixable.length) break;

    emit({ type: "step", step: "improving", message: `Round ${round}/${e.QUALITY_MAX_ROUNDS}: fixing ${fixable.length} criteria` });
    const edits = await planEdits(content, ctx, fixable, current.measures);
    if (!edits.length) break;
    const { facts, links } = await siteContext(project, article.brief);
    const revisions = await revise(content, article.brief, edits, facts, links.map((l) => l.url));
    const limited = enforceWordLimit(content, edits, revisions, e.ARTICLE_MAX_WORDS);
    if (limited.applied === 0) break;

    emit({ type: "step", step: "scoring", message: `Re-scoring after round ${round}` });
    const next = await evaluate(limited.content, ctx, 1);
    const worse = shortfall(next.scores, goal) > shortfall(current.scores, goal);
    rounds.push({
      round,
      scores: next.scores,
      failed: failed(next.criteria).map((c) => c.id),
      editsApplied: limited.applied,
      words: next.words,
      ...(worse ? { reverted: true } : {}),
    });
    if (worse) break; // keep the better previous version and stop
    content = limited.content;
    current = next;
    changed = true;
  }

  // Final grade: rules again (free) + the judge's median of several runs.
  if (e.QUALITY_JUDGE_VOTES > 1) {
    emit({ type: "step", step: "scoring", message: `Final grade (${e.QUALITY_JUDGE_VOTES} judge runs)` });
    current = await evaluate(content, ctx, e.QUALITY_JUDGE_VOTES);
  }

  emit({ type: "step", step: "saving", message: "Saving scores" });
  const status = meetsTargets(current.scores, goal) ? "ready" : "needs_review";
  const report: QualityReport = {
    targets: goal,
    finalScores: current.scores,
    breakdown: current.breakdown,
    judge: { model: current.judgeModel, votes: e.QUALITY_JUDGE_VOTES },
    criteria: current.criteria,
    rounds,
    status,
    summary: summarize(status, current.scores, goal, rounds, current.criteria),
    disclaimer: DISCLAIMER,
  };

  const { error } = await supabaseAdmin()
    .from("articles")
    .update({
      ...(changed ? { optimized_json: content, optimized_word_count: countWords(content) } : {}),
      seo_score: current.scores.seo,
      geo_score: current.scores.geo,
      aeo_score: current.scores.aeo,
      quality_report: report,
      quality_checked_at: new Date().toISOString(),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", articleId);
  if (error) throw new ArticleError(`Failed to save scores: ${error.message}`);
  await refreshArticleOutputs(projectId, articleId);

  logger.info("quality loop done", { articleId, status, scores: current.scores, rounds: rounds.length - 1, judge: current.judgeModel });
  emit({ type: "step", step: "complete", message: "Complete" });
  emit({ type: "complete", report });
}

/** Total points below target across the three scores (0 = all targets met). */
function shortfall(s: Record<Pillar, number>, t: Record<Pillar, number>): number {
  return Math.max(0, t.seo - s.seo) + Math.max(0, t.geo - s.geo) + Math.max(0, t.aeo - s.aeo);
}

function failed(criteria: CriterionResult[]): CriterionResult[] {
  return criteria.filter((c) => c.status !== "pass");
}

function summarize(status: "ready" | "needs_review", s: Record<Pillar, number>, t: Record<Pillar, number>, rounds: QualityRound[], criteria: CriterionResult[]): string {
  const n = rounds.length - 1;
  if (status === "ready") return `All targets met (SEO ${s.seo}/${t.seo}, GEO ${s.geo}/${t.geo}, AEO ${s.aeo}/${t.aeo}) after ${n} improvement round(s).`;
  const missed = (["seo", "geo", "aeo"] as Pillar[]).filter((p) => s[p] < t[p]).map((p) => `${p.toUpperCase()} ${s[p]}/${t[p]}`);
  const blockers = criteria.filter((c) => c.status === "fail").map((c) => c.label);
  return `Needs review: ${missed.join(", ")} below target after ${n} round(s).${blockers.length ? ` Failing: ${blockers.join("; ")}.` : ""}`;
}
