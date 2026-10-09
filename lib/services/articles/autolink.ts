import { supabaseAdmin } from "@/lib/supabase";
import { siteBase } from "@/lib/url";
import type { ArticleBlock, ArticleContent } from "@/lib/types";

/**
 * Links trade and industry words to the site's matching industry page, including local slang the writer
 * tends to leave unlinked ("sparkies" → /industries/electrician). Deterministic: first mention of each
 * industry, only pages the site really has, never a page the article already links to.
 */

/** Words (singular and plural, slang included) → industry page slugs to try, in order. */
const INDUSTRY_TERMS: [terms: string[], slugs: string[]][] = [
  [["sparkies", "sparky", "electricians", "electrician", "electrical contractors", "electrical contractor"], ["electrician", "electrical"]],
  [["plumbers", "plumber", "plumbing businesses", "plumbing business"], ["plumbing", "plumber"]],
  [["gas fitters", "gas fitter", "gasfitters", "gasfitter"], ["gas-fitter"]],
  [["air conditioning technicians", "air conditioning technician", "AC technicians", "AC technician"], ["ac-technician", "hvac"]],
  [["HVAC companies", "HVAC company", "HVAC technicians", "HVAC technician", "HVAC businesses", "HVAC"], ["hvac"]],
  [["roofers", "roofer", "roofing companies", "roofing company"], ["roofing"]],
  [["locksmiths", "locksmith"], ["locksmith"]],
  [["tradies", "tradie", "tradespeople", "tradesperson", "trades businesses", "trade businesses", "chippies", "chippy", "builders", "carpenters", "landscapers"], ["tradies"]],
  [["mechanics", "mechanic", "auto repair shops", "auto repair shop", "mechanic shops", "mechanic shop"], ["mechanic-shop", "automotive", "automative"]],
  [["car dealerships", "car dealership", "car dealers"], ["car-dealership"]],
  [["tyre shops", "tyre shop", "tire shops", "tire shop"], ["tire-shop", "tire-shop-owner"]],
  [["car washes", "car wash"], ["car-wash"]],
  [["dentists", "dentist", "dental practices", "dental practice", "dental clinics", "dental clinic"], ["dental"]],
  [["physiotherapists", "physiotherapist", "physios", "physio"], ["physiotherapist"]],
  [["chiropractors", "chiropractor"], ["chiropractor"]],
  [["podiatrists", "podiatrist"], ["podiatrist"]],
  [["vets", "vet clinics", "vet clinic", "veterinary clinics", "veterinary clinic", "veterinarians"], ["vet"]],
  [["medical clinics", "medical clinic", "medical practices", "medical practice", "GP clinics", "GP clinic", "clinics", "clinic"], ["medical-clinic", "healthcare"]],
  [["healthcare providers", "healthcare practices", "healthcare"], ["healthcare"]],
  [["law firms", "law firm", "lawyers", "lawyer", "solicitors", "solicitor", "legal practices", "legal practice"], ["legal", "law-firm", "law-firms"]],
  [["real estate agencies", "real estate agency", "real estate agents", "real estate agent", "real estate"], ["real-estate", "realstate"]],
  [["restaurants", "restaurant"], ["restaurants"]],
  [["salons", "salon", "hairdressers", "hairdresser"], ["salon-and-spa", "salon"]],
  [["insurance brokers", "insurance broker", "insurance agencies", "insurance agency"], ["insurance"]],
  [["financial advisers", "financial adviser", "financial advisors", "financial advisor", "financial planners", "financial planner"], ["financial-services"]],
  [["security companies", "security company", "security firms", "security firm"], ["security"]],
  [["recruitment agencies", "recruitment agency", "recruiters", "recruiter"], ["recruitment-hr", "hr-recruitment"]],
  [["online stores", "online store", "ecommerce businesses", "ecommerce stores", "ecommerce"], ["e-commerce"]],
];

export interface LinkTarget {
  url: string;
  pattern: RegExp;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pathOf = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
};

/** The project's industry pages that have known trade words, e.g. <site>/au/industries/electrician. */
export async function industryLinkTargets(projectId: string, projectUrl: string): Promise<LinkTarget[]> {
  const { data, error } = await supabaseAdmin().from("project_pages").select("url").eq("project_id", projectId).like("url", "%/industries/%").limit(1000);
  if (error) return [];
  // Only this region's own pages: /industries/<slug> directly under the site base.
  const prefix = new URL(siteBase(projectUrl)).pathname.replace(/\/+$/, "").toLowerCase();
  const bySlug = new Map<string, string>();
  for (const row of data ?? []) {
    const m = pathOf(row.url as string).match(/^(.*)\/industries\/([^/]+)$/);
    if (m && m[1] === prefix && !bySlug.has(m[2])) bySlug.set(m[2], (row.url as string).replace(/\/+$/, ""));
  }
  const targets: LinkTarget[] = [];
  for (const [terms, slugs] of INDUSTRY_TERMS) {
    const slug = slugs.find((s) => bySlug.has(s));
    if (!slug) continue;
    // Longest first, so "law firms" wins over "law firm" and "clinics" over "clinic".
    const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
    targets.push({ url: bySlug.get(slug)!, pattern: new RegExp(`(?<![\\w/])(${alternatives})(?![\\w/])`, "i") });
  }
  return targets;
}

const MAX_NEW_LINKS = 8;
const MAX_PER_TEXT = 3;

/** Add up to MAX_NEW_LINKS industry links; returns the content and how many were added. */
export function autoLinkIndustries(content: ArticleContent, targets: LinkTarget[]): { content: ArticleContent; added: number } {
  if (!targets.length) return { content, added: 0 };
  const linked = new Set([...JSON.stringify(content).matchAll(/\]\((https?:\/\/[^)\s"\\]+)\)/g)].map((m) => pathOf(m[1])));
  let added = 0;

  const link = (text: string): string => {
    let inThisText = 0;
    // Existing links are left alone. A word inside a bold span is linked by splitting the span around it
    // ("**Plumbers and sparkies**" → "**Plumbers and** [sparkies](url)"), since links can't nest inside bold.
    return text
      .split(/(\[[^\]]+\]\([^)]*\)|\*\*[^*]+\*\*)/)
      .map((part, i) => {
        if (i % 2 && part.startsWith("**")) {
          const inner = part.slice(2, -2);
          for (const t of targets) {
            if (added >= MAX_NEW_LINKS || inThisText >= MAX_PER_TEXT) break;
            if (linked.has(pathOf(t.url))) continue;
            const m = inner.match(t.pattern);
            if (!m || m.index === undefined) continue;
            const before = inner.slice(0, m.index);
            const after = inner.slice(m.index + m[1].length);
            const bold = (s: string) => (s.trim() ? `**${s.trim()}**` : "");
            linked.add(pathOf(t.url));
            added++;
            inThisText++;
            return `${bold(before)}${before.trim() && /\s$/.test(before) ? " " : ""}[${m[1]}](${t.url})${after.trim() && /^\s/.test(after) ? " " : ""}${bold(after)}`;
          }
          return part;
        }
        if (i % 2) return part;
        for (const t of targets) {
          if (added >= MAX_NEW_LINKS || inThisText >= MAX_PER_TEXT) break;
          if (linked.has(pathOf(t.url))) continue;
          const m = part.match(t.pattern);
          if (!m || m.index === undefined) continue;
          part = `${part.slice(0, m.index)}[${m[1]}](${t.url})${part.slice(m.index + m[1].length)}`;
          linked.add(pathOf(t.url));
          added++;
          inThisText++;
          // The part now contains a link: stop here so a later pattern can't match inside it.
          break;
        }
        return part;
      })
      .join("");
  };
  // Several passes per text so one sentence can pick up more than one industry ("plumbers, sparkies and builders").
  const linkAll = (text: string) => {
    let out = text;
    for (let pass = 0; pass < MAX_PER_TEXT; pass++) {
      const next = link(out);
      if (next === out) break;
      out = next;
    }
    return out;
  };

  const block = (b: ArticleBlock): ArticleBlock =>
    b.type === "paragraph" || b.type === "callout" ? { ...b, text: linkAll(b.text) } : b.type === "list" ? { ...b, items: b.items.map(linkAll) } : b;
  const result: ArticleContent = {
    ...content,
    intro: content.intro.map(linkAll),
    sections: content.sections.map((s) => ({ ...s, blocks: s.blocks.map(block) })),
    faq: content.faq.map((f) => ({ ...f, answer: linkAll(f.answer) })),
  };
  return { content: result, added };
}
