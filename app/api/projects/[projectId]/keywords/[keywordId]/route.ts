import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { getKeyword } from "@/lib/services/keywords/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects/[projectId]/keywords/[keywordId] — one keyword including its SERP snapshot. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/keywords/[keywordId]">) {
  const { projectId, keywordId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(keywordId).success) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const keyword = await getKeyword(projectId, keywordId);
    if (!keyword) return Response.json({ error: "Keyword not found" }, { status: 404 });
    return Response.json({ keyword });
  } catch (err) {
    logger.error("get keyword failed", { projectId, keywordId, error: errorMessage(err) });
    return Response.json({ error: "Failed to load keyword" }, { status: 500 });
  }
}
