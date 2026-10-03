import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { generateArticleImage } from "@/lib/services/images/featured";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Concept + image generation + upload: usually 20–90s.
export const maxDuration = 300;

/**
 * POST /api/projects/[projectId]/articles/[articleId]/image?slot=featured|inline — generate (or retry)
 * the featured image (default) or the mid-article image. Generation problems never fail the request:
 * the article comes back with that image's status "failed" and its error, so the UI can offer a retry.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles/[articleId]/image">) {
  const { projectId, articleId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(articleId).success) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const slot = new URL(request.url).searchParams.get("slot") === "inline" ? "inline" : "featured";
  try {
    const article = await generateArticleImage(projectId, articleId, slot);
    return Response.json({
      slot,
      status: article[`${slot}_image_status`],
      url: article[`${slot}_image_url`],
      alt: article[`${slot}_image_alt`],
      error: article[`${slot}_image_error`],
    });
  } catch (err) {
    logger.error("article image route error", { projectId, articleId, slot, error: errorMessage(err) });
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}
