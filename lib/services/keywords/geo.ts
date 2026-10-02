// Google Ads geo target and language constant IDs for the countries/languages offered in the UI.
// Full lists: https://developers.google.com/google-ads/api/data/geotargets and .../codes-formats#languages

const GEO_TARGETS: Record<string, number> = {
  AU: 2036,
  US: 2840,
  GB: 2826,
  CA: 2124,
  NZ: 2554,
  IE: 2372,
  IN: 2356,
  SG: 2702,
  ZA: 2710,
  DE: 2276,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
};

const LANGUAGES: Record<string, number> = {
  en: 1000,
  de: 1001,
  fr: 1002,
  es: 1003,
  it: 1004,
  ja: 1005,
  nl: 1010,
  pt: 1014,
};

/** Google Ads geo target ID — DataForSEO uses the same IDs as its location_code. */
export function geoTargetId(country: string): number {
  const id = GEO_TARGETS[country.toUpperCase()];
  if (!id) throw new Error(`Keyword research does not support country "${country}" yet`);
  return id;
}

/** Validates the language and returns its lowercase ISO code (DataForSEO language_code). */
export function languageCode(language: string): string {
  const code = language.toLowerCase();
  if (!LANGUAGES[code]) throw new Error(`Keyword research does not support language "${language}" yet`);
  return code;
}

export function geoTargetConstant(country: string): string {
  return `geoTargetConstants/${geoTargetId(country)}`;
}

export function languageConstant(language: string): string {
  return `languageConstants/${LANGUAGES[languageCode(language)]}`;
}

/** Google's `gl` search parameter (Serper) — the UK uses "uk", not "gb". */
export function serpCountryCode(country: string): string {
  const c = country.toLowerCase();
  return c === "gb" ? "uk" : c;
}
