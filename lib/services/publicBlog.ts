import { supabaseAdmin } from "@/lib/supabase";
import type { ArticleContent } from "@/lib/types";

/**
 * Public, read-only blog data. Visibility rule (the only one):
 *   status IN ('ready', 'published') AND publish_at IS NOT NULL AND publish_at <= now()
 * Drafts, needs_review articles and anything scheduled for the future are never returned.
 * Internal fields (scores, briefs, research, reports, prompts) are never exposed.
 */

export const PUBLIC_STATUSES = ["ready", "published"] as const;

const LIST_COLUMNS = "slug,title,excerpt,meta_title,meta_description,canonical_url,featured_image_url,featured_image_alt,primary_keyword,publish_at,updated_at";
const DETAIL_COLUMNS = `${LIST_COLUMNS},content_json,optimized_json,content_html,optimized_html,faq_json,schema_json,word_count,optimized_word_count`;

export async function siteByKey(siteKey: string): Promise<{ id: string; domain: string } | null> {
  const { data, error } = await supabaseAdmin().from("projects").select("id,domain").eq("site_key", siteKey).maybeSingle();
  if (error) throw new Error(`Failed to load site: ${error.message}`);
  return data ?? null;
}

function publicQuery(columns: string, projectId: string, options?: { count?: boolean }) {
  return supabaseAdmin()
    .from("articles")
    .select(columns, options?.count ? { count: "exact" } : undefined)
    .eq("project_id", projectId)
    .in("status", PUBLIC_STATUSES as unknown as string[])
    .not("publish_at", "is", null)
    .lte("publish_at", new Date().toISOString());
}

type ListRow = {
  slug: string;
  title: string;
  excerpt: string | null;
  meta_title: string;
  meta_description: string;
  canonical_url: string | null;
  featured_image_url: string | null;
  featured_image_alt: string | null;
  primary_keyword: string;
  publish_at: string;
  updated_at: string;
};

type DetailRow = ListRow & {
  content_json: ArticleContent;
  optimized_json: ArticleContent | null;
  content_html: string;
  optimized_html: string | null;
  faq_json: { question: string; answer: string }[];
  schema_json: Record<string, unknown>[] | null;
  word_count: number;
  optimized_word_count: number | null;
};

function summary(r: ListRow) {
  return {
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    url: r.canonical_url,
    publishedAt: r.publish_at,
    updatedAt: r.updated_at,
    meta: { title: r.meta_title, description: r.meta_description, canonicalUrl: r.canonical_url },
    image: r.featured_image_url ? { url: r.featured_image_url, alt: r.featured_image_alt ?? "" } : null,
    primaryKeyword: r.primary_keyword,
  };
}

export async function listPublicArticles(projectId: string, page: number, limit: number) {
  const from = (page - 1) * limit;
  const { data, error, count } = await publicQuery(LIST_COLUMNS, projectId, { count: true })
    .order("publish_at", { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw new Error(`Failed to list articles: ${error.message}`);
  const total = count ?? 0;
  return {
    articles: ((data ?? []) as unknown as ListRow[]).map(summary),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getPublicArticle(projectId: string, slug: string) {
  const { data, error } = await publicQuery(DETAIL_COLUMNS, projectId).eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Failed to load article: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as DetailRow;
  // The final version is the optimized one when it exists.
  const optimized = !!r.optimized_json && !!r.optimized_html;
  return {
    ...summary(r),
    wordCount: optimized ? (r.optimized_word_count ?? r.word_count) : r.word_count,
    content: optimized ? r.optimized_json : r.content_json,
    html: optimized ? r.optimized_html : r.content_html,
    faq: r.faq_json ?? [],
    schema: r.schema_json ?? [],
  };
}
