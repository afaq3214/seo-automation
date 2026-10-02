import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { ndjsonResponse } from "@/lib/ndjson";
import { generateStrategy, StrategyError } from "@/lib/services/strategy/generate";
import type { StrategyEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to ~25 SERP checks (mostly cached) + a few Claude calls: usually under a minute.
export const maxDuration = 300;

/**
 * POST /api/projects/[projectId]/strategy/generate
 * Builds the content gap strategy from Modules 01–03. Response: application/x-ndjson stream of StrategyEvent.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/strategy/generate">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid project id" }, { status: 400 });

  return ndjsonResponse<StrategyEvent>(
    (emit) => generateStrategy(projectId, emit),
    (err) => {
      if (!(err instanceof StrategyError)) logger.error("strategy route error", { projectId, error: errorMessage(err) });
    },
  );
}
