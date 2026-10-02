import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { getProject } from "@/lib/services/projects";
import { listOpportunities } from "@/lib/services/strategy/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects/[projectId]/strategy — content opportunities, highest opportunity score first. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/strategy">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });

  try {
    const project = await getProject(projectId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    const opportunities = await listOpportunities(projectId);
    return Response.json({
      project: {
        id: project.id,
        domain: project.domain,
        strategyStatus: project.strategy_status,
        strategyError: project.strategy_error,
        strategyGeneratedAt: project.strategy_generated_at,
      },
      opportunities,
    });
  } catch (err) {
    logger.error("list opportunities failed", { projectId, error: errorMessage(err) });
    return Response.json({ error: "Failed to load the strategy" }, { status: 500 });
  }
}
