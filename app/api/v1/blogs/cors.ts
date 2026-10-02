/** Shared headers for the public blog API: open CORS (read-only data) + CDN caching. */

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Edge/CDN cache 5 minutes, then serve stale for up to an hour while revalidating. */
export const CACHE_OK = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
/** Short cache for "not found" so newly published posts appear quickly. */
export const CACHE_MISS = "public, max-age=0, s-maxage=60";

export function json(body: unknown, status: number, cache: string): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, "Cache-Control": cache } });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}
