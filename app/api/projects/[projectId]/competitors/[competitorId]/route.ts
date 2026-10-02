import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { getCompetitor, removeCompetitor } from "@/lib/services/competitors/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/projects/[projectId]/competitors/[competitorId]">;

async function ids(ctx: Ctx) {
  const { projectId, competitorId } = await ctx.params;
  const valid = z.uuid().safeParse(projectId).success && z.uuid().safeParse(competitorId).success;
  return valid ? { projectId, competitorId } : null;
}

/** GET — competitor details plus the discovery searches it appeared in. */
export async function GET(_request: Request, ctx: Ctx) {
  const p = await ids(ctx);
  if (!p) return Response.json({ error: "Invalid id" }, { status: 400 });
  try {
    const result = await getCompetitor(p.projectId, p.competitorId);
    if (!result) return Response.json({ error: "Competitor not found" }, { status: 404 });
    return Response.json(result);
  } catch (err) {
    logger.error("get competitor failed", { ...p, error: errorMessage(err) });
    return Response.json({ error: "Failed to load competitor" }, { status: 500 });
  }
}

/** DELETE — remove from the project (kept as "removed" so rediscovery won't re-add it). */
export async function DELETE(_request: Request, ctx: Ctx) {
  const p = await ids(ctx);
  if (!p) return Response.json({ error: "Invalid id" }, { status: 400 });
  try {
    const removed = await removeCompetitor(p.projectId, p.competitorId);
    if (!removed) return Response.json({ error: "Competitor not found" }, { status: 404 });
    return Response.json({ removed: true });
  } catch (err) {
    logger.error("remove competitor failed", { ...p, error: errorMessage(err) });
    return Response.json({ error: "Failed to remove competitor" }, { status: 500 });
  }
}
