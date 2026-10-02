import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type { Project } from "@/lib/types";
import { isSameSite, normalizePageUrl } from "@/lib/url";
import { mapWithConcurrency } from "../keywords/text";
import { crawlPage } from "./crawl";
import { closeBrowser } from "./render";
import { fetchRobots, isAllowedByRobots } from "./robots";
import { dedupeKey, FILE_EXT } from "./select";
import { fetchSitemapUrls } from "./sitemap";

/**
 * Full-site crawl, split into small steps so each request stays well inside serverless time limits:
 *   1. queueSitemapPages  — store every sitemap URL as a "pending" page (cheap, no crawling)
 *   2. crawlPendingBatch  — crawl the next N pending pages; call repeatedly until none are left
 * Pages already crawled by Module 01 are kept and never queued twice.
 */

const CONCURRENCY = 4;
const PAGE = 1000;

export interface PageCounts {
  total: number;
  crawled: number;
  pending: number;
  failed: number;
}

export async function queueSitemapPages(project: Project): Promise<{ queued: number; sitemapUrls: number }> {
  const origin = new URL(project.url).origin;
  const robots = await fetchRobots(origin);
  const { urls } = await fetchSitemapUrls(origin, robots.sitemaps);

  const existing = await existingPageKeys(project.id);
  const room = Math.max(0, env().CRAWL_MAX_SITE_PAGES - existing.size);
  const toQueue: string[] = [];
  for (const raw of urls) {
    if (toQueue.length >= room) break;
    const url = normalizePageUrl(raw);
    if (!url || !isSameSite(url, project.url)) continue;
    if (FILE_EXT.test(new URL(url).pathname) || !isAllowedByRobots(url, robots)) continue;
    const key = dedupeKey(url);
    if (existing.has(key)) continue;
    existing.add(key);
    toQueue.push(url);
  }

  for (let i = 0; i < toQueue.length; i += 500) {
    const rows = toQueue.slice(i, i + 500).map((url) => ({ project_id: project.id, url, crawl_status: "pending" }));
    const { error } = await supabaseAdmin()
      .from("project_pages")
      .upsert(rows, { onConflict: "project_id,url", ignoreDuplicates: true });
    if (error) throw new Error(`Failed to queue pages: ${error.message}`);
  }

  logger.info("sitemap pages queued", { projectId: project.id, sitemapUrls: urls.length, queued: toQueue.length });
  return { queued: toQueue.length, sitemapUrls: urls.length };
}

/** Crawl the next batch of pending pages. Failures are recorded per page and never stop the batch. */
export async function crawlPendingBatch(projectId: string): Promise<{ crawled: number; failed: number }> {
  const { data, error } = await supabaseAdmin()
    .from("project_pages")
    .select("id,url")
    .eq("project_id", projectId)
    .eq("crawl_status", "pending")
    .order("url")
    .limit(env().CRAWL_BATCH_SIZE);
  if (error) throw new Error(`Failed to load pending pages: ${error.message}`);
  const batch = (data ?? []) as { id: string; url: string }[];
  if (!batch.length) return { crawled: 0, failed: 0 };

  let crawled = 0;
  let failed = 0;
  try {
    await mapWithConcurrency(batch, CONCURRENCY, async (row) => {
      const { page, reason } = await crawlPage(row.url);
      const update = page
        ? {
            status_code: page.statusCode,
            title: page.title,
            meta_description: page.metaDescription,
            h1: page.h1,
            h2s: page.h2s,
            h3s: page.h3s,
            canonical: page.canonical,
            body_text: page.bodyText,
            word_count: page.wordCount,
            internal_links: page.internalLinks,
            images: page.images,
            rendered_with: page.renderedWith,
            crawl_status: "crawled",
            crawl_error: null,
            crawled_at: new Date().toISOString(),
          }
        : { crawl_status: "failed", crawl_error: reason ?? "unknown error", crawled_at: new Date().toISOString() };

      const { error: updateError } = await supabaseAdmin().from("project_pages").update(update).eq("id", row.id);
      if (updateError) logger.warn("page update failed", { url: row.url, error: updateError.message });
      if (page) crawled++;
      else failed++;
    });
  } finally {
    await closeBrowser();
  }
  logger.info("crawl batch done", { projectId, crawled, failed });
  return { crawled, failed };
}

export async function pageCounts(projectId: string): Promise<PageCounts> {
  const count = async (status?: string) => {
    let q = supabaseAdmin().from("project_pages").select("id", { count: "exact", head: true }).eq("project_id", projectId);
    if (status) q = q.eq("crawl_status", status);
    const { count: n, error } = await q;
    if (error) throw new Error(`Failed to count pages: ${error.message}`);
    return n ?? 0;
  };
  const [total, crawled, pending, failed] = await Promise.all([count(), count("crawled"), count("pending"), count("failed")]);
  return { total, crawled, pending, failed };
}

async function existingPageKeys(projectId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin()
      .from("project_pages")
      .select("url")
      .eq("project_id", projectId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load pages: ${error.message}`);
    for (const r of data ?? []) keys.add(dedupeKey(r.url));
    if (!data || data.length < PAGE) break;
  }
  return keys;
}

export interface PageListRow {
  id: string;
  url: string;
  title: string | null;
  h1: string | null;
  word_count: number;
  status_code: number | null;
  rendered_with: string;
  crawl_status: "crawled" | "pending" | "failed";
  crawl_error: string | null;
  crawled_at: string;
}

export async function listPages(
  projectId: string,
  f: { status?: string; q?: string; limit: number; offset: number },
): Promise<{ pages: PageListRow[]; total: number }> {
  let query = supabaseAdmin()
    .from("project_pages")
    .select("id,url,title,h1,word_count,status_code,rendered_with,crawl_status,crawl_error,crawled_at", { count: "exact" })
    .eq("project_id", projectId);
  if (f.status) query = query.eq("crawl_status", f.status);
  if (f.q) {
    const q = f.q.replace(/[%_,()\\]/g, " ").trim();
    if (q) query = query.or(`url.ilike.%${q}%,title.ilike.%${q}%`);
  }
  const { data, error, count } = await query.order("url").range(f.offset, f.offset + f.limit - 1);
  if (error) throw new Error(`Failed to list pages: ${error.message}`);
  return { pages: (data ?? []) as PageListRow[], total: count ?? 0 };
}
