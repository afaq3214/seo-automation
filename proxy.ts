import { NextResponse, type NextRequest } from "next/server";
import { appPassword, isValidSession, SESSION_COOKIE } from "@/lib/auth";

/**
 * Password gate for the whole app. Not applied to (see matcher): the public blog API (/api/v1),
 * the login page and login/logout endpoints, and static assets.
 */
export function proxy(request: NextRequest) {
  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const isApi = request.nextUrl.pathname.startsWith("/api/");
  if (!appPassword()) {
    // Production without APP_PASSWORD: refuse rather than run unprotected.
    const message = "APP_PASSWORD is not set — the app is locked until it is configured.";
    return isApi ? NextResponse.json({ error: message }, { status: 503 }) : new NextResponse(message, { status: 503 });
  }
  if (isApi) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api/v1/|api/auth/|login|_next/static|_next/image|favicon.ico).*)"],
};
