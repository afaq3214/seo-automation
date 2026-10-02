import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { ndjsonResponse } from "@/lib/ndjson";
import { ArticleError } from "@/lib/services/articles/generate";
import { runQualityLoop } from "@/lib/services/articles/quality";
import type { QualityEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to 4 reviews + 3 targeted revisions: usually 1–4 minutes.
export const maxDuration = 300;

/**
 * POST /api/projects/[projectId]/articles/[articleId]/quality
 * Scores SEO/GEO/AEO and runs up to QUALITY_MAX_ROUNDS improvement rounds on failed criteria only.
 * Sets the article status to "ready" (targets met) or "needs_review". Streams QualityEvent.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles/[articleId]/quality">) {
  const { projectId, articleId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(articleId).success) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  return ndjsonResponse<QualityEvent>(
    (emit) => runQualityLoop(projectId, articleId, emit),
    (err) => {
      if (!(err instanceof ArticleError)) logger.error("quality loop failed", { projectId, articleId, error: errorMessage(err) });
    },
  );
}
