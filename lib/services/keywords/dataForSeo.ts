import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { geoTargetId, languageCode } from "./geo";
import type { KeywordIdea } from "./googleAds";
import { chunk } from "./text";

/**
 * DataForSEO Keywords Data API (Google Ads data: volume, competition, top-of-page bids in USD).
 * Docs: https://docs.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live/
 */

export class DataForSeoError extends Error {}

const BASE_URL = "https://api.dataforseo.com/v3/keywords_data/google_ads";
const MAX_SEEDS_PER_TASK = 20;
/** Below this many seed-based ideas, also ask for ideas based on the website itself. */
const MIN_IDEAS_BEFORE_SITE_LOOKUP = 100;

interface DfsResult {
  keyword: string;
  search_volume: number | null;
  competition: string | null;
  competition_index: number | null;
  low_top_of_page_bid: number | null;
  high_top_of_page_bid: number | null;
}

interface DfsResponse {
  status_code: number;
  status_message: string;
  tasks:
    | { status_code: number; status_message: string; cost: number; result: DfsResult[] | null }[]
    | null;
}

/**
 * Keyword ideas from the seed keywords (one task per 20 seeds). If that returns few ideas,
 * one extra task asks for ideas based on the website URL.
 */
export async function generateKeywordIdeasDataForSeo(input: {
  seeds: string[];
  url: string;
  country: string;
  language: string;
}): Promise<KeywordIdea[]> {
  const common = {
    location_code: geoTargetId(input.country),
    language_code: languageCode(input.language),
    include_adult_keywords: false,
    sort_by: "search_volume",
  };

  const ideas = new Map<string, KeywordIdea>();
  const collect = (list: KeywordIdea[]) => list.forEach((i) => ideas.has(i.text) || ideas.set(i.text, i));

  for (const keywords of chunk(input.seeds, MAX_SEEDS_PER_TASK)) {
    collect(await runTask("keywords_for_keywords", { ...common, keywords }));
  }

  if (ideas.size < MIN_IDEAS_BEFORE_SITE_LOOKUP) {
    logger.info("few seed ideas, adding website-based ideas", { ideas: ideas.size, url: input.url });
    collect(await runTask("keywords_for_site", { ...common, target: input.url, target_type: "site" }));
  }

  logger.info("dataforseo keyword ideas", { seeds: input.seeds.length, ideas: ideas.size });
  return [...ideas.values()];
}

async function runTask(endpoint: "keywords_for_keywords" | "keywords_for_site", body: Record<string, unknown>) {
  const { DATAFORSEO_LOGIN: login, DATAFORSEO_PASSWORD: password } = env();
  if (!login || !password) {
    throw new DataForSeoError("DataForSEO is not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.");
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/${endpoint}/live`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([body]),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new DataForSeoError(`Could not reach DataForSEO: ${errorMessage(err)}`);
  }

  const json = (await res.json().catch(() => null)) as DfsResponse | null;
  if (!json) throw new DataForSeoError(`DataForSEO returned an invalid response (HTTP ${res.status})`);

  const task = json.tasks?.[0];
  const code = task?.status_code ?? json.status_code;
  const message = task?.status_message ?? json.status_message;
  if (json.status_code !== 20000 || !task || task.status_code !== 20000) throw toDataForSeoError(code, message);

  logger.info("dataforseo task complete", { endpoint, cost: task.cost, results: task.result?.length ?? 0 });

  return (task.result ?? [])
    .filter((r) => r.keyword)
    .map<KeywordIdea>((r) => ({
      text: r.keyword,
      avgMonthlySearches: r.search_volume,
      competition: r.competition === "LOW" || r.competition === "MEDIUM" || r.competition === "HIGH" ? r.competition : null,
      competitionIndex: r.competition_index,
      lowTopOfPageBid: r.low_top_of_page_bid,
      highTopOfPageBid: r.high_top_of_page_bid,
    }));
}

/** DataForSEO status codes → messages a user can act on. */
function toDataForSeoError(code: number, message: string): DataForSeoError {
  logger.error("dataforseo api error", { code, message });
  if (code === 40100 || code === 40101) {
    return new DataForSeoError("DataForSEO rejected the login. Check DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (use the API password).");
  }
  if (code === 40104) {
    return new DataForSeoError("Your DataForSEO account isn't verified yet. Complete verification at https://app.dataforseo.com/ and try again.");
  }
  if (code === 40200 || code === 40210) {
    return new DataForSeoError("Your DataForSEO balance is too low for this request. Add funds at https://app.dataforseo.com/.");
  }
  if (code === 40202) {
    return new DataForSeoError("DataForSEO rate limit reached (max 12 keyword requests per minute). Try again in a minute.");
  }
  if (code >= 40500 && code < 40600) {
    return new DataForSeoError(`DataForSEO rejected the request settings (country/language?): ${message}`);
  }
  return new DataForSeoError(`DataForSEO error ${code}: ${message}`);
}
