import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Single-password protection for the whole app (except the public blog API).
 * The session cookie holds an HMAC derived from APP_PASSWORD — changing the password logs everyone out.
 */

export const SESSION_COOKIE = "seo_session";
export const SESSION_DAYS = 30;

export function appPassword(): string | undefined {
  return process.env.APP_PASSWORD?.trim() || undefined;
}

/** In production the app refuses to run unprotected; locally a missing password means "no login". */
export function authRequired(): boolean {
  return !!appPassword() || process.env.NODE_ENV === "production";
}

export function sessionToken(password: string): string {
  return createHmac("sha256", password).update("seo-automation-session-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function isValidSession(token: string | undefined): boolean {
  const password = appPassword();
  if (!password) return !authRequired();
  return !!token && safeEqual(token, sessionToken(password));
}

export function checkPassword(input: string): boolean {
  const password = appPassword();
  return !!password && safeEqual(input, password);
}
