import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { listArticles } from "@/lib/services/articles/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects/[projectId]/articles — drafts, newest first (without the full content). */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });
  try {
    return Response.json({ articles: await listArticles(projectId) });
  } catch (err) {
    logger.error("list articles failed", { projectId, error: errorMessage(err) });
    return Response.json({ error: "Failed to load articles" }, { status: 500 });
  }
}
