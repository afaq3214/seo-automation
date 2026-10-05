import type { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import type { ArticleRow } from "@/lib/types";
import { ArticleError } from "./generate";
import { countWords, slugify } from "./html";
import { refreshArticleOutputs } from "./render";
import { getArticle } from "./repository";
import { normalizeArticle, type articleSchema } from "./writer";

/**
 * Save a manual edit. The edit replaces the version readers see: the optimized version when there is
 * one, otherwise the original draft. Status, images and scores are left as they are.
 */
export async function saveEditedArticle(projectId: string, articleId: string, raw: z.infer<typeof articleSchema>): Promise<ArticleRow> {
  const article = await getArticle(projectId, articleId);
  if (!article) throw new ArticleError("Article not found", 404);

  const content = normalizeArticle(raw);
  if (!content.title) throw new ArticleError("The title can't be empty", 400);
  if (!content.sections.length) throw new ArticleError("The article needs at least one section with content", 400);
  const slug = slugify(raw.slug || article.slug);
  content.slug = slug;

  const db = supabaseAdmin();
  if (slug !== article.slug) {
    const { data: taken } = await db.from("articles").select("id").eq("project_id", projectId).eq("slug", slug).neq("id", articleId).limit(1);
    if (taken?.length) throw new ArticleError(`Another article in this project already uses the slug "${slug}"`, 409);
  }

  const words = countWords(content);
  const { error } = await db
    .from("articles")
    .update({
      ...(article.optimized_json ? { optimized_json: content, optimized_word_count: words } : { content_json: content, word_count: words }),
      title: content.title,
      meta_title: content.metaTitle,
      meta_description: content.metaDescription,
      slug,
      updated_at: new Date().toISOString(),
    })
    .eq("id", articleId);
  if (error) throw new ArticleError(`Failed to save the article: ${error.message}`);
  return refreshArticleOutputs(projectId, articleId);
}
