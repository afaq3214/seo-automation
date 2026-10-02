import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { competitorStats, listCompetitors } from "@/lib/services/competitors/repository";
import { getProject } from "@/lib/services/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["direct", "adjacent"]).optional(),
  sort: z.enum(["score", "relevance", "appearances"]).default("score"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * GET /api/projects/[projectId]/competitors?type=direct|adjacent&sort=score|relevance|appearances&order=asc|desc
 * Stats always cover all active competitors, regardless of the type filter.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/competitors">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });

  const params = Object.fromEntries([...request.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });

  try {
    const project = await getProject(projectId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const all = await listCompetitors(projectId);
    const competitors =
      parsed.data.type || parsed.data.sort !== "score" || parsed.data.order !== "desc"
        ? await listCompetitors(projectId, parsed.data)
        : all;

    return Response.json({
      project: {
        id: project.id,
        domain: project.domain,
        competitorsStatus: project.competitors_status,
        competitorsError: project.competitors_error,
        competitorsDiscoveredAt: project.competitors_discovered_at,
        competitorQueries: project.competitor_queries,
      },
      stats: competitorStats(all),
      competitors,
    });
  } catch (err) {
    logger.error("list competitors failed", { projectId, error: errorMessage(err) });
    return Response.json({ error: "Failed to load competitors" }, { status: 500 });
  }
}
