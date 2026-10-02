import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type { SerpResult } from "@/lib/types";
import { serpCountryCode } from "./geo";

export interface SerpData {
  organic: SerpResult[];
  /** "People also ask" questions and related searches — absent in SERPs cached before Module 05 */
  peopleAlsoAsk?: string[];
  relatedSearches?: string[];
}

/** `fatal` errors (bad key, no credits) mean every further call will fail too. */
export class SerperError extends Error {
  constructor(
    message: string,
    public fatal: boolean,
  ) {
    super(message);
  }
}

const CACHE_DAYS = 7;
/** Autocomplete results share the cache table; their key is prefixed so they never clash with SERPs. */
const AUTOCOMPLETE_PREFIX = "autocomplete:";

export function serperConfigured(): boolean {
  return Boolean(env().SERPER_API_KEY);
}

/**
 * Top 10 organic Google results for a keyword, from the 7-day cache when possible.
 * `withQuestions` refetches cached SERPs saved before questions were stored.
 */
export async function getSerp(
  keyword: string,
  country: string,
  language: string,
  options: { withQuestions?: boolean } = {},
): Promise<SerpData> {
  const accept = options.withQuestions ? (d: SerpData) => Array.isArray(d.peopleAlsoAsk) : undefined;
  return cached(keyword, country, language, accept, async () => {
    const json = await serperRequest<{
      organic?: { title?: string; link?: string; snippet?: string; position?: number }[];
      peopleAlsoAsk?: { question?: string }[];
      relatedSearches?: { query?: string }[];
    }>("search", {
      q: keyword,
      gl: serpCountryCode(country),
      hl: language,
      num: 10,
    });
    const organic: SerpResult[] = (json.organic ?? [])
      .filter((r) => r.link)
      .slice(0, 10)
      .map((r, i) => ({
        position: r.position ?? i + 1,
        title: r.title ?? "",
        link: r.link!,
        domain: safeDomain(r.link!),
        snippet: r.snippet ?? "",
      }));
    return {
      organic,
      peopleAlsoAsk: (json.peopleAlsoAsk ?? []).map((q) => q.question ?? "").filter(Boolean),
      relatedSearches: (json.relatedSearches ?? []).map((r) => r.query ?? "").filter(Boolean),
    };
  });
}

/** Google autocomplete suggestions for a query, in Google's order (most popular first). Cached 7 days. */
export async function getAutocomplete(query: string, country: string, language: string): Promise<string[]> {
  const data = await cached(`${AUTOCOMPLETE_PREFIX}${query}`, country, language, undefined, async () => {
    const json = await serperRequest<{ suggestions?: { value?: string; subtitle?: string }[] }>("autocomplete", {
      q: query,
      gl: serpCountryCode(country),
      hl: language,
    });
    // Entries with a subtitle are AI-style prompts ("Recommend AI receptionist features…"), not searches.
    const suggestions = (json.suggestions ?? []).filter((s) => s.value && !s.subtitle).map((s) => s.value!);
    return { suggestions };
  });
  return data.suggestions;
}

async function serperRequest<T>(endpoint: "search" | "autocomplete", body: Record<string, unknown>): Promise<T> {
  const apiKey = env().SERPER_API_KEY;
  if (!apiKey) throw new SerperError("SERPER_API_KEY is not set", true);

  let res: Response;
  try {
    res = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new SerperError(`Could not reach Serper: ${errorMessage(err)}`, false);
  }

  if (res.status === 401 || res.status === 403) throw new SerperError("Serper rejected the API key (SERPER_API_KEY)", true);
  if (res.status === 402) throw new SerperError("Serper account is out of credits", true);
  if (res.status === 429) throw new SerperError("Serper rate limit reached", true);
  if (!res.ok) throw new SerperError(`Serper error (${res.status})`, false);
  return (await res.json()) as T;
}

async function cached<T>(
  key: string,
  country: string,
  language: string,
  accept: ((cached: T) => boolean) | undefined,
  fetcher: () => Promise<T>,
): Promise<T> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("keyword_serp_cache")
    .select("serp_data")
    .eq("keyword", key)
    .eq("country", country)
    .eq("language", language)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) logger.warn("serper cache read failed", { key, error: error.message });
  if (data?.serp_data && (!accept || accept(data.serp_data as T))) return data.serp_data as T;

  const fresh = await fetcher();
  const now = new Date();
  const { error: writeError } = await db.from("keyword_serp_cache").upsert(
    {
      keyword: key,
      country,
      language,
      serp_data: fresh,
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + CACHE_DAYS * 86_400_000).toISOString(),
    },
    { onConflict: "keyword,country,language" },
  );
  if (writeError) logger.warn("serper cache write failed", { key, error: writeError.message });
  return fresh;
}

function safeDomain(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
