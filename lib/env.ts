import { z } from "zod";

/** Optional string: empty values in .env files count as unset. */
const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-6"),
  CRAWL_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(25),
  /** Full-site crawl: max pages stored per project, and pages crawled per request */
  CRAWL_MAX_SITE_PAGES: z.coerce.number().int().min(25).max(5000).default(1000),
  CRAWL_BATCH_SIZE: z.coerce.number().int().min(5).max(50).default(20),
  ENABLE_PLAYWRIGHT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Module 02 — optional so Module 01 works without them; checked when keyword research runs.
  KEYWORD_DATA_PROVIDER: z.enum(["serper", "dataforseo", "google_ads"]).default("serper"),
  DATAFORSEO_LOGIN: optional,
  DATAFORSEO_PASSWORD: optional,
  GOOGLE_ADS_DEVELOPER_TOKEN: optional,
  GOOGLE_ADS_CLIENT_ID: optional,
  GOOGLE_ADS_CLIENT_SECRET: optional,
  GOOGLE_ADS_REFRESH_TOKEN: optional,
  GOOGLE_ADS_CUSTOMER_ID: optional.transform((v) => v?.replace(/-/g, "")),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: optional.transform((v) => v?.replace(/-/g, "")),
  GOOGLE_ADS_API_VERSION: z.string().default("v25"),
  SERPER_API_KEY: optional,
  SERPER_DISCOVERY_MAX_QUERIES: z.coerce.number().int().min(10).max(500).default(120),
  SERP_CHECK_LIMIT: z.coerce.number().int().min(0).max(50).default(30),
  KEYWORD_MAX_PER_PROJECT: z.coerce.number().int().min(100).max(5000).default(2000),
  KEYWORD_RESEARCH_TTL_DAYS: z.coerce.number().min(0).default(7),

  // Module 03 — competitor discovery
  COMPETITOR_MAX_QUERIES: z.coerce.number().int().min(3).max(10).default(8),
  COMPETITOR_MAX_CANDIDATES: z.coerce.number().int().min(5).max(20).default(18),
  COMPETITOR_MAX_FINAL: z.coerce.number().int().min(3).max(15).default(10),
  COMPETITOR_TTL_DAYS: z.coerce.number().min(0).default(7),
  // Module 05 — articles: top-ranking pages read per brief
  ARTICLE_RESEARCH_PAGES: z.coerce.number().int().min(0).max(8).default(5),
  /** Hard maximum article length (words, including FAQ) for generation and optimization */
  ARTICLE_MAX_WORDS: z.coerce.number().int().min(500).max(5000).default(2000),
  /** Minimum article length (words, including FAQ): short drafts are expanded, revisions may not go below it */
  ARTICLE_MIN_WORDS: z.coerce.number().int().min(300).max(5000).default(1500),

  // Module 08 — featured images (OpenAI Image API → Cloudflare R2)
  OPENAI_API_KEY: optional,
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2"),
  OPENAI_IMAGE_QUALITY: z.enum(["low", "medium", "high"]).default("medium"),
  R2_ACCOUNT_ID: optional,
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET: optional,
  /** Public base URL of the bucket (r2.dev subdomain or custom domain), no trailing slash */
  R2_PUBLIC_BASE_URL: optional.transform((v) => v?.replace(/\/+$/, "")),

  // Module 09 — quality targets and improvement loop
  QUALITY_TARGET_SEO: z.coerce.number().int().min(0).max(100).default(90),
  QUALITY_TARGET_GEO: z.coerce.number().int().min(0).max(100).default(85),
  QUALITY_TARGET_AEO: z.coerce.number().int().min(0).max(100).default(90),
  QUALITY_MAX_ROUNDS: z.coerce.number().int().min(1).max(5).default(3),
  /** Independent judge for the few AI-graded criteria — deliberately a different model than the writer */
  QUALITY_JUDGE_MODEL: z.string().default("claude-opus-5-5"),
  /** Judge runs for the final grade; the median of the votes is used (1 = single run) */
  QUALITY_JUDGE_VOTES: z.coerce.number().int().min(1).max(5).default(3),

  // Full automation: secret for the cron/tick endpoint, and how often the strategy is rebuilt
  CRON_SECRET: optional,
  AUTO_STRATEGY_REFRESH_DAYS: z.coerce.number().min(1).max(90).default(20),
  /** Automation: optimize + score an article this many days after publishing (0 = before publishing) */
  AUTO_OPTIMIZE_AFTER_DAYS: z.coerce.number().min(0).max(365).default(20),

  // Module 04 — content gap & strategy
  STRATEGY_MAX_TOPICS: z.coerce.number().int().min(5).max(60).default(25),
  STRATEGY_MAX_OPPORTUNITIES: z.coerce.number().int().min(3).max(40).default(20),

  /** Extra domains to ignore, comma-separated (added to the built-in list) */
  COMPETITOR_IGNORE_DOMAINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validated server env. Read lazily so `next build` works without secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}
