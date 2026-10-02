import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { getProject } from "@/lib/services/projects";
import { keywordStats, listKeywords } from "@/lib/services/keywords/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  minVolume: z.coerce.number().int().min(0).optional(),
  maxDifficulty: z.coerce.number().int().min(0).max(100).optional(),
  intent: z.enum(["informational", "commercial", "transactional", "navigational"]).optional(),
  cluster: z.string().trim().min(1).max(200).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(["opportunity", "volume", "difficulty", "cpc"]).default("opportunity"),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  includeStats: z.enum(["true", "false", "1", "0"]).optional(),
});

/**
 * GET /api/projects/[projectId]/keywords
 * ?minVolume=&maxDifficulty=&intent=&cluster=&q=&sort=opportunity|volume|difficulty|cpc&order=asc|desc
 * &limit=&offset=&includeStats=true
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/keywords">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) {
    return Response.json({ error: "Invalid project id" }, { status: 400 });
  }

  // Empty query values ("?intent=") count as not set.
  const params = Object.fromEntries([...request.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid query", issues: parsed.error.issues }, { status: 400 });
  }
  const { includeStats, order, ...filters } = parsed.data;

  try {
    const project = await getProject(projectId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const [list, summary] = await Promise.all([
      listKeywords(projectId, { ...filters, order: order ?? (filters.sort === "difficulty" ? "asc" : "desc") }),
      includeStats === "true" || includeStats === "1" ? keywordStats(projectId) : null,
    ]);

    return Response.json({
      project: {
        id: project.id,
        domain: project.domain,
        keywordsStatus: project.keywords_status,
        keywordsError: project.keywords_error,
        keywordsResearchedAt: project.keywords_researched_at,
        keywordSeeds: project.keyword_seeds,
      },
      ...(summary ?? {}),
      total: list.total,
      keywords: list.keywords,
    });
  } catch (err) {
    logger.error("list keywords failed", { projectId, error: errorMessage(err) });
    return Response.json({ error: "Failed to load keywords" }, { status: 500 });
  }
}
