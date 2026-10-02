import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { ndjsonResponse } from "@/lib/ndjson";
import { ArticleError, generateArticle } from "@/lib/services/articles/generate";
import type { ArticleEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// SERP + a few page crawls + brief + full article: usually 1–3 minutes.
export const maxDuration = 300;

const bodySchema = z.object({ opportunityId: z.uuid() });

/**
 * POST /api/projects/[projectId]/articles/generate — body { opportunityId }
 * Streams ArticleEvent (NDJSON). The final "complete" event carries the saved draft with both
 * content_json (structured sections) and content_html.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles/generate">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "opportunityId is required" }, { status: 400 });

  return ndjsonResponse<ArticleEvent>(
    (emit) => generateArticle(projectId, parsed.data.opportunityId, emit),
    (err) => {
      if (!(err instanceof ArticleError)) logger.error("article generation failed", { projectId, error: errorMessage(err) });
    },
  );
}
