import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { ndjsonResponse } from "@/lib/ndjson";
import { CompetitorError, discoverCompetitors } from "@/lib/services/competitors/discover";
import type { CompetitorDiscoveryEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ~8 searches + up to 18 homepages + 18 Claude calls: usually under a minute.
export const maxDuration = 300;

const bodySchema = z.object({ refresh: z.boolean().default(false) });

/**
 * POST /api/projects/[projectId]/competitors/discover
 * Body: { refresh?: boolean } — refresh=false reuses results younger than COMPETITOR_TTL_DAYS.
 * Response: application/x-ndjson stream of CompetitorDiscoveryEvent.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/competitors/discover">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });

  const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return Response.json({ error: "Invalid request body" }, { status: 400 });

  return ndjsonResponse<CompetitorDiscoveryEvent>(
    (emit) => discoverCompetitors(projectId, parsed.data, emit),
    (err) => {
      if (!(err instanceof CompetitorError)) logger.error("competitor discovery route error", { projectId, error: errorMessage(err) });
    },
  );
}
