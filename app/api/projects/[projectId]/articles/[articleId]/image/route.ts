import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { generateFeaturedImage } from "@/lib/services/images/featured";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Concept + image generation + upload: usually 20–90s.
export const maxDuration = 300;

/**
 * POST /api/projects/[projectId]/articles/[articleId]/image — generate (or retry) the featured image.
 * Generation problems never fail the request: the article comes back with featured_image_status "failed"
 * and featured_image_error, so the UI can offer a retry.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles/[articleId]/image">) {
  const { projectId, articleId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(articleId).success) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const article = await generateFeaturedImage(projectId, articleId);
    return Response.json({
      status: article.featured_image_status,
      url: article.featured_image_url,
      alt: article.featured_image_alt,
      error: article.featured_image_error,
    });
  } catch (err) {
    logger.error("featured image route error", { projectId, articleId, error: errorMessage(err) });
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}
