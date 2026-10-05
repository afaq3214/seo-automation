import { after } from "next/server";
import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { getArticle, updatePublishing } from "@/lib/services/articles/repository";
import { getProject } from "@/lib/services/projects";
import { searchConsoleConfigured, submitSitemap } from "@/lib/services/searchConsole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects/[projectId]/articles/[articleId] — full draft: brief, research, content_json and content_html. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles/[articleId]">) {
  const { projectId, articleId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(articleId).success) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const article = await getArticle(projectId, articleId);
    if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
    return Response.json({ article });
  } catch (err) {
    logger.error("get article failed", { projectId, articleId, error: errorMessage(err) });
    return Response.json({ error: "Failed to load article" }, { status: 500 });
  }
}

const patchSchema = z
  .object({
    status: z.enum(["draft", "ready", "needs_review", "published"]).optional(),
    publish_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((p) => p.status !== undefined || p.publish_at !== undefined, "Nothing to update");

/**
 * PATCH /api/projects/[projectId]/articles/[articleId] — body { status?, publish_at? }
 * Publishing control: an article is public only when status is ready/published and publish_at <= now.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[projectId]/articles/[articleId]">) {
  const { projectId, articleId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(articleId).success) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });

  try {
    const article = await updatePublishing(projectId, articleId, parsed.data);
    if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
    // Published by hand: tell Google the sitemap changed (best effort, after responding).
    if (parsed.data.status === "published" && searchConsoleConfigured()) {
      after(async () => {
        const project = await getProject(projectId);
        if (project) await submitSitemap(project).catch((err) => logger.warn("sitemap submit failed", { projectId, error: errorMessage(err) }));
      });
    }
    return Response.json({ status: article.status, publish_at: article.publish_at });
  } catch (err) {
    logger.error("update publishing failed", { projectId, articleId, error: errorMessage(err) });
    return Response.json({ error: "Failed to update publishing" }, { status: 500 });
  }
}
