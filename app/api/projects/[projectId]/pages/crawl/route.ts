import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { crawlPendingBatch, pageCounts, queueSitemapPages } from "@/lib/services/crawler/fullCrawl";
import { getProject } from "@/lib/services/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One batch (CRAWL_BATCH_SIZE pages, 4 at a time) — usually 10–60s, more with Playwright.
export const maxDuration = 300;

const bodySchema = z.object({ queue: z.boolean().default(false) });

/**
 * POST /api/projects/[projectId]/pages/crawl
 * Body: { queue?: boolean } — queue=true first stores all sitemap URLs as pending pages.
 * Crawls one batch of pending pages and returns the updated counts. Call again while counts.pending > 0.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/pages/crawl">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });
  const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return Response.json({ error: "Invalid request body" }, { status: 400 });

  try {
    const project = await getProject(projectId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const queued = parsed.data.queue ? await queueSitemapPages(project) : null;
    const batch = await crawlPendingBatch(projectId);
    const counts = await pageCounts(projectId);
    return Response.json({ queued, batch, counts });
  } catch (err) {
    logger.error("page crawl batch failed", { projectId, error: errorMessage(err) });
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}
