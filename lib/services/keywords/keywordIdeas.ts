import { env } from "@/lib/env";
import { generateKeywordIdeasDataForSeo } from "./dataForSeo";
import { generateKeywordIdeas as generateKeywordIdeasGoogleAds, type KeywordIdea } from "./googleAds";
import { generateKeywordIdeasSerper } from "./serperDiscovery";

export type KeywordDataProvider = "serper" | "dataforseo" | "google_ads";

/**
 * Keyword ideas from the provider set in KEYWORD_DATA_PROVIDER:
 *   serper      — Google autocomplete discovery, estimated demand only (no volume/CPC)
 *   dataforseo  — Google Ads volume, competition, CPC (USD)
 *   google_ads  — Google Ads API directly (needs Basic access)
 */
export async function getKeywordIdeas(input: {
  seeds: string[];
  url: string;
  country: string;
  language: string;
}): Promise<{ provider: KeywordDataProvider; ideas: KeywordIdea[] }> {
  const provider = env().KEYWORD_DATA_PROVIDER;
  const ideas =
    provider === "google_ads"
      ? await generateKeywordIdeasGoogleAds(input)
      : provider === "dataforseo"
        ? await generateKeywordIdeasDataForSeo(input)
        : await generateKeywordIdeasSerper(input);
  return { provider, ideas };
}
