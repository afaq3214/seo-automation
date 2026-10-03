import { after } from "next/server";
import { z } from "zod";
import { errorMessage, logger } from "@/lib/logger";
import { setAutomation } from "@/lib/services/automation/engine";
import { kickAutomation } from "@/lib/services/automation/kick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["enable", "disable", "run", "post_now"]) });

/**
 * POST /api/projects/[projectId]/automation { action }: turn automation on/off, retry now after a
 * failure ("run"), or make today's article due now ("post_now"). Anything but "disable" starts a run.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/automation">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "Invalid id" }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid action" }, { status: 400 });

  try {
    const project = await setAutomation(projectId, parsed.data.action);
    if (parsed.data.action !== "disable") {
      const origin = new URL(request.url).origin;
      after(() => kickAutomation(origin));
    }
    return Response.json({ enabled: project.auto_enabled });
  } catch (err) {
    logger.error("automation control failed", { projectId, error: errorMessage(err) });
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}
