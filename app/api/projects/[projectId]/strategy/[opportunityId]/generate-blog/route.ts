export const dynamic = "force-dynamic";

/**
 * Removed in Module 05 (blog generation now runs at POST /api/projects/[projectId]/articles/generate).
 * Kept so browser tabs still running the old Strategy page get a readable message instead of a 404 page.
 */
export function POST() {
  return Response.json(
    { error: "This page is out of date. Reload it (Ctrl+Shift+R) and click “Generate blog” again." },
    { status: 410 },
  );
}
