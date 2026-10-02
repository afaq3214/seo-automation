import { z } from "zod";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { ndjsonResponse } from "@/lib/ndjson";
import { analyzeProject } from "@/lib/services/analyzeProject";
import type { AnalyzeEvent } from "@/lib/types";
import { normalizeInputUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Crawling + OpenAI can take a minute or two. 300s is the Vercel limit with Fluid Compute.
export const maxDuration = 300;

const bodySchema = z.object({
  url: z.string().trim().min(1, "URL is required").max(2048),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Country must be a 2-letter ISO code, e.g. AU"),
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/, "Language must be a 2-letter ISO code, e.g. en"),
});

/**
 * POST /api/projects/analyze
 * Body: { url, country, language }
 * Response: application/x-ndjson stream of AnalyzeEvent, one JSON object per line.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  let url: string;
  try {
    url = normalizeInputUrl(parsed.data.url);
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 400 });
  }

  try {
    env();
  } catch (err) {
    logger.error("server misconfigured", { error: errorMessage(err) });
    return Response.json({ error: "Server is not configured. Check environment variables." }, { status: 500 });
  }

  return ndjsonResponse<AnalyzeEvent>(async (emit) => {
    try {
      const result = await analyzeProject({ ...parsed.data, url }, emit);
      emit({ type: "complete", ...result });
    } catch (err) {
      const projectId = (err as { projectId?: string }).projectId;
      emit({ type: "error", message: errorMessage(err), projectId });
    }
  });
}
