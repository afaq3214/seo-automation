import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";

/** Whether a request may run the automation: Bearer CRON_SECRET (Vercel Cron sends it), or ?secret=. */
export function isAuthorizedTick(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // local dev without a secret
  const header = request.headers.get("authorization");
  const query = new URL(request.url).searchParams.get("secret");
  return header === `Bearer ${secret}` || query === secret;
}

/**
 * Start the next automation step in a fresh function invocation. The tick endpoint answers at once and
 * does the work after responding, so this returns quickly. Call it from inside `after()`.
 */
export async function kickAutomation(origin: string): Promise<void> {
  const secret = env().CRON_SECRET;
  // A lost hand-off would stall the chain until the next cron, so try a few times.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${origin}/api/automation/tick`, {
        method: "POST",
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return;
      logger.warn("automation kick rejected", { status: res.status, attempt });
      if (res.status === 401) return; // wrong/missing CRON_SECRET: retrying won't help
    } catch (err) {
      logger.warn("automation kick failed", { error: errorMessage(err), attempt });
    }
    await new Promise((r) => setTimeout(r, 2_000 * attempt));
  }
}
