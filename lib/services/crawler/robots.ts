import { fetchText } from "./http";

export interface RobotsInfo {
  found: boolean;
  sitemaps: string[];
  /** Rules from the "User-agent: *" group only */
  allow: string[];
  disallow: string[];
}

/** Fetch and parse robots.txt. Missing robots.txt means everything is allowed. */
export async function fetchRobots(origin: string): Promise<RobotsInfo> {
  const res = await fetchText(`${origin}/robots.txt`, 10_000);
  if (!res || !res.ok || /text\/html/i.test(res.contentType)) {
    return { found: false, sitemaps: [], allow: [], disallow: [] };
  }
  return { found: true, ...parseRobots(res.text, origin) };
}

export function parseRobots(text: string, origin: string) {
  const sitemaps: string[] = [];
  const allow: string[] = [];
  const disallow: string[] = [];

  let groupAgents: string[] = [];
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "sitemap") {
      try {
        sitemaps.push(new URL(value, origin).toString());
      } catch {
        /* ignore malformed sitemap line */
      }
      continue;
    }
    if (key === "user-agent") {
      groupAgents = lastWasAgent ? [...groupAgents, value.toLowerCase()] : [value.toLowerCase()];
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!groupAgents.includes("*")) continue;
    if (key === "allow" && value) allow.push(value);
    if (key === "disallow" && value) disallow.push(value);
  }

  return { sitemaps: [...new Set(sitemaps)], allow, disallow };
}

/** Longest-match rule check, supporting "*" wildcards and "$" end anchors. */
export function isAllowedByRobots(url: string, robots: RobotsInfo): boolean {
  if (!robots.disallow.length) return true;
  const { pathname, search } = new URL(url);
  const path = pathname + search;

  const longest = (rules: string[]) =>
    rules.reduce((best, rule) => (ruleMatches(rule, path) ? Math.max(best, rule.length) : best), -1);

  const allowLen = longest(robots.allow);
  const disallowLen = longest(robots.disallow);
  return disallowLen === -1 || allowLen >= disallowLen;
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}
