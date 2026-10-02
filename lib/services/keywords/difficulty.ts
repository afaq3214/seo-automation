import type { DifficultyLabel, SerpResult } from "@/lib/types";
import { difficultyLabel } from "./scoring";
import { coverage, tokenSet } from "./text";

/**
 * Estimated SEO Difficulty (0-100) from the top 10 organic results. Our own heuristic —
 * not Google, Ahrefs or Semrush difficulty. Components:
 *   SERP domain strength          40  big authority sites vs niche/unknown sites
 *   Title/topic optimization      25  do result titles/URLs target the exact keyword?
 *   SERP result quality           20  forums/UGC in the results make it easier
 *   Competitiveness/consistency   15  are the top 5 uniformly strong and on-topic?
 */

// Large sites that are very hard to outrank. Matched on the domain or any subdomain.
const AUTHORITY_DOMAINS = [
  "wikipedia.org", "youtube.com", "amazon.com", "amazon.com.au", "amazon.co.uk", "ebay.com", "ebay.com.au",
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "pinterest.com", "tiktok.com",
  "apple.com", "google.com", "microsoft.com", "adobe.com", "ibm.com", "oracle.com", "salesforce.com",
  "hubspot.com", "zendesk.com", "shopify.com", "wix.com", "squarespace.com", "godaddy.com", "atlassian.com",
  "forbes.com", "nytimes.com", "theguardian.com", "bbc.co.uk", "bbc.com", "cnn.com", "businessinsider.com",
  "techcrunch.com", "theverge.com", "wired.com", "zdnet.com", "pcmag.com", "techradar.com", "cnet.com",
  "investopedia.com", "nerdwallet.com", "healthline.com", "webmd.com", "mayoclinic.org", "indeed.com",
  "glassdoor.com", "seek.com.au", "g2.com", "capterra.com", "capterra.com.au", "trustpilot.com", "yelp.com",
  "tripadvisor.com", "gartner.com", "semrush.com", "ahrefs.com", "moz.com", "canva.com", "fiverr.com",
  "upwork.com", "yellowpages.com.au", "abc.net.au", "news.com.au", "smh.com.au", "afr.com", "realestate.com.au",
  "domain.com.au", "hipages.com.au", "airtasker.com", "gumtree.com.au", "bunnings.com.au", "choice.com.au",
];

// Forums and user-generated content — their presence signals a beatable SERP.
const UGC_DOMAINS = [
  "reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "medium.com", "whirlpool.net.au",
  "productreview.com.au", "answers.com", "tripadvisor.com.au", "community.", "forum.", "forums.",
];

const matchesDomain = (domain: string, list: string[]) =>
  list.some((d) => (d.endsWith(".") ? domain.startsWith(d) || domain.includes(`.${d}`) : domain === d || domain.endsWith(`.${d}`)));

function isGovOrEdu(domain: string): boolean {
  return /\.(gov|edu)(\.[a-z]{2})?$/.test(domain) || /\.(ac|gov)\.[a-z]{2}$/.test(domain);
}

function isUgc(r: SerpResult): boolean {
  return matchesDomain(r.domain, UGC_DOMAINS) || /\/(forum|forums|community|threads?|discussion)\//i.test(r.link);
}

export interface DifficultyResult {
  score: number;
  label: DifficultyLabel;
}

export function estimateDifficulty(keyword: string, organic: SerpResult[]): DifficultyResult {
  const top = organic.slice(0, 10);
  if (!top.length) return { score: 5, label: "Easy" };

  const kw = tokenSet(keyword);
  const rows = top.map((r) => {
    const ugc = isUgc(r);
    const strength = matchesDomain(r.domain, AUTHORITY_DOMAINS) ? 1 : isGovOrEdu(r.domain) ? 0.9 : ugc ? 0.25 : 0.45;
    let path = r.link;
    try {
      path = new URL(r.link).pathname;
    } catch {
      /* keep link */
    }
    const optimized = Math.max(coverage(kw, tokenSet(r.title)), 0.8 * coverage(kw, tokenSet(path)));
    return { ugc, strength, optimized };
  });
  const avg = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;

  // Unknown sites (0.45) score low, all-authority SERPs score the full 40.
  const domainStrength = 40 * clamp01((avg((r) => r.strength) - 0.25) / 0.75);
  const titleOptimization = 25 * avg((r) => r.optimized);
  const resultQuality = 20 * (1 - rows.filter((r) => r.ugc).length / rows.length);
  const top5 = rows.slice(0, 5);
  const consistency =
    15 *
    (top5.reduce(
      (s, r) => s + (r.strength >= 0.9 ? (r.optimized >= 0.6 ? 1 : 0.6) : r.optimized >= 0.8 ? 0.5 : 0),
      0,
    ) /
      top5.length);

  const score = Math.round(Math.max(0, Math.min(100, domainStrength + titleOptimization + resultQuality + consistency)));
  return { score, label: difficultyLabel(score) };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
