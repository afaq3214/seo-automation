import type { ArticleContent, ArticleMetrics, CheckResult, Pillar } from "@/lib/types";
import { coverage, tokenSet } from "../keywords/text";

/** The 18 checks of Module 06. The audit model grades each one; metrics below are its evidence. */
export const CHECKS: { id: string; pillar: Pillar; label: string }[] = [
  { id: "seo_intent", pillar: "seo", label: "Search intent match" },
  { id: "seo_topic", pillar: "seo", label: "Primary topic clearly covered" },
  { id: "seo_keyword", pillar: "seo", label: "Natural primary keyword usage" },
  { id: "seo_secondary", pillar: "seo", label: "Relevant secondary topics" },
  { id: "seo_headings", pillar: "seo", label: "Correct H1/H2/H3 hierarchy" },
  { id: "seo_intro", pillar: "seo", label: "Useful introduction" },
  { id: "seo_no_stuffing", pillar: "seo", label: "No keyword stuffing" },
  { id: "seo_cta", pillar: "seo", label: "Useful conclusion / CTA" },
  { id: "geo_entities", pillar: "geo", label: "Clear entities and definitions" },
  { id: "geo_facts", pillar: "geo", label: "Concise factual statements" },
  { id: "geo_summary", pillar: "geo", label: "Answer-first summaries" },
  { id: "geo_tables", pillar: "geo", label: "Useful tables/comparisons where appropriate" },
  { id: "geo_business", pillar: "geo", label: "Clear business/product context" },
  { id: "geo_extractable", pillar: "geo", label: "Source-friendly, extractable wording" },
  { id: "aeo_questions", pillar: "aeo", label: "Question-based sections where useful" },
  { id: "aeo_direct", pillar: "aeo", label: "Direct answers after question headings" },
  { id: "aeo_definitions", pillar: "aeo", label: "Concise definitions" },
  { id: "aeo_faq", pillar: "aeo", label: "FAQ-ready answers" },
];

export const CHECK_IDS = CHECKS.map((c) => c.id);

const QUESTION = /\?$|^(what|how|why|when|where|who|which|can|does|do|is|are|should|will)\b/i;
const MAX_DIRECT_ANSWER_WORDS = 60;

const words = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "").split(/\s+/).filter(Boolean);

/** Rule-based measurements — fast, deterministic, no AI. */
export function measureArticle(c: ArticleContent, primary: string, secondary: string[]): ArticleMetrics {
  const paragraphs = [
    ...c.intro,
    ...c.sections.flatMap((s) => s.blocks.filter((b) => b.type === "paragraph").map((b) => (b as { text: string }).text)),
  ];
  const allText = [
    c.title,
    ...c.intro,
    ...c.sections.flatMap((s) => [
      s.heading,
      ...s.blocks.flatMap((b) => (b.type === "list" ? b.items : b.type === "table" ? [...b.headers, ...b.rows.flat()] : [b.text])),
    ]),
    ...c.faq.flatMap((f) => [f.question, f.answer]),
    c.cta.text,
  ].join("\n");

  const totalWords = words(allText).length;
  const phrase = primary.toLowerCase();
  const count = (text: string) => text.toLowerCase().split(phrase).length - 1;
  const primaryCount = count(allText);
  const introText = c.intro.join(" ");

  // Heading hierarchy: H1 = title; sections must start with an H2; H3s belong under an H2.
  const issues: string[] = [];
  if (!c.title.trim()) issues.push("Missing H1");
  if (c.sections[0]?.level === 3) issues.push("First heading is an H3 (no parent H2)");
  if (c.sections.filter((s) => s.level === 2).length < 3) issues.push("Fewer than 3 H2 sections");
  const headings = c.sections.map((s) => s.heading.toLowerCase());
  if (new Set(headings).size < headings.length) issues.push("Duplicate headings");

  let questionHeadings = 0;
  let directAnswers = 0;
  for (const s of c.sections) {
    if (!QUESTION.test(s.heading.trim())) continue;
    questionHeadings++;
    const first = s.blocks[0];
    if (first?.type === "paragraph" && words(first.text).length <= MAX_DIRECT_ANSWER_WORDS) directAnswers++;
  }

  const lowerText = allText.toLowerCase();
  const secondaryHits = secondary.filter((k) => coverage(tokenSet(k), tokenSet(lowerText)) >= 0.8 || lowerText.includes(k.toLowerCase()));
  const paragraphWords = paragraphs.map((p) => words(p).length);
  const linkCount = (allText.match(/\]\(https?:\/\//g) ?? []).length;

  return {
    words: totalWords,
    primaryKeywordCount: primaryCount,
    primaryKeywordDensity: totalWords ? Math.round(((primaryCount * phrase.split(/\s+/).length) / totalWords) * 1000) / 10 : 0,
    primaryInTitle: c.title.toLowerCase().includes(phrase),
    primaryInIntro: introText.toLowerCase().includes(phrase),
    primaryInH2: c.sections.some((s) => s.level === 2 && s.heading.toLowerCase().includes(phrase)),
    secondaryCoverage: secondary.length ? Math.round((secondaryHits.length / secondary.length) * 100) / 100 : 1,
    h2Count: c.sections.filter((s) => s.level === 2).length,
    h3Count: c.sections.filter((s) => s.level === 3).length,
    hierarchyIssues: issues,
    introWords: words(introText).length,
    avgParagraphWords: paragraphWords.length ? Math.round(paragraphWords.reduce((a, b) => a + b, 0) / paragraphWords.length) : 0,
    longParagraphs: paragraphWords.filter((n) => n > 80).length,
    questionHeadings,
    directAnswers,
    tables: c.sections.flatMap((s) => s.blocks).filter((b) => b.type === "table").length,
    faqCount: c.faq.length,
    longFaqAnswers: c.faq.filter((f) => words(f.answer).length > 80).length,
    hasCta: !!(c.cta.heading.trim() && c.cta.text.trim() && c.cta.buttonLabel.trim()),
    internalLinks: linkCount,
  };
}

/** pass = 1, warn = 0.5, fail = 0 → 0-100 per pillar. */
export function pillarScores(checks: CheckResult[]): Record<Pillar, number> {
  const score = (p: Pillar) => {
    const list = checks.filter((c) => c.pillar === p);
    if (!list.length) return 0;
    const sum = list.reduce((s, c) => s + (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
    return Math.round((sum / list.length) * 100);
  };
  return { seo: score("seo"), geo: score("geo"), aeo: score("aeo") };
}
