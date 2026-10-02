import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — clears the session cookie and returns to the login page. */
export function POST(request: Request) {
  const res = Response.redirect(new URL("/login", request.url), 303);
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 303, headers });
}
