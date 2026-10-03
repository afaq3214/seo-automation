import { supabaseAdmin } from "@/lib/supabase";
import type { Project } from "@/lib/types";
import type { CrawledPage } from "./crawler/crawl";

type ProjectPatch = Partial<
  Pick<
    Project,
    | "status"
    | "error"
    | "robots_found"
    | "sitemap_url"
    | "pages_crawled"
    | "analysis"
    | "analyzed_at"
    | "url"
    | "keywords_status"
    | "keywords_error"
    | "keywords_started_at"
    | "keywords_researched_at"
    | "keyword_seeds"
    | "competitors_status"
    | "competitors_error"
    | "competitors_started_at"
    | "competitors_discovered_at"
    | "competitor_queries"
    | "strategy_status"
    | "strategy_error"
    | "strategy_started_at"
    | "strategy_generated_at"
    | "auto_enabled"
    | "auto_step"
    | "auto_attempts"
    | "auto_error"
    | "auto_locked_until"
    | "auto_retry_at"
    | "auto_article_id"
    | "auto_next_post_at"
    | "auto_pages_queued_at"
    | "auto_last_run_at"
  >
>;

export async function createProject(input: {
  url: string;
  domain: string;
  country: string;
  language: string;
}): Promise<Project> {
  const { data, error } = await supabaseAdmin()
    .from("projects")
    .insert({ ...input, status: "pending" })
    .select()
    .single();
  if (error) throw new Error(`Failed to create project: ${error.message}`);
  return data as Project;
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const { data, error } = await supabaseAdmin()
    .from("projects")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update project: ${error.message}`);
  return data as Project;
}

/** Upsert crawled pages so re-running analysis on a project refreshes them in place. */
export async function saveProjectPages(projectId: string, pages: CrawledPage[]): Promise<void> {
  if (!pages.length) return;
  const rows = pages.map((p) => ({
    project_id: projectId,
    url: p.url,
    status_code: p.statusCode,
    title: p.title,
    meta_description: p.metaDescription,
    h1: p.h1,
    h2s: p.h2s,
    h3s: p.h3s,
    canonical: p.canonical,
    body_text: p.bodyText,
    word_count: p.wordCount,
    internal_links: p.internalLinks,
    images: p.images,
    rendered_with: p.renderedWith,
    crawled_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin().from("project_pages").upsert(rows, { onConflict: "project_id,url" });
  if (error) throw new Error(`Failed to save pages: ${error.message}`);
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await supabaseAdmin().from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load project: ${error.message}`);
  return (data as Project | null) ?? null;
}

export async function listProjects(limit = 20): Promise<Project[]> {
  const { data, error } = await supabaseAdmin()
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list projects: ${error.message}`);
  return (data ?? []) as Project[];
}
