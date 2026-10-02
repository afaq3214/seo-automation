import { supabaseAdmin } from "@/lib/supabase";
import type { ContentOpportunity } from "@/lib/types";

/** Everything except id, timestamps, status and blog_requested_at (those are owned by the user's actions). */
export type NewOpportunity = Omit<ContentOpportunity, "id" | "created_at" | "updated_at" | "status" | "blog_requested_at">;

/**
 * Save this run's opportunities. Upserting without `status` keeps the status of opportunities the
 * user already acted on (blog requested / dismissed). Old untouched ("new") ones not in this run are removed.
 */
export async function saveOpportunities(projectId: string, rows: NewOpportunity[]): Promise<void> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  if (rows.length) {
    const { error } = await db
      .from("content_opportunities")
      .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "project_id,primary_keyword" });
    if (error) throw new Error(`Failed to save opportunities: ${error.message}`);
  }

  let stale = db.from("content_opportunities").delete().eq("project_id", projectId).eq("status", "new");
  if (rows.length) {
    stale = stale.not("primary_keyword", "in", `(${rows.map((r) => `"${r.primary_keyword.replace(/"/g, "")}"`).join(",")})`);
  }
  const { error } = await stale;
  if (error) throw new Error(`Failed to remove old opportunities: ${error.message}`);
}

/** Opportunities ordered by score (dismissed ones excluded). */
export async function listOpportunities(projectId: string): Promise<ContentOpportunity[]> {
  const { data, error } = await supabaseAdmin()
    .from("content_opportunities")
    .select("*")
    .eq("project_id", projectId)
    .neq("status", "dismissed")
    .order("opportunity_score", { ascending: false })
    .order("competitor_count", { ascending: false });
  if (error) throw new Error(`Failed to list opportunities: ${error.message}`);
  return (data ?? []).map((r) => ({ ...r, relevance_score: Number(r.relevance_score) })) as ContentOpportunity[];
}
