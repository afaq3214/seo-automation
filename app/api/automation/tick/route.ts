import { after } from "next/server";
import { errorMessage, logger } from "@/lib/logger";
import { hasDueWork, runOneStep } from "@/lib/services/automation/engine";
import { isAuthorizedTick, kickAutomation } from "@/lib/services/automation/kick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One automation step (e.g. writing an article or keyword research) runs after the response.
export const maxDuration = 300;

/** Start another step in the same invocation only within this time from the start. */
const CONTINUE_WITHIN_MS = 45_000;

/**
 * GET/POST /api/automation/tick: run ONE due automation step, then start the next tick if more work
 * is due, so the whole pipeline runs as a chain of short invocations. Called by Vercel Cron (GET, with
 * Authorization: Bearer CRON_SECRET), by an external cron (?secret=CRON_SECRET), and by itself.
 */
async function tick(request: Request) {
  if (!isAuthorizedTick(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const origin = new URL(request.url).origin;

  after(async () => {
    try {
      // Keep going in this invocation while it's early (crawl batches, images and publishing are short),
      // leaving the rest of the 300s for a long step such as writing an article.
      const started = Date.now();
      let worked = false;
      while (Date.now() - started < CONTINUE_WITHIN_MS && (await runOneStep())) worked = true;
      // Best effort: platforms may block a function calling itself repeatedly, so a frequent cron
      // (every 5-10 minutes) is what keeps the pipeline moving reliably.
      if (worked && (await hasDueWork())) await kickAutomation(origin);
    } catch (err) {
      logger.error("automation tick failed", { error: errorMessage(err) });
    }
  });
  return Response.json({ ok: true, started: new Date().toISOString() }, { status: 202 });
}

export const GET = tick;
export const POST = tick;
