import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { listPages, pageCounts } from "@/lib/services/crawler/fullCrawl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["crawled", "pending", "failed"]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/projects/[projectId]/pages?status=crawled|pending|failed&q=&limit=&offset= */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/pages">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });

  const params = Object.fromEntries([...request.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });

  try {
    const [counts, list] = await Promise.all([pageCounts(projectId), listPages(projectId, parsed.data)]);
    return Response.json({ counts, ...list });
  } catch (err) {
    logger.error("list pages failed", { projectId, error: errorMessage(err) });
    return Response.json({ error: "Failed to load pages" }, { status: 500 });
  }
}
