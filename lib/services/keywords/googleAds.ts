import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { geoTargetConstant, languageConstant } from "./geo";
import { chunk } from "./text";

/** Google Ads KeywordPlanIdeaService via REST (no gRPC client needed). */

export interface KeywordIdea {
  text: string;
  avgMonthlySearches: number | null;
  competition: "LOW" | "MEDIUM" | "HIGH" | null;
  competitionIndex: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  /** 0-1 estimated demand (Serper discovery only, where real volume isn't available) */
  demand?: number | null;
}

export class GoogleAdsError extends Error {}

const MAX_SEEDS_PER_REQUEST = 20; // API limit for keyword seeds
const PAGE_SIZE = 1000;
const MAX_PAGES = 3;

interface AdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId?: string;
  version: string;
}

function adsConfig(): AdsConfig {
  const e = env();
  const values = {
    GOOGLE_ADS_DEVELOPER_TOKEN: e.GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CLIENT_ID: e.GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET: e.GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN: e.GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_CUSTOMER_ID: e.GOOGLE_ADS_CUSTOMER_ID,
  };
  const missing = Object.entries(values)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new GoogleAdsError(`Google Ads API is not configured. Missing: ${missing.join(", ")}`);
  }
  return {
    developerToken: e.GOOGLE_ADS_DEVELOPER_TOKEN!,
    clientId: e.GOOGLE_ADS_CLIENT_ID!,
    clientSecret: e.GOOGLE_ADS_CLIENT_SECRET!,
    refreshToken: e.GOOGLE_ADS_REFRESH_TOKEN!,
    customerId: e.GOOGLE_ADS_CUSTOMER_ID!,
    loginCustomerId: e.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    version: e.GOOGLE_ADS_API_VERSION,
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(cfg: AdsConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };

  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") {
      throw new GoogleAdsError(
        "Google Ads authentication failed: the refresh token is invalid or expired. Generate a new one with scripts/google-ads-refresh-token.mjs.",
      );
    }
    if (json.error === "invalid_client" || json.error === "unauthorized_client") {
      throw new GoogleAdsError("Google Ads authentication failed: check GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET.");
    }
    throw new GoogleAdsError(`Google Ads authentication failed (${res.status}${json.error ? `: ${json.error}` : ""})`);
  }

  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/**
 * Keyword ideas for the given seeds. The first request also uses the website URL;
 * if that returns nothing, retries with the seed keywords alone.
 */
export async function generateKeywordIdeas(input: {
  seeds: string[];
  url: string;
  country: string;
  language: string;
}): Promise<KeywordIdea[]> {
  const cfg = adsConfig();
  const base = {
    language: languageConstant(input.language),
    geoTargetConstants: [geoTargetConstant(input.country)],
    keywordPlanNetwork: "GOOGLE_SEARCH",
    includeAdultKeywords: false,
    pageSize: PAGE_SIZE,
  };
  const batches = chunk(input.seeds, MAX_SEEDS_PER_REQUEST);
  const ideas = new Map<string, KeywordIdea>();
  const collect = (list: KeywordIdea[]) => list.forEach((i) => ideas.has(i.text) || ideas.set(i.text, i));

  for (const [i, keywords] of batches.entries()) {
    const seed = i === 0 ? { keywordAndUrlSeed: { url: input.url, keywords } } : { keywordSeed: { keywords } };
    collect(await requestIdeas(cfg, { ...base, ...seed }));
  }

  if (ideas.size === 0) {
    logger.warn("no keyword ideas with URL seed, retrying with keywords only", { url: input.url });
    for (const keywords of batches) collect(await requestIdeas(cfg, { ...base, keywordSeed: { keywords } }));
  }

  logger.info("google ads keyword ideas", { seeds: input.seeds.length, ideas: ideas.size });
  return [...ideas.values()];
}

async function requestIdeas(cfg: AdsConfig, body: Record<string, unknown>): Promise<KeywordIdea[]> {
  const url = `https://googleads.googleapis.com/${cfg.version}/customers/${cfg.customerId}:generateKeywordIdeas`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken(cfg)}`,
    "developer-token": cfg.developerToken,
    "Content-Type": "application/json",
  };
  if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;

  const results: KeywordIdea[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(pageToken ? { ...body, pageToken } : body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new GoogleAdsError(`Could not reach the Google Ads API: ${errorMessage(err)}`);
    }

    const json = (await res.json().catch(() => ({}))) as AdsResponse;
    if (!res.ok) throw toGoogleAdsError(res.status, json, cfg.version);

    for (const r of json.results ?? []) {
      const m = r.keywordIdeaMetrics ?? {};
      results.push({
        text: r.text,
        avgMonthlySearches: toNumber(m.avgMonthlySearches),
        competition: m.competition === "LOW" || m.competition === "MEDIUM" || m.competition === "HIGH" ? m.competition : null,
        competitionIndex: toNumber(m.competitionIndex),
        lowTopOfPageBid: micros(m.lowTopOfPageBidMicros),
        highTopOfPageBid: micros(m.highTopOfPageBidMicros),
      });
    }

    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return results;
}

interface AdsResponse {
  results?: {
    text: string;
    keywordIdeaMetrics?: {
      avgMonthlySearches?: string;
      competition?: string;
      competitionIndex?: string;
      lowTopOfPageBidMicros?: string;
      highTopOfPageBidMicros?: string;
    };
  }[];
  nextPageToken?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[];
  };
}

/** Turn a Google Ads error payload into a message a user can act on. */
function toGoogleAdsError(status: number, json: AdsResponse, version: string): GoogleAdsError {
  const detail = json.error?.details?.find((d) => d.errors?.length)?.errors?.[0];
  const [kind, code] = Object.entries(detail?.errorCode ?? {})[0] ?? ["", ""];
  const message = detail?.message ?? json.error?.message ?? "Unknown error";
  logger.error("google ads api error", { status, kind, code, message });

  if (code === "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION") {
    return new GoogleAdsError(
      "Your Google Ads developer token isn't approved for keyword planning. Test and Explorer access don't include KeywordPlanIdeaService — apply for Basic access in the manager account's API Center and try again once approved.",
    );
  }
  if (code.startsWith("DEVELOPER_TOKEN")) {
    return new GoogleAdsError(
      `Google Ads developer token problem (${code}). A token with only Test access can't return real keyword data — apply for Basic access in the Google Ads API Center.`,
    );
  }
  if (code === "USER_PERMISSION_DENIED") {
    return new GoogleAdsError(
      "Google Ads permission denied. If the account is managed by a manager (MCC) account, set GOOGLE_ADS_LOGIN_CUSTOMER_ID to the manager account ID.",
    );
  }
  if (code === "CUSTOMER_NOT_ENABLED") {
    return new GoogleAdsError(
      "The Google Ads account in GOOGLE_ADS_CUSTOMER_ID is not enabled. Finish its setup in Google Ads (including billing details), or use a different enabled account.",
    );
  }
  if (kind === "authenticationError" || status === 401) {
    return new GoogleAdsError(`Google Ads authentication failed: ${message}`);
  }
  if (kind === "quotaError" || status === 429) {
    return new GoogleAdsError("Google Ads API rate limit reached. Try again in a few minutes.");
  }
  if (kind === "criterionError" || /geo|language/i.test(message)) {
    return new GoogleAdsError(`Google Ads rejected the country/language settings: ${message}`);
  }
  if (status === 404) {
    return new GoogleAdsError(
      `Google Ads API endpoint not found. Check GOOGLE_ADS_CUSTOMER_ID and that API version ${version} is still supported (GOOGLE_ADS_API_VERSION).`,
    );
  }
  return new GoogleAdsError(`Google Ads API error (${status}): ${message}`);
}

function toNumber(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function micros(v: string | undefined): number | null {
  const n = toNumber(v);
  return n == null ? null : Math.round(n / 10_000) / 100;
}
