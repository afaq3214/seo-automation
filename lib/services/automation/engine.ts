import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type { ArticleRow, ContentOpportunity, Project } from "@/lib/types";
import { prepareArticle, writePreparedArticle } from "../articles/generate";
import { optimizeArticle } from "../articles/optimize";
import { runQualityLoop } from "../articles/quality";
import { getArticle, updatePublishing } from "../articles/repository";
import { discoverCompetitors } from "../competitors/discover";
import { crawlPendingBatch, pageCounts, queueSitemapPages } from "../crawler/fullCrawl";
import { generateArticleImage } from "../images/featured";
import { researchKeywords } from "../keywords/research";
import { getProject, updateProject } from "../projects";
import { articlesDueForIndexCheck, checkIndexStatus, searchConsoleConfigured, submitSitemap } from "../searchConsole";
import { generateStrategy } from "../strategy/generate";
import { jaccard, tokenSet } from "../keywords/text";
import { loadSitePages, topicCoverage } from "../strategy/coverage";
import { listOpportunities } from "../strategy/repository";

/**
 * Full automation, one step per call. Each step fits in a single serverless invocation (≤ 5 min), its
 * progress lives in the database, and the next call works out what's due from there:
 *
 *   site crawl → keywords → competitors → strategy → (daily) write → optimize → images → quality → publish
 *
 * The strategy (keywords + competitors + opportunities) is rebuilt every AUTO_STRATEGY_REFRESH_DAYS, and
 * each day's article is the best-scoring opportunity that hasn't been written yet.
 */
export type AutoStep =
  | "crawl_queue"
  | "crawl_batch"
  | "keywords"
  | "competitors"
  | "strategy"
  | "brief"
  | "write"
  | "optimize"
  | "image_featured"
  | "image_inline"
  | "quality"
  | "publish"
  | "index_check";

export const STEP_LABELS: Record<AutoStep, string> = {
  crawl_queue: "Finding all site pages",
  crawl_batch: "Crawling site pages",
  keywords: "Keyword research",
  competitors: "Competitor analysis",
  strategy: "Content strategy",
  brief: "Researching and planning today's article",
  write: "Writing today's article",
  optimize: "SEO/GEO/AEO optimization",
  image_featured: "Featured image",
  image_inline: "Mid-article image",
  quality: "Quality scoring & improvement",
  publish: "Publishing",
  index_check: "Checking Google index status",
};

/** A step that runs longer than this is assumed dead (the function timed out) and may be retried. */
const LEASE_MS = 6 * 60_000;
const MAX_ATTEMPTS = 3;
/** Daily posts: a little under 24h so a once-a-day cron always finds the next one due. */
const POST_INTERVAL_MS = 22 * 3_600_000;
/** Content types that make a blog post (landing pages are left to the user). */
const BLOG_TYPES = new Set(["blog_post", "guide", "comparison", "listicle", "faq"]);

const DAY_MS = 86_400_000;
const olderThan = (iso: string | null, ms: number) => !iso || Date.now() - Date.parse(iso) > ms;

/** What this project needs next, or null when nothing is due right now. */
export async function nextStep(project: Project): Promise<{ step: AutoStep; article?: ArticleRow; opportunity?: ContentOpportunity } | null> {
  if (!project.analysis || project.status !== "complete") return null;
  const cfg = env();

  // 1. Finish the article in progress first.
  if (project.auto_article_id) {
    const article = await getArticle(project.id, project.auto_article_id);
    if (article && article.status !== "published") {
      // With AUTO_OPTIMIZE_AFTER_DAYS > 0 the article is published as written and optimized later (step 5).
      const optimizeFirst = cfg.AUTO_OPTIMIZE_AFTER_DAYS === 0;
      if (optimizeFirst && !article.optimized_at) return { step: "optimize", article };
      if (cfg.OPENAI_API_KEY && ["none", "generating"].includes(article.featured_image_status)) return { step: "image_featured", article };
      if (cfg.OPENAI_API_KEY && ["none", "generating"].includes(article.inline_image_status ?? "none")) return { step: "image_inline", article };
      if (optimizeFirst && !article.quality_checked_at) return { step: "quality", article };
      return { step: "publish", article };
    }
    await updateProject(project.id, { auto_article_id: null });
  }

  // 2. Whole site crawled (for internal links and to know which topics already have a page). The sitemap
  // is read again on every refresh so pages added since then are picked up.
  const refreshMs = cfg.AUTO_STRATEGY_REFRESH_DAYS * DAY_MS;
  if (olderThan(project.auto_pages_queued_at, refreshMs)) return { step: "crawl_queue" };
  if ((await pageCounts(project.id)).pending > 0) return { step: "crawl_batch" };

  // 3. Strategy inputs, refreshed on schedule.
  const strategyStale = olderThan(project.strategy_generated_at, refreshMs);
  if (!project.keywords_researched_at || (strategyStale && olderThan(project.keywords_researched_at, refreshMs))) return { step: "keywords" };
  if (olderThan(project.competitors_discovered_at, refreshMs)) return { step: "competitors" };
  if (strategyStale || Date.parse(project.keywords_researched_at) > Date.parse(project.strategy_generated_at!)) return { step: "strategy" };

  // 4. Today's article.
  const postDue = !project.auto_next_post_at || Date.parse(project.auto_next_post_at) <= Date.now();
  const opportunity = postDue ? await bestOpportunity(project) : null;
  // Two steps so each fits in one run: research + brief first, then the article from the saved brief.
  if (opportunity) return { step: opportunity.brief_json && opportunity.research_json ? "write" : "brief", opportunity };

  // 5. Published articles that reached the optimization age: optimize, then score.
  if (cfg.AUTO_OPTIMIZE_AFTER_DAYS > 0) {
    const article = await dueForOptimization(project.id, cfg.AUTO_OPTIMIZE_AFTER_DAYS);
    if (article) return { step: article.optimized_at ? "quality" : "optimize", article };
  }

  // 6. Google index status of published articles (when Search Console is connected).
  if ((await articlesDueForIndexCheck(project.id)).length) return { step: "index_check" };

  if (!postDue) return null;
  // Every topic is written: rebuild the strategy, and if that finds nothing new, refresh the keywords
  // early (each at most once a day) so daily posting doesn't stop until the next scheduled refresh.
  if (olderThan(project.strategy_generated_at, DAY_MS)) return { step: "strategy" };
  if (olderThan(project.keywords_researched_at, DAY_MS)) return { step: "keywords" };
  return null;
}

/** The oldest published article that is old enough and hasn't been optimized and scored yet. */
async function dueForOptimization(projectId: string, afterDays: number): Promise<ArticleRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("articles")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "published")
    .lt("publish_at", new Date(Date.now() - afterDays * DAY_MS).toISOString())
    .or("optimized_at.is.null,quality_checked_at.is.null")
    .order("publish_at")
    .limit(1);
  if (error) throw new Error(`Failed to load articles due for optimization: ${error.message}`);
  return ((data ?? [])[0] as ArticleRow | undefined) ?? null;
}

/** Two topics are the same when their main words overlap this much (Jaccard, stop words ignored). */
const SAME_TOPIC = 0.6;

/**
 * The highest-scoring blog opportunity that hasn't been written yet AND isn't already covered: by an
 * article this project wrote (any status), or by a page found in the site crawl. Covered topics are
 * dismissed so they aren't considered again.
 */
async function bestOpportunity(project: Project): Promise<ContentOpportunity | null> {
  const projectId = project.id;
  const candidates = (await listOpportunities(projectId)).filter((o) => o.status === "new" && BLOG_TYPES.has(o.content_type));
  if (!candidates.length) return null;

  const db = supabaseAdmin();
  const [{ data: articles, error }, pages] = await Promise.all([
    db.from("articles").select("title,primary_keyword").eq("project_id", projectId),
    // Crawled pages plus the live sitemap, so posts added to the site since the last crawl are known too.
    loadSitePages(projectId, project.url),
  ]);
  if (error) throw new Error(`Failed to load articles: ${error.message}`);
  const written = (articles ?? []).map((a) => ({ title: a.title as string, keyword: tokenSet(a.primary_keyword), heading: tokenSet(a.title) }));

  for (const o of candidates) {
    const keyword = tokenSet(o.primary_keyword);
    const topic = tokenSet(o.topic);
    const article = written.find((a) => jaccard(keyword, a.keyword) >= SAME_TOPIC || jaccard(topic, a.heading) >= SAME_TOPIC);
    const page = article ? null : topicCoverage([o.primary_keyword], pages);
    const coveredBy = article ? `the article "${article.title}"` : page?.level === "covered" ? page.pageUrl : null;
    if (!coveredBy) return o;

    await db.from("content_opportunities").update({ status: "dismissed", updated_at: new Date().toISOString() }).eq("id", o.id);
    await logEvent(projectId, "write", "info", `Skipped topic "${o.topic}": already covered by ${coveredBy}.`);
  }
  return null;
}

/**
 * Pick one project with due work, lease it, run its next step and record the outcome.
 * Returns false when no project had anything to do.
 */
export async function runOneStep(): Promise<boolean> {
  for (const project of await availableProjects()) {
    let next;
    try {
      next = await nextStep(project);
    } catch (err) {
      logger.error("automation: planning failed", { projectId: project.id, error: errorMessage(err) });
      continue;
    }
    if (!next) continue;
    if (!(await claim(project))) continue; // another run got it first

    // Plan again from fresh data now that we hold the lock: another run may have just finished a step
    // (e.g. published today's article), and acting on the earlier snapshot would repeat work.
    const fresh = await getProject(project.id);
    const confirmed = fresh?.auto_enabled ? await nextStep(fresh).catch(() => null) : null;
    if (!fresh || !confirmed) {
      await updateProject(project.id, { auto_locked_until: null });
      continue;
    }
    await execute(fresh, confirmed);
    return true;
  }
  return false;
}

/** Whether any automated project has work due now (decides whether to chain another run). */
export async function hasDueWork(): Promise<boolean> {
  for (const project of await availableProjects()) {
    if (await nextStep(project).catch(() => null)) return true;
  }
  return false;
}

/** Automated projects that aren't locked by a running step or waiting after a failure, least recently run first. */
async function availableProjects(): Promise<Project[]> {
  const { data, error } = await supabaseAdmin().from("projects").select("*").eq("auto_enabled", true);
  if (error) throw new Error(`Failed to load automated projects: ${error.message}`);
  const now = Date.now();
  const free = (iso: string | null) => !iso || Date.parse(iso) < now;
  return ((data ?? []) as Project[])
    .filter((p) => free(p.auto_locked_until) && free(p.auto_retry_at))
    .sort((a, b) => (a.auto_last_run_at ?? "").localeCompare(b.auto_last_run_at ?? ""));
}

async function claim(project: Project): Promise<boolean> {
  const now = new Date();
  const { data } = await supabaseAdmin()
    .from("projects")
    .update({ auto_locked_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", project.id)
    .or(`auto_locked_until.is.null,auto_locked_until.lt.${now.toISOString()}`)
    .select("id");
  return !!data?.length;
}

async function execute(project: Project, next: NonNullable<Awaited<ReturnType<typeof nextStep>>>) {
  const { step } = next;
  // Attempts count before running, so a step that keeps timing out is still caught.
  const attempts = project.auto_step === step ? project.auto_attempts + 1 : 1;
  await updateProject(project.id, { auto_step: step, auto_attempts: attempts, auto_last_run_at: new Date().toISOString() });

  if (attempts > MAX_ATTEMPTS) {
    await giveUp(project, next, `${STEP_LABELS[step]} failed ${MAX_ATTEMPTS} times`);
    return;
  }

  const started = Date.now();
  logger.info("automation step", { projectId: project.id, step, attempts });
  try {
    const message = await runStep(project, next);
    await updateProject(project.id, { auto_attempts: 0, auto_error: null, auto_retry_at: null, auto_locked_until: null });
    if (message) await logEvent(project.id, step, "info", message);
    logger.info("automation step done", { projectId: project.id, step, ms: Date.now() - started });
  } catch (err) {
    const message = errorMessage(err);
    logger.error("automation step failed", { projectId: project.id, step, attempts, error: message });
    await logEvent(project.id, step, "error", `${STEP_LABELS[step]} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${message}`);
    await updateProject(project.id, {
      auto_error: message,
      auto_retry_at: new Date(Date.now() + 15 * 60_000 * attempts).toISOString(),
      auto_locked_until: null,
    });
  }
}

/** Runs the step; returns a log message for the activity feed (or null for routine steps). */
async function runStep(project: Project, next: NonNullable<Awaited<ReturnType<typeof nextStep>>>): Promise<string | null> {
  const noop = () => {};
  const id = project.id;
  switch (next.step) {
    case "crawl_queue": {
      const { queued, sitemapUrls } = await queueSitemapPages(project);
      await updateProject(id, { auto_pages_queued_at: new Date().toISOString() });
      return `Found ${sitemapUrls} sitemap URLs, ${queued} new pages queued for crawling.`;
    }
    case "crawl_batch": {
      await crawlPendingBatch(id);
      const counts = await pageCounts(id);
      return counts.pending === 0 ? `Site crawl finished: ${counts.crawled} pages crawled, ${counts.failed} failed.` : null;
    }
    case "keywords":
      await researchKeywords(id, { refresh: true }, noop);
      return "Keyword research refreshed.";
    case "competitors":
      await discoverCompetitors(id, { refresh: true }, noop);
      return "Competitor analysis refreshed.";
    case "strategy": {
      await generateStrategy(id, noop);
      const list = await listOpportunities(id);
      const open = list.filter((o) => o.status === "new" && BLOG_TYPES.has(o.content_type));
      return `Strategy refreshed: ${open.length} blog opportunities${open[0] ? `, best is "${open[0].topic}" (score ${open[0].opportunity_score})` : ""}.`;
    }
    case "brief": {
      const opportunity = next.opportunity!;
      const prepared = await prepareArticle(project, opportunity, noop);
      const { error } = await supabaseAdmin()
        .from("content_opportunities")
        .update({ brief_json: prepared.brief, research_json: prepared.research })
        .eq("id", opportunity.id);
      if (!error) return null;
      // Migration 014 not run yet: nowhere to keep the brief, so write the article in this same step.
      logger.warn("prepared brief not saved, writing in one step", { error: error.message });
      const article = await writePreparedArticle(project, opportunity, prepared, noop);
      await updateProject(id, { auto_article_id: article.id });
      return `Writing "${opportunity.topic}" (keyword "${opportunity.primary_keyword}", score ${opportunity.opportunity_score}).`;
    }
    case "write": {
      const opportunity = next.opportunity!;
      const article = await writePreparedArticle(project, opportunity, { brief: opportunity.brief_json!, research: opportunity.research_json! }, noop);
      await updateProject(id, { auto_article_id: article.id });
      return `Writing "${opportunity.topic}" (keyword "${opportunity.primary_keyword}", score ${opportunity.opportunity_score}).`;
    }
    case "optimize":
      await optimizeArticle(id, next.article!.id, noop);
      return next.article!.status === "published" ? `Optimized "${next.article!.title}" (published ${env().AUTO_OPTIMIZE_AFTER_DAYS}+ days ago).` : null;
    case "image_featured":
    case "image_inline": {
      const slot = next.step === "image_featured" ? "featured" : "inline";
      const updated = await generateArticleImage(id, next.article!.id, slot);
      // A failed image never blocks publishing: the status is "failed" and the pipeline moves on.
      const status = updated[`${slot}_image_status`];
      return status === "failed" ? `${STEP_LABELS[next.step]} failed, publishing without it: ${updated[`${slot}_image_error`]}` : null;
    }
    case "quality": {
      await runQualityLoop(id, next.article!.id, noop);
      if (next.article!.status !== "published") return null;
      const scored = await getArticle(id, next.article!.id);
      return `Scored "${next.article!.title}": SEO ${scored?.seo_score}, GEO ${scored?.geo_score}, AEO ${scored?.aeo_score}.`;
    }
    case "publish": {
      const article = await updatePublishing(id, next.article!.id, { status: "published" });
      await updateProject(id, { auto_article_id: null, auto_next_post_at: new Date(Date.now() + POST_INTERVAL_MS).toISOString() });
      // Tell Google the sitemap changed so the new post is discovered sooner (best effort).
      let sitemapNote = "";
      if (searchConsoleConfigured()) {
        try {
          sitemapNote = ` Sitemap ${await submitSitemap(project)} re-submitted to Google.`;
        } catch (err) {
          sitemapNote = ` Sitemap not submitted to Google: ${errorMessage(err)}.`;
        }
      }
      const scores = article?.seo_score != null ? ` (SEO ${article.seo_score}, GEO ${article.geo_score}, AEO ${article.aeo_score})` : "";
      return `Published "${article?.title ?? next.article!.title}"${scores}.${sitemapNote}`;
    }
    case "index_check":
      return checkIndexStatus(project);
  }
}

/** Errors caused by the AI account or provider, not by the topic being written. */
const ACCOUNT_PROBLEM = /out of credit|credits|API key|rate limit|overloaded|unavailable|did not respond|not set|model not found/i;

/** A step failed too often: skip what can be skipped, otherwise pause the project until tomorrow. */
async function giveUp(project: Project, next: NonNullable<Awaited<ReturnType<typeof nextStep>>>, reason: string) {
  const db = supabaseAdmin();
  if ((next.step === "image_featured" || next.step === "image_inline") && next.article) {
    const slot = next.step === "image_featured" ? "featured" : "inline";
    await db.from("articles").update({ [`${slot}_image_status`]: "failed", [`${slot}_image_error`]: reason }).eq("id", next.article.id);
    await logEvent(project.id, next.step, "error", `${reason}. Skipped; the article is published without it.`);
    await updateProject(project.id, { auto_attempts: 0, auto_locked_until: null });
    return;
  }
  if ((next.step === "optimize" || next.step === "quality") && next.article?.status === "published") {
    // Late optimization of a live article: leave it as it is rather than block the daily posts.
    const now = new Date().toISOString();
    await db.from("articles").update({ optimized_at: next.article.optimized_at ?? now, quality_checked_at: now }).eq("id", next.article.id);
    await logEvent(project.id, next.step, "error", `${reason}. Skipped for "${next.article.title}".`);
    await updateProject(project.id, { auto_attempts: 0, auto_locked_until: null });
    return;
  }
  if ((next.step === "write" || next.step === "brief") && next.opportunity && ACCOUNT_PROBLEM.test(project.auto_error ?? "")) {
    // Out of credits, a bad key or the provider being down says nothing about the topic: keep it and wait.
    await logEvent(project.id, next.step, "error", `${reason}: ${project.auto_error}. The topic is kept; trying again in 6 hours.`);
    await updateProject(project.id, { auto_attempts: 0, auto_retry_at: new Date(Date.now() + 6 * 3_600_000).toISOString(), auto_locked_until: null });
    return;
  }
  if ((next.step === "write" || next.step === "brief") && next.opportunity) {
    // Don't get stuck on one topic: move on to the next opportunity.
    await db.from("content_opportunities").update({ status: "dismissed" }).eq("id", next.opportunity.id);
    await logEvent(project.id, next.step, "error", `${reason}. Skipped topic "${next.opportunity.topic}".`);
    await updateProject(project.id, { auto_attempts: 0, auto_locked_until: null });
    return;
  }
  if (next.step === "crawl_batch") {
    // Leave pages that keep failing for the manual Pages tab.
    await db.from("project_pages").update({ crawl_status: "failed", crawl_error: reason }).eq("project_id", project.id).eq("crawl_status", "pending");
    await updateProject(project.id, { auto_attempts: 0, auto_locked_until: null });
    return;
  }
  await logEvent(project.id, next.step, "error", `${reason}. Paused for 12 hours; it will try again after that.`);
  await updateProject(project.id, {
    auto_error: reason,
    auto_attempts: 0,
    auto_retry_at: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    auto_locked_until: null,
  });
}

export async function logEvent(projectId: string, step: string, level: "info" | "error", message: string) {
  const { error } = await supabaseAdmin().from("automation_events").insert({ project_id: projectId, step, level, message: message.slice(0, 1000) });
  if (error) logger.warn("automation event not saved", { error: error.message });
}

export async function listEvents(projectId: string, limit = 20) {
  const { data, error } = await supabaseAdmin()
    .from("automation_events")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load automation activity: ${error.message}`);
  return data ?? [];
}

/** Turn automation on/off, or make work due now ("run" clears a failure wait, "post_now" makes today's article due). */
export async function setAutomation(projectId: string, action: "enable" | "disable" | "run" | "post_now"): Promise<Project> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (action === "disable") {
    await logEvent(projectId, "control", "info", "Automation turned off.");
    return updateProject(projectId, { auto_enabled: false });
  }
  if (action === "enable" && !project.auto_enabled) await logEvent(projectId, "control", "info", "Automation turned on.");
  return updateProject(projectId, {
    auto_enabled: true,
    auto_retry_at: null,
    auto_error: null,
    ...(action === "post_now" && { auto_next_post_at: null }),
  });
}
