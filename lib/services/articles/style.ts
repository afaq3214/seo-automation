import type { ArticleBlock, ArticleContent } from "@/lib/types";

/** Words and patterns that make text read as machine-written. Shared by the writer and reviser prompts. */
export const AI_TELLS = [
  "delve",
  "in today's fast-paced world",
  "in today's digital age",
  "landscape",
  "navigate",
  "game-changer",
  "unlock",
  "unleash",
  "seamless",
  "seamlessly",
  "robust",
  "leverage",
  "elevate",
  "empower",
  "streamline",
  "harness",
  "cutting-edge",
  "tapestry",
  "realm",
  "crucial",
  "pivotal",
  "furthermore",
  "moreover",
  "additionally",
  "it's important to note",
  "it's worth noting",
  "in conclusion",
  "ultimately",
  "whether you're",
  "look no further",
  "the world of",
];

/** Voice rules for anything that writes article text. */
export const HUMAN_VOICE = [
  "Voice: write like an experienced practitioner explaining things to a smart friend, not like a brochure.",
  "- Plain, everyday words and contractions (you're, it's, don't). Talk to the reader as 'you'.",
  "- Vary sentence length: mix short punchy sentences with longer ones. Not every paragraph has the same shape.",
  "- Be specific and concrete: real situations, real numbers from the data provided, what actually happens on a",
  "  normal day. Have a point of view where it's justified ('Honestly, for most small teams this is overkill.').",
  "- NEVER use em dashes (—) or en dashes (–) as punctuation. Use a full stop, comma, colon or brackets instead.",
  "- No hyphens joining words either. Write 'after hours', 'AI powered', 'per minute', 'full time', 'follow up',",
  "  'real time' as separate words, 'ecommerce' and 'nonnegotiable' as one word, and number ranges as '5 to 10'.",
  "  If a phrase reads badly without its hyphen, reword the sentence.",
  "- Write country names in full, everywhere including titles, headings and meta text: New Zealand (not NZ),",
  "  United States (not US, USA or U.S.), United Kingdom (not UK), Australia (not AU). The same goes for other",
  "  abbreviations a reader might not know: write the full words, e.g. 'small and medium businesses' (not SMBs).",
  `- Never use these words or phrases: ${AI_TELLS.join(", ")}.`,
  "- No 'not just X, but Y' constructions, no rhetorical-question openers, no endless groups of three, no closing",
  "  sentence that just repeats what the section said, no hype or empty superlatives.",
].join("\n");

/** Replace em/en dashes: number ranges get a hyphen; titles/headings a colon; body text a comma. */
export function stripDashes(text: string, kind: "body" | "heading" = "body"): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[—–]\s*/g, kind === "heading" ? ": " : ", ")
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/:\s*:/g, ":");
}

/**
 * Remove hyphens that join words: "after-hours" → "after hours", "AI-powered" → "AI powered",
 * "non-negotiable" → "nonnegotiable", "5-10" → "5 to 10". Link URLs and phone-style digit groups
 * (1300-123-456) are left alone.
 */
export function removeHyphens(text: string): string {
  return text
    .split(/(\]\([^)]*\))/) // keep the "](url)" part of links as it is
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\b(wi)-(fi)\b/gi, "$1$2")
            .replace(/\b(non|co|re|pre|e|anti|multi|semi)-(?=[a-z])/gi, "$1")
            .replace(/(?<![\d-])(\d{1,4})-(\d{1,4})(?![\d-])/g, "$1 to $2")
            .replace(/(?<=[A-Za-z0-9])-(?=[A-Za-z])|(?<=[A-Za-z])-(?=[0-9])/g, " "),
    )
    .join("");
}

const COUNTRY_NAMES: Record<string, string> = { NZ: "New Zealand", UK: "United Kingdom", US: "United States", USA: "United States", AU: "Australia" };

/**
 * Country abbreviations → full names ("NZ businesses" → "New Zealand businesses"). Case-sensitive, so the
 * word "us" is untouched; link URLs and currency codes (NZ$, US$) are left alone.
 */
export function expandCountryNames(text: string): string {
  return text
    .split(/(\]\([^)]*\))/) // keep the "](url)" part of links as it is
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\bU\.S\.(?:A\.)?(?=\s*$|\s+[A-Z])/g, "United States.")
            .replace(/\bU\.S\.(?:A\.)?/g, "United States")
            .replace(/\b(NZ|UK|USA|US|AU)\b(?!\$)/g, (m) => COUNTRY_NAMES[m]),
    )
    .join("");
}

/** Clean every visible text field of an article: no dashes or word-joining hyphens, country names written in full. */
export function stripArticleDashes(c: ArticleContent): ArticleContent {
  const body = (s: string) => removeHyphens(expandCountryNames(stripDashes(s)));
  const head = (s: string) => removeHyphens(expandCountryNames(stripDashes(s, "heading")));
  // Meta titles have a 60-character budget: only expand when the result still fits.
  const metaTitle = (s: string) => (head(s).length <= 60 ? head(s) : removeHyphens(stripDashes(s, "heading")));
  const block = (b: ArticleBlock): ArticleBlock => {
    switch (b.type) {
      case "paragraph":
      case "callout":
        return { ...b, text: body(b.text) };
      case "list":
        return { ...b, items: b.items.map(body) };
      case "table":
        return { ...b, headers: b.headers.map(head), rows: b.rows.map((r) => r.map(body)) };
    }
  };
  return {
    ...c,
    title: head(c.title),
    metaTitle: metaTitle(c.metaTitle),
    metaDescription: body(c.metaDescription),
    intro: c.intro.map(body),
    sections: c.sections.map((s) => ({ ...s, heading: head(s.heading), blocks: s.blocks.map(block) })),
    faq: c.faq.map((f) => ({ question: head(f.question), answer: body(f.answer) })),
    cta: { ...c.cta, heading: head(c.cta.heading), text: body(c.cta.text), buttonLabel: head(c.cta.buttonLabel) },
  };
}
