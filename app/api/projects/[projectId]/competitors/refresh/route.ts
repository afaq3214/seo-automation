import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { ndjsonResponse } from "@/lib/ndjson";
import { CompetitorError, discoverCompetitors } from "@/lib/services/competitors/discover";
import type { CompetitorDiscoveryEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/projects/[projectId]/competitors/refresh
 * Same as /discover with refresh=true: always runs a new discovery (SERPs still come from the 7-day cache).
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/competitors/refresh">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });

  return ndjsonResponse<CompetitorDiscoveryEvent>(
    (emit) => discoverCompetitors(projectId, { refresh: true }, emit),
    (err) => {
      if (!(err instanceof CompetitorError)) logger.error("competitor refresh route error", { projectId, error: errorMessage(err) });
    },
  );
}
