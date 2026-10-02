import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { ndjsonResponse } from "@/lib/ndjson";
import { ArticleError } from "@/lib/services/articles/generate";
import { optimizeArticle } from "@/lib/services/articles/optimize";
import type { OptimizeEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Audit + targeted revision + re-audit: usually 1–2 minutes.
export const maxDuration = 300;

/**
 * POST /api/projects/[projectId]/articles/[articleId]/optimize
 * SEO/GEO/AEO pass over the original draft. Streams OptimizeEvent; saves optimized_json, optimized_html
 * and optimization_report on the article.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles/[articleId]/optimize">) {
  const { projectId, articleId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(articleId).success) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  return ndjsonResponse<OptimizeEvent>(
    (emit) => optimizeArticle(projectId, articleId, emit),
    (err) => {
      if (!(err instanceof ArticleError)) logger.error("article optimization failed", { projectId, articleId, error: errorMessage(err) });
    },
  );
}
