import { supabaseAdmin } from "@/lib/supabase";
import type { ArticleRow } from "@/lib/types";

export type NewArticle = Omit<
  ArticleRow,
  | "id"
  | "created_at"
  | "updated_at"
  | "status"
  | "optimized_json"
  | "optimized_html"
  | "optimized_word_count"
  | "optimization_report"
  | "optimized_at"
  | "featured_image_url"
  | "featured_image_alt"
  | "featured_image_status"
  | "featured_image_error"
  | "featured_image_prompt"
  | "featured_image_key"
  | "featured_image_generated_at"
  | "inline_image_url"
  | "inline_image_alt"
  | "inline_image_status"
  | "inline_image_error"
  | "inline_image_prompt"
  | "inline_image_key"
  | "inline_image_heading"
  | "inline_image_generated_at"
  | "schema_json"
  | "seo_score"
  | "geo_score"
  | "aeo_score"
  | "quality_report"
  | "quality_checked_at"
  | "excerpt"
  | "canonical_url"
  | "faq_json"
  | "publish_at"
>;

/** Insert a draft. A taken slug gets a numeric suffix (-2, -3 …). */
export async function saveDraft(article: NewArticle): Promise<ArticleRow> {
  const db = supabaseAdmin();
  const { data: taken } = await db
    .from("articles")
    .select("slug")
    .eq("project_id", article.project_id)
    .like("slug", `${article.slug}%`);
  const slugs = new Set((taken ?? []).map((r) => r.slug as string));
  let slug = article.slug;
  for (let n = 2; slugs.has(slug); n++) slug = `${article.slug}-${n}`;

  const { data, error } = await db
    .from("articles")
    .insert({ ...article, slug, status: "draft" })
    .select()
    .single();
  if (error) throw new Error(`Failed to save article: ${error.message}`);

  if (article.opportunity_id) {
    await db
      .from("content_opportunities")
      .update({ status: "drafted", updated_at: new Date().toISOString() })
      .eq("id", article.opportunity_id);
  }
  return data as ArticleRow;
}

export type ArticleSummary = Pick<
  ArticleRow,
  | "id"
  | "opportunity_id"
  | "title"
  | "slug"
  | "primary_keyword"
  | "word_count"
  | "status"
  | "created_at"
  | "meta_description"
  | "seo_score"
  | "geo_score"
  | "aeo_score"
>;

export async function listArticles(projectId: string): Promise<ArticleSummary[]> {
  const { data, error } = await supabaseAdmin()
    .from("articles")
    .select("id,opportunity_id,title,slug,primary_keyword,word_count,status,created_at,meta_description,seo_score,geo_score,aeo_score")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list articles: ${error.message}`);
  return (data ?? []) as ArticleSummary[];
}

export async function getArticle(projectId: string, articleId: string): Promise<ArticleRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("articles")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", articleId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load article: ${error.message}`);
  return (data as ArticleRow | null) ?? null;
}

/**
 * Status and scheduling. "published" without a date publishes now. Moving back to draft or
 * needs_review keeps publish_at but the public API ignores those statuses.
 */
export async function updatePublishing(
  projectId: string,
  articleId: string,
  patch: { status?: ArticleRow["status"]; publish_at?: string | null },
): Promise<ArticleRow | null> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status) update.status = patch.status;
  if (patch.publish_at !== undefined) update.publish_at = patch.publish_at;
  if (patch.status === "published" && patch.publish_at === undefined) update.publish_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin()
    .from("articles")
    .update(update)
    .eq("project_id", projectId)
    .eq("id", articleId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to update publishing: ${error.message}`);
  return (data as ArticleRow | null) ?? null;
}
