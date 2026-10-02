import { z } from "zod";
import { checkPassword, SESSION_COOKIE, SESSION_DAYS, sessionToken } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().min(1).max(200) });

/** POST /api/auth/login — body { password }. Sets the session cookie on success. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !checkPassword(parsed.data.password)) {
    logger.warn("failed login attempt");
    // Small fixed delay slows down password guessing.
    await new Promise((r) => setTimeout(r, 600));
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = Response.json({ ok: true });
  const cookie = [
    `${SESSION_COOKIE}=${sessionToken(parsed.data.password)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 86400}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  res.headers.append("Set-Cookie", cookie);
  return res;
}
