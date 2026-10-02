import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { listPublicArticles, siteByKey } from "@/lib/services/publicBlog";
import { CACHE_MISS, CACHE_OK, json, preflight } from "./cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  site: z.string().trim().regex(/^[a-zA-Z0-9_-]{6,64}$/, "A valid site key is required (?site=SITE_KEY)"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /api/v1/blogs?site=SITE_KEY&page=1&limit=20
 * Public list of live articles (status ready/published and publish_at <= now), newest first.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, 400, CACHE_MISS);

  try {
    const site = await siteByKey(parsed.data.site);
    if (!site) return json({ error: "Unknown site" }, 404, CACHE_MISS);
    const result = await listPublicArticles(site.id, parsed.data.page, parsed.data.limit);
    return json({ site: { domain: site.domain }, ...result }, 200, CACHE_OK);
  } catch (err) {
    logger.error("public blog list failed", { error: errorMessage(err) });
    return json({ error: "Failed to load articles" }, 500, "no-store");
  }
}

export function OPTIONS() {
  return preflight();
}
