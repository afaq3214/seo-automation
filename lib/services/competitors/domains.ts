import { env } from "@/lib/env";

/**
 * Domains that are almost never realistic business competitors: social networks, forums/UGC,
 * reference sites, marketplaces, review/business directories, job boards, news sites.
 * Matched against the full host and the root domain. Extend with COMPETITOR_IGNORE_DOMAINS.
 * Big companies are NOT listed just for being big — only for being the wrong kind of site.
 */
const DEFAULT_IGNORED = [
  // social
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "pinterest.com",
  "youtube.com", "threads.net", "snapchat.com",
  // forums / UGC / Q&A
  "reddit.com", "quora.com", "medium.com", "stackexchange.com", "stackoverflow.com", "whirlpool.net.au",
  "tripadvisor.com", "tripadvisor.com.au",
  // reference
  "wikipedia.org", "wikihow.com", "dictionary.com", "merriam-webster.com", "cambridge.org",
  // marketplaces / freelance
  "amazon.com", "amazon.com.au", "amazon.co.uk", "ebay.com", "ebay.com.au", "etsy.com", "alibaba.com",
  "gumtree.com.au", "airtasker.com", "fiverr.com", "upwork.com", "freelancer.com", "hipages.com.au",
  "play.google.com", "apps.apple.com", "chromewebstore.google.com",
  // review sites / directories
  "yelp.com", "yelp.com.au", "yellowpages.com.au", "yellowpages.com", "truelocal.com.au", "hotfrog.com.au",
  "g2.com", "capterra.com", "capterra.com.au", "getapp.com", "softwareadvice.com", "trustpilot.com",
  "productreview.com.au", "clutch.co", "crunchbase.com", "producthunt.com", "sortlist.com", "goodfirms.co",
  // job boards
  "indeed.com", "au.indeed.com", "seek.com.au", "jora.com", "glassdoor.com", "glassdoor.com.au",
  // news / business media
  "news.com.au", "abc.net.au", "smh.com.au", "theage.com.au", "afr.com", "theaustralian.com.au",
  "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com", "theguardian.com", "forbes.com", "businessinsider.com",
  "techcrunch.com", "theverge.com", "wired.com", "zdnet.com", "cnet.com", "techradar.com", "smartcompany.com.au",
];

/** Two-part public suffixes common in our target countries, so "x.com.au" stays "x.com.au". */
const TWO_PART_SUFFIXES = new Set([
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "co.nz", "org.nz", "net.nz", "govt.nz",
  "com.sg", "co.za", "co.in", "com.br", "co.jp",
]);

/** "blog.example.com.au" → "example.com.au". Good enough without a full public-suffix list. */
export function rootDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export function isIgnoredDomain(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const root = rootDomain(h);
  if (/\.(gov|edu)(\.[a-z]{2})?$/.test(root) || /\.(gov|edu|ac)\.[a-z]{2}$/.test(root)) return true;
  const list = [...DEFAULT_IGNORED, ...env().COMPETITOR_IGNORE_DOMAINS];
  return list.some((d) => h === d || h.endsWith(`.${d}`) || root === d);
}

/** Validate user input like "https://www.Example.com/page" → "example.com". Throws on invalid input. */
export function parseDomainInput(input: string): string {
  let raw = input.trim().toLowerCase();
  if (!/^[a-z]+:\/\//.test(raw)) raw = `https://${raw}`;
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("Please enter a valid domain, e.g. example.com");
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.includes("..")) {
    throw new Error("Please enter a valid domain, e.g. example.com");
  }
  return rootDomain(host);
}
