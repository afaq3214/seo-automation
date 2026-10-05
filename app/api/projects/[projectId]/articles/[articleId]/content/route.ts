import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { ArticleError } from "@/lib/services/articles/generate";
import { saveEditedArticle } from "@/lib/services/articles/edit";
import { articleSchema } from "@/lib/services/articles/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ content: articleSchema });

/**
 * PUT /api/projects/[projectId]/articles/[articleId]/content, body { content: ArticleContent }.
 * Saves a manual edit of the article's current version (title, meta, slug, text, FAQ, CTA) and
 * re-renders its HTML and schema. Status and images are kept.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles/[articleId]/content">) {
  const { projectId, articleId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(articleId).success) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The article content is not valid" }, { status: 400 });

  try {
    const article = await saveEditedArticle(projectId, articleId, parsed.data.content);
    return Response.json({ slug: article.slug, title: article.title });
  } catch (err) {
    if (err instanceof ArticleError) return Response.json({ error: err.message }, { status: err.status });
    logger.error("save edited article failed", { projectId, articleId, error: errorMessage(err) });
    return Response.json({ error: "Failed to save the article" }, { status: 500 });
  }
}
