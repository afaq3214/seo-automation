import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { getPublicArticle, siteByKey } from "@/lib/services/publicBlog";
import { CACHE_MISS, CACHE_OK, json, preflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const siteSchema = z.string().trim().regex(/^[a-zA-Z0-9_-]{6,64}$/);
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/).max(120);

/**
 * GET /api/v1/blogs/[...slug]?site=SITE_KEY
 * One live article: metadata, structured content (JSON), sanitized HTML, FAQ, schema (JSON-LD) and image.
 * Returns 404 for drafts, needs_review articles and posts scheduled in the future.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/blogs/[...slug]">) {
  // Catch-all: a slug may contain a slash (e.g. "best-24/7-answering-service").
  const slug = (await ctx.params).slug.join("/").replace(/%2f/gi, "/");
  const site = siteSchema.safeParse(request.nextUrl.searchParams.get("site") ?? "");
  if (!site.success) return json({ error: "A valid site key is required (?site=SITE_KEY)" }, 400, CACHE_MISS);
  if (!slugSchema.safeParse(slug).success) return json({ error: "Article not found" }, 404, CACHE_MISS);

  try {
    const project = await siteByKey(site.data);
    if (!project) return json({ error: "Unknown site" }, 404, CACHE_MISS);
    const article = await getPublicArticle(project.id, slug);
    if (!article) return json({ error: "Article not found" }, 404, CACHE_MISS);
    return json({ site: { domain: project.domain }, article }, 200, CACHE_OK);
  } catch (err) {
    logger.error("public blog article failed", { slug, error: errorMessage(err) });
    return json({ error: "Failed to load article" }, 500, "no-store");
  }
}

export function OPTIONS() {
  return preflight();
}
