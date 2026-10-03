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
  try {
    const res = await fetch(`${origin}/api/automation/tick`, {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      cache: "no-store",
    });
    if (!res.ok) logger.warn("automation kick rejected", { status: res.status });
  } catch (err) {
    logger.warn("automation kick failed", { error: errorMessage(err) });
  }
}
