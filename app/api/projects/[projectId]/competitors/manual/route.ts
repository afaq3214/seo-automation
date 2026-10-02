import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { CompetitorError } from "@/lib/services/competitors/discover";
import { addManualCompetitor } from "@/lib/services/competitors/manual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ domain: z.string().trim().min(3, "Domain is required").max(253) });

/** POST /api/projects/[projectId]/competitors/manual — body { "domain": "example.com" } */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/competitors/manual">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 });
  }

  try {
    const competitor = await addManualCompetitor(projectId, parsed.data.domain);
    return Response.json({ competitor }, { status: 201 });
  } catch (err) {
    if (err instanceof CompetitorError) return Response.json({ error: err.message }, { status: err.status });
    logger.error("add manual competitor failed", { projectId, error: errorMessage(err) });
    return Response.json({ error: "Failed to add competitor" }, { status: 500 });
  }
}
