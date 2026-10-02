import { z } from "zod";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { ndjsonResponse } from "@/lib/ndjson";
import { KeywordResearchError, researchKeywords } from "@/lib/services/keywords/research";
import type { KeywordResearchEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Google Ads + several Claude calls + ~30 SERP checks: usually 1–3 minutes.
export const maxDuration = 300;

const bodySchema = z.object({ refresh: z.boolean().default(false) });

/**
 * POST /api/projects/[projectId]/keywords/research
 * Body: { refresh?: boolean }  — refresh=false reuses research younger than KEYWORD_RESEARCH_TTL_DAYS.
 * Response: application/x-ndjson stream of KeywordResearchEvent.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/keywords/research">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) {
    return Response.json({ error: "Invalid project id" }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) return Response.json({ error: "Invalid request body" }, { status: 400 });

  try {
    env();
  } catch (err) {
    logger.error("server misconfigured", { error: errorMessage(err) });
    return Response.json({ error: "Server is not configured. Check environment variables." }, { status: 500 });
  }

  return ndjsonResponse<KeywordResearchEvent>(
    (emit) => researchKeywords(projectId, parsed.data, emit),
    (err) => {
      if (!(err instanceof KeywordResearchError)) logger.error("keyword research route error", { projectId, error: errorMessage(err) });
    },
  );
}
