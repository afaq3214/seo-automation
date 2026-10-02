import type { ArticleContent, ContentBrief, SerpResearch } from "@/lib/types";
import { coverage, jaccard, tokenSet, tokens } from "../keywords/text";

/**
 * Deterministic content measurements against the brief and the Google research.
 * Same article in → same numbers out. Used by the Module 09 rule criteria.
 */

const strip = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "");
const wordList = (s: string) => strip(s).split(/\s+/).filter(Boolean);
const QUESTION = /\?$|^(what|how|why|when|where|who|which|can|does|do|is|are|should|will)\b/i;
const SUMMARY_HEADING = /\b(key takeaways?|summary|at a glance|tl;?dr|in short|bottom line|quick answer|in brief)\b/i;

export interface ContentMeasures {
  topicCoverage: { covered: number; total: number; missing: string[] };
  semanticCoverage: { covered: number; total: number; missing: string[] };
  questionCoverage: { answered: number; total: number; missing: string[] };
  headingAlignment: { aligned: number; questionHeadings: number; misaligned: string[] };
  definition: { found: boolean; early: boolean; sentence: string | null };
  summaries: { hasSummaryBlock: boolean; avgOpenerWords: number };
  structure: { structuredBlocksPer500: number; avgParagraphWords: number; longParagraphs: number; wordsPerH2: number };
  readability: { fleschReadingEase: number | null };
  brand: { name: string; mentions: number; inIntro: boolean; inCta: boolean };
  faq: { count: number; longAnswers: number; indirectAnswers: number };
}

export function measureContent(
  c: ArticleContent,
  input: { brief: ContentBrief; research: SerpResearch; primaryKeyword: string; brand: string; language: string },
): ContentMeasures {
  const headings = c.sections.map((s) => s.heading);
  const sectionText = (s: ArticleContent["sections"][number]) =>
    s.blocks.map((b) => (b.type === "list" ? b.items.join(" ") : b.type === "table" ? [...b.headers, ...b.rows.flat()].join(" ") : b.text)).join(" ");
  const body = [...c.intro, ...c.sections.map((s) => `${s.heading} ${sectionText(s)}`), ...c.faq.map((f) => `${f.question} ${f.answer}`)].join(" ");
  const bodyTokens = tokenSet(body);
  const headingTokens = headings.concat(c.faq.map((f) => f.question)).map((h) => tokenSet(h));
  const totalWords = wordList(body).length || 1;

  // Must-cover topics from the brief: covered when ≥60% of the topic's words appear in the article.
  const topics = input.brief.mustCoverTopics;
  const missingTopics = topics.filter((t) => coverage(tokenSet(t), bodyTokens) < 0.6);

  // Semantic terms: words that appear in ≥2 top-ranking pages' titles/headings (the topic's shared vocabulary).
  const docs = [
    ...input.research.competitorPages.map((p) => [p.title ?? "", p.h1 ?? "", ...p.h2s, ...p.h3s].join(" ")),
    ...input.research.organic.map((o) => o.title),
  ].map((d) => new Set(tokens(d)));
  const brandTokens = new Set(tokens(input.brand));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) if (t.length > 2 && !/^\d+$/.test(t) && !brandTokens.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const terms = [...df.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([t]) => t);
  const missingTerms = terms.filter((t) => !bodyTokens.has(t));

  // Questions from the brief + Google's "People also ask": answered by a heading or FAQ question.
  const questions = [...new Set([...input.brief.commonQuestions, ...input.research.peopleAlsoAsk])];
  const unanswered = questions.filter((q) => {
    const qt = tokenSet(q);
    return !headingTokens.some((h) => jaccard(qt, h) >= 0.5 || coverage(qt, h) >= 0.7);
  });

  // Question headings whose first paragraph actually addresses the heading.
  let questionHeadings = 0;
  let aligned = 0;
  const misaligned: string[] = [];
  for (const s of c.sections) {
    if (!QUESTION.test(s.heading.trim())) continue;
    questionHeadings++;
    const first = s.blocks[0];
    // Answers often rephrase the question, so 40% word overlap counts as addressing it.
    if (first?.type === "paragraph" && coverage(tokenSet(s.heading), tokenSet(first.text)) >= 0.4) aligned++;
    else misaligned.push(s.heading);
  }

  // Definition sentence: "<primary keyword> is/are/refers to/means …", ≤40 words.
  const sentences = (text: string) => strip(text).split(/(?<=[.!?])\s+/);
  const kw = input.primaryKeyword.toLowerCase();
  const kwRoot = kw.replace(/s$/, "");
  const isDefinition = (s: string) =>
    s.toLowerCase().includes(kwRoot) && /\b(is|are|refers to|means)\b/i.test(s) && wordList(s).length <= 40;
  const earlyText = [...c.intro, ...(c.sections[0] ? [sectionText(c.sections[0])] : []), ...(c.sections[1] ? [sectionText(c.sections[1])] : [])];
  const earlyDef = earlyText.flatMap(sentences).find(isDefinition) ?? null;
  const anyDef = earlyDef ?? [body].flatMap(sentences).find(isDefinition) ?? null;

  // Summaries: a takeaways/summary block, and short section openers.
  const hasSummaryBlock = headings.some((h) => SUMMARY_HEADING.test(h));
  const openers = c.sections.map((s) => s.blocks[0]).filter((b) => b?.type === "paragraph").map((b) => wordList((b as { text: string }).text).length);
  const avgOpener = openers.length ? Math.round(openers.reduce((a, b) => a + b, 0) / openers.length) : 0;

  // Structure.
  const allBlocks = c.sections.flatMap((s) => s.blocks);
  const structured = allBlocks.filter((b) => b.type === "list" || b.type === "table").length;
  const paragraphs = [...c.intro, ...allBlocks.filter((b) => b.type === "paragraph").map((b) => (b as { text: string }).text)].map((p) => wordList(p).length);
  const h2 = c.sections.filter((s) => s.level === 2).length || 1;

  // Brand mentions.
  const brandName = input.brand.toLowerCase();
  const mentions = brandName ? (body.toLowerCase().match(new RegExp(`\\b${escapeRegex(brandName)}\\b`, "g")) ?? []).length : 0;

  return {
    topicCoverage: { covered: topics.length - missingTopics.length, total: topics.length, missing: missingTopics },
    semanticCoverage: { covered: terms.length - missingTerms.length, total: terms.length, missing: missingTerms },
    questionCoverage: { answered: questions.length - unanswered.length, total: questions.length, missing: unanswered },
    headingAlignment: { aligned, questionHeadings, misaligned },
    definition: { found: !!anyDef, early: !!earlyDef, sentence: anyDef },
    summaries: { hasSummaryBlock, avgOpenerWords: avgOpener },
    structure: {
      structuredBlocksPer500: Math.round((structured / totalWords) * 500 * 10) / 10,
      avgParagraphWords: paragraphs.length ? Math.round(paragraphs.reduce((a, b) => a + b, 0) / paragraphs.length) : 0,
      longParagraphs: paragraphs.filter((n) => n > 80).length,
      wordsPerH2: Math.round(totalWords / h2),
    },
    readability: { fleschReadingEase: input.language === "en" ? fleschReadingEase(body) : null },
    brand: {
      name: input.brand,
      mentions,
      inIntro: c.intro.join(" ").toLowerCase().includes(brandName),
      inCta: `${c.cta.heading} ${c.cta.text}`.toLowerCase().includes(brandName),
    },
    faq: {
      count: c.faq.length,
      longAnswers: c.faq.filter((f) => wordList(f.answer).length > 80).length,
      indirectAnswers: c.faq.filter((f) => wordList(sentences(f.answer)[0] ?? "").length > 30).length,
    },
  };
}

/** Flesch Reading Ease (English). 60-70 = plain English, 50-60 = fairly difficult, <30 = very difficult. */
function fleschReadingEase(text: string): number {
  const words = wordList(text).map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean);
  const sentenceCount = Math.max(1, strip(text).split(/[.!?]+\s/).filter((s) => s.trim()).length);
  if (!words.length) return 0;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentenceCount) - 84.6 * (syllables / words.length);
  return Math.round(score);
}

function countSyllables(word: string): number {
  if (word.length <= 3) return 1;
  const w = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
