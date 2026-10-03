// Types shared between the API route and the browser. Keep this file free of server imports.

export type ProjectStatus = "pending" | "crawling" | "analyzing" | "complete" | "failed";

export interface BusinessAnalysis {
  businessType: string;
  mainOfferings: string[];
  targetCustomer: string;
  likelyIndustries: string[];
  importantTopics: string[];
  businessSummary: string;
}

export interface Project {
  id: string;
  url: string;
  domain: string;
  country: string;
  language: string;
  status: ProjectStatus;
  error: string | null;
  robots_found: boolean;
  sitemap_url: string | null;
  pages_crawled: number;
  analysis: BusinessAnalysis | null;
  analyzed_at: string | null;
  keywords_status: KeywordsStatus;
  keywords_error: string | null;
  keywords_started_at: string | null;
  keywords_researched_at: string | null;
  keyword_seeds: string[];
  competitors_status: KeywordsStatus;
  competitors_error: string | null;
  competitors_started_at: string | null;
  competitors_discovered_at: string | null;
  competitor_queries: string[];
  strategy_status: KeywordsStatus;
  strategy_error: string | null;
  strategy_started_at: string | null;
  strategy_generated_at: string | null;
  /** Public identifier for the blog API (?site=SITE_KEY) */
  site_key: string;
  /** Where the blog lives, e.g. https://callacy.com/blog — defaults to <site>/blog */
  blog_base_url: string | null;
  /** Full automation (migration 012) */
  auto_enabled: boolean;
  auto_step: string | null;
  auto_attempts: number;
  auto_error: string | null;
  auto_locked_until: string | null;
  auto_retry_at: string | null;
  auto_article_id: string | null;
  auto_next_post_at: string | null;
  auto_pages_queued_at: string | null;
  auto_last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationEvent {
  id: string;
  project_id: string;
  step: string;
  level: "info" | "error";
  message: string;
  created_at: string;
}

export interface PageSummary {
  url: string;
  title: string | null;
  wordCount: number;
  renderedWith: "fetch" | "playwright";
}

export type AnalyzeStep = "creating" | "reading" | "analyzing" | "complete";

/** Newline-delimited JSON events streamed by POST /api/projects/analyze */
export type AnalyzeEvent =
  | { type: "step"; step: AnalyzeStep; message: string; projectId?: string }
  | { type: "complete"; project: Project; pages: PageSummary[] }
  | { type: "error"; message: string; projectId?: string };

// ---- Module 02: keyword research ----

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational";
export type DifficultyLabel = "Easy" | "Medium" | "Hard" | "Very Hard";
export type DifficultyStatus = "checked" | "pending" | "not_selected";
export type KeywordsStatus = "idle" | "running" | "complete" | "failed";

export interface SerpResult {
  position: number;
  title: string;
  link: string;
  domain: string;
  /** Result description (absent in SERPs cached before Module 03) */
  snippet?: string;
}

/** A row of project_keywords as returned by the API. */
export interface KeywordRow {
  id: string;
  project_id: string;
  keyword: string;
  search_volume: number | null;
  competition: "LOW" | "MEDIUM" | "HIGH" | null;
  competition_index: number | null;
  cpc_low: number | null;
  cpc_high: number | null;
  intent: SearchIntent;
  cluster_name: string;
  is_primary_keyword: boolean;
  relevance_score: number;
  /** 0-1 estimated demand (Serper discovery); null when real search volume is available */
  demand_score: number | null;
  estimated_difficulty: number | null;
  difficulty_label: DifficultyLabel | null;
  difficulty_status: DifficultyStatus;
  opportunity_score: number;
  serp_top10?: SerpResult[] | null;
  serp_checked_at: string | null;
  country: string;
  language: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface KeywordStats {
  totalKeywords: number;
  totalClusters: number;
  easyKeywords: number;
  commercialKeywords: number;
  topOpportunity: { keyword: string; opportunityScore: number } | null;
  /** false when keywords came from Serper discovery (estimated demand instead of volume) */
  hasSearchVolume: boolean;
}

export interface ClusterSummary {
  name: string;
  keywordCount: number;
  totalVolume: number;
}

export type KeywordResearchStep = "seeds" | "ideas" | "processing" | "grouping" | "difficulty" | "complete";

/** Newline-delimited JSON events streamed by POST /api/projects/[projectId]/keywords/research */
export type KeywordResearchEvent =
  | { type: "step"; step: KeywordResearchStep; message: string }
  | { type: "complete"; reused: boolean; stats: KeywordStats; warnings: string[] }
  | { type: "error"; message: string };

// ---- Module 03: competitor discovery ----

export type CompetitorType = "direct" | "adjacent" | "publisher" | "marketplace" | "directory" | "ugc" | "irrelevant";
export type CompetitorStatus = "active" | "pending_review" | "removed";
export type HomepageStatus = "ok" | "rendered" | "blocked" | "failed";

/** A row of project_competitors as returned by the API. */
export interface CompetitorRow {
  id: string;
  project_id: string;
  domain: string;
  homepage_url: string | null;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  nav_labels: string[];
  homepage_status: HomepageStatus;
  competitor_type: CompetitorType | null;
  relevance_score: number | null;
  product_similarity: number | null;
  audience_similarity: number | null;
  serp_appearances: number;
  best_position: number | null;
  competitor_score: number;
  reason: string | null;
  status: CompetitorStatus;
  is_manual: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompetitorSerpAppearance {
  query: string;
  position: number;
  url: string;
  title: string | null;
}

export interface CompetitorStats {
  competitorsFound: number;
  directCompetitors: number;
  adjacentCompetitors: number;
  strongest: { domain: string; competitorScore: number } | null;
}

export type CompetitorStep = "queries" | "searching" | "domains" | "analyzing" | "ranking" | "complete";

/** Newline-delimited JSON events streamed by POST /api/projects/[projectId]/competitors/discover */
export type CompetitorDiscoveryEvent =
  | { type: "step"; step: CompetitorStep; message: string }
  | { type: "complete"; reused: boolean; stats: CompetitorStats; competitors: CompetitorRow[]; warnings: string[] }
  | { type: "error"; message: string };

// ---- Module 04: content gap & SEO strategy ----

export type ContentType = "blog_post" | "guide" | "comparison" | "listicle" | "landing_page" | "faq";
export type OpportunityStatus = "new" | "blog_requested" | "drafted" | "dismissed";

export interface CompetitorRanking {
  domain: string;
  position: number;
  url: string;
  title: string;
}

/** A row of content_opportunities as returned by the API. */
export interface ContentOpportunity {
  id: string;
  project_id: string;
  topic: string;
  primary_keyword: string;
  secondary_keywords: string[];
  content_type: ContentType;
  search_intent: SearchIntent;
  reason: string;
  opportunity_score: number;
  relevance_score: number;
  search_volume: number | null;
  demand_score: number | null;
  estimated_difficulty: number | null;
  competitor_count: number;
  competitor_rankings: CompetitorRanking[];
  existing_page_url: string | null;
  coverage: "none" | "partial";
  status: OpportunityStatus;
  blog_requested_at: string | null;
  created_at: string;
  updated_at: string;
}

export type StrategyStep = "loading" | "rankings" | "coverage" | "scoring" | "writing" | "complete";

/** Newline-delimited JSON events streamed by POST /api/projects/[projectId]/strategy/generate */
export type StrategyEvent =
  | { type: "step"; step: StrategyStep; message: string }
  | { type: "complete"; opportunities: number; warnings: string[] }
  | { type: "error"; message: string };

// ---- Module 05: SERP brief & blog generation ----

export interface ContentBrief {
  searchIntent: SearchIntent;
  targetReader: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  mustCoverTopics: string[];
  commonQuestions: string[];
  differentiatingAngles: string[];
  recommendedWordCount: number;
  outline: { h1: string; sections: { h2: string; h3s: string[]; notes: string }[] };
  ctaIdea: string;
}

export interface SerpResearch {
  keyword: string;
  organic: { position: number; title: string; url: string; snippet: string }[];
  peopleAlsoAsk: string[];
  relatedSearches: string[];
  /** Outlines of top-ranking pages we could crawl (headings only) */
  competitorPages: { url: string; title: string | null; h1: string | null; h2s: string[]; h3s: string[]; wordCount: number }[];
  /** Real-world statistics the article may cite (sentences quoted from these pages) */
  dataSources?: DataSource[];
}

export interface DataSource {
  url: string;
  title: string;
  facts: string[];
}

export type ArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "callout"; text: string };

export interface ArticleContent {
  title: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  intro: string[];
  sections: { heading: string; level: 2 | 3; blocks: ArticleBlock[] }[];
  faq: { question: string; answer: string }[];
  cta: { heading: string; text: string; buttonLabel: string; buttonUrl: string };
}

export type ArticleStatus = "draft" | "ready" | "needs_review" | "approved" | "published";
export type ImageStatus = "none" | "generating" | "ready" | "failed";
/** featured = top of the article · inline = in the middle, next to the section it illustrates */
export type ImageSlot = "featured" | "inline";

export interface ArticleRow {
  id: string;
  project_id: string;
  opportunity_id: string | null;
  title: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  primary_keyword: string;
  secondary_keywords: string[];
  brief: ContentBrief;
  serp_research: SerpResearch;
  content_json: ArticleContent;
  content_html: string;
  word_count: number;
  status: ArticleStatus;
  optimized_json: ArticleContent | null;
  optimized_html: string | null;
  optimized_word_count: number | null;
  optimization_report: OptimizationReport | null;
  optimized_at: string | null;
  featured_image_url: string | null;
  featured_image_alt: string | null;
  featured_image_status: ImageStatus;
  featured_image_error: string | null;
  featured_image_prompt: string | null;
  featured_image_key: string | null;
  featured_image_generated_at: string | null;
  inline_image_url: string | null;
  inline_image_alt: string | null;
  inline_image_status: ImageStatus;
  inline_image_error: string | null;
  inline_image_prompt: string | null;
  inline_image_key: string | null;
  inline_image_heading: string | null;
  inline_image_generated_at: string | null;
  schema_json: Record<string, unknown>[] | null;
  seo_score: number | null;
  geo_score: number | null;
  aeo_score: number | null;
  quality_report: QualityReport | null;
  quality_checked_at: string | null;
  excerpt: string | null;
  canonical_url: string | null;
  faq_json: { question: string; answer: string }[];
  /** Public once status is ready/published and publish_at <= now */
  publish_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ArticleStep = "serp" | "pages" | "data" | "brief" | "writing" | "saving" | "complete";

/** Newline-delimited JSON events streamed by POST /api/projects/[projectId]/articles/generate */
export type ArticleEvent =
  | { type: "step"; step: ArticleStep; message: string }
  | { type: "complete"; article: ArticleRow }
  | { type: "error"; message: string };

// ---- Module 06: SEO / GEO / AEO optimization ----

export type Pillar = "seo" | "geo" | "aeo";
export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  id: string;
  pillar: Pillar;
  label: string;
  status: CheckStatus;
  note: string;
}

/** Rule-based measurements of an article (no AI). */
export interface ArticleMetrics {
  words: number;
  primaryKeywordCount: number;
  primaryKeywordDensity: number; // % of words that belong to exact primary keyword matches
  primaryInTitle: boolean;
  primaryInIntro: boolean;
  primaryInH2: boolean;
  secondaryCoverage: number; // 0-1 share of secondary keywords present
  h2Count: number;
  h3Count: number;
  hierarchyIssues: string[];
  introWords: number;
  avgParagraphWords: number;
  longParagraphs: number; // paragraphs over 80 words
  questionHeadings: number;
  directAnswers: number; // question headings followed by a short (≤60 words) first paragraph
  tables: number;
  faqCount: number;
  longFaqAnswers: number; // FAQ answers over 80 words
  hasCta: boolean;
  internalLinks: number;
}

export interface ArticleEdit {
  target: "intro" | "section" | "insert_after" | "faq" | "cta" | "meta";
  /** Section index for "section"; insert position for "insert_after" (-1 = right after the intro) */
  index: number | null;
  checkIds: string[];
  instruction: string;
}

export interface OptimizationReport {
  checksBefore: CheckResult[];
  checksAfter: CheckResult[];
  scoresBefore: Record<Pillar, number>;
  scoresAfter: Record<Pillar, number>;
  metricsBefore: ArticleMetrics;
  metricsAfter: ArticleMetrics;
  edits: ArticleEdit[];
  /** Planned edits that were actually applied (some can be dropped to respect the word limit) */
  appliedEdits: number;
  note?: string;
  disclaimer: string;
}

export type OptimizeStep = "measuring" | "auditing" | "revising" | "rechecking" | "saving" | "complete";

/** Newline-delimited JSON events streamed by POST /api/projects/[projectId]/articles/[articleId]/optimize */
export type OptimizeEvent =
  | { type: "step"; step: OptimizeStep; message: string }
  | { type: "complete"; report: OptimizationReport }
  | { type: "error"; message: string };

// ---- Module 08/09: featured image + quality loop ----

export interface FeaturedImage {
  url: string;
  alt: string;
  width: number;
  height: number;
}

export interface CriterionResult {
  id: string;
  pillar: Pillar;
  label: string;
  source: "rule" | "ai";
  weight: number;
  status: CheckStatus;
  reason: string;
}

export interface QualityRound {
  round: number;
  scores: Record<Pillar, number>;
  failed: string[];
  editsApplied: number;
  words: number;
  /** The round made scores worse, so its edits were discarded */
  reverted?: boolean;
}

export interface QualityReport {
  targets: Record<Pillar, number>;
  finalScores: Record<Pillar, number>;
  /** Each pillar split into its rule-based part and its independent-judge part (null = none in that pillar) */
  breakdown?: Record<Pillar, { rules: number | null; judge: number | null }>;
  judge?: { model: string; votes: number };
  criteria: CriterionResult[];
  rounds: QualityRound[];
  status: "ready" | "needs_review";
  summary: string;
  disclaimer: string;
}

export type QualityStep = "scoring" | "improving" | "saving" | "complete";

/** Newline-delimited JSON events streamed by POST /api/projects/[projectId]/articles/[articleId]/quality */
export type QualityEvent =
  | { type: "step"; step: QualityStep; message: string }
  | { type: "complete"; report: QualityReport }
  | { type: "error"; message: string };
