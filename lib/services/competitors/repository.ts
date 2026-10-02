import { supabaseAdmin } from "@/lib/supabase";
import type { CompetitorRow, CompetitorSerpAppearance, CompetitorStats, CompetitorType } from "@/lib/types";

export type NewCompetitorRow = Omit<CompetitorRow, "id" | "created_at" | "updated_at">;

export interface SerpResultRow {
  project_id: string;
  query: string;
  position: number;
  domain: string;
  url: string;
  title: string | null;
  description: string | null;
}

/** Replace the project's discovery SERP rows with this run's. */
export async function replaceSerpResults(projectId: string, rows: SerpResultRow[]): Promise<void> {
  const db = supabaseAdmin();
  const { error: delError } = await db.from("competitor_serp_results").delete().eq("project_id", projectId);
  if (delError) throw new Error(`Failed to clear discovery results: ${delError.message}`);
  if (!rows.length) return;
  const { error } = await db.from("competitor_serp_results").insert(rows);
  if (error) throw new Error(`Failed to save discovery results: ${error.message}`);
}

export async function getSerpRowsForDomain(projectId: string, domain: string): Promise<SerpResultRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("competitor_serp_results")
    .select("project_id,query,position,domain,url,title,description")
    .eq("project_id", projectId)
    .eq("domain", domain)
    .order("position");
  if (error) throw new Error(`Failed to load discovery results: ${error.message}`);
  return (data ?? []) as SerpResultRow[];
}

/** Domains the user removed or added manually — discovery must not overwrite either. */
export async function getUserManagedDomains(projectId: string): Promise<{ removed: Set<string>; manual: Set<string> }> {
  const { data, error } = await supabaseAdmin()
    .from("project_competitors")
    .select("domain,status,is_manual")
    .eq("project_id", projectId)
    .or("status.eq.removed,is_manual.eq.true");
  if (error) throw new Error(`Failed to load competitors: ${error.message}`);
  const removed = new Set<string>();
  const manual = new Set<string>();
  for (const r of data ?? []) {
    if (r.status === "removed") removed.add(r.domain);
    if (r.is_manual) manual.add(r.domain);
  }
  return { removed, manual };
}

/**
 * Save this run's competitors and drop previously discovered ones that didn't make the list.
 * Manual and user-removed competitors are left untouched.
 */
export async function saveDiscoveredCompetitors(projectId: string, rows: NewCompetitorRow[]): Promise<void> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  if (rows.length) {
    const { error } = await db
      .from("project_competitors")
      .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "project_id,domain" });
    if (error) throw new Error(`Failed to save competitors: ${error.message}`);
  }

  let stale = db
    .from("project_competitors")
    .delete()
    .eq("project_id", projectId)
    .eq("is_manual", false)
    .neq("status", "removed");
  if (rows.length) stale = stale.not("domain", "in", `(${rows.map((r) => `"${r.domain}"`).join(",")})`);
  const { error } = await stale;
  if (error) throw new Error(`Failed to remove old competitors: ${error.message}`);
}

export async function upsertCompetitor(row: NewCompetitorRow): Promise<CompetitorRow> {
  const { data, error } = await supabaseAdmin()
    .from("project_competitors")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "project_id,domain" })
    .select()
    .single();
  if (error) throw new Error(`Failed to save competitor: ${error.message}`);
  return data as CompetitorRow;
}

const SORT_COLUMNS = {
  score: "competitor_score",
  relevance: "relevance_score",
  appearances: "serp_appearances",
} as const;

export type CompetitorSort = keyof typeof SORT_COLUMNS;

export async function listCompetitors(
  projectId: string,
  options: { type?: CompetitorType; sort?: CompetitorSort; order?: "asc" | "desc" } = {},
): Promise<CompetitorRow[]> {
  let query = supabaseAdmin().from("project_competitors").select("*").eq("project_id", projectId).neq("status", "removed");
  if (options.type) query = query.eq("competitor_type", options.type);
  const { data, error } = await query
    .order(SORT_COLUMNS[options.sort ?? "score"], { ascending: options.order === "asc", nullsFirst: false })
    .order("competitor_score", { ascending: false });
  if (error) throw new Error(`Failed to list competitors: ${error.message}`);
  return (data ?? []) as CompetitorRow[];
}

export async function getCompetitor(
  projectId: string,
  competitorId: string,
): Promise<{ competitor: CompetitorRow; appearances: CompetitorSerpAppearance[] } | null> {
  const { data, error } = await supabaseAdmin()
    .from("project_competitors")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", competitorId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load competitor: ${error.message}`);
  if (!data) return null;
  const competitor = data as CompetitorRow;
  const rows = await getSerpRowsForDomain(projectId, competitor.domain);
  return {
    competitor,
    appearances: rows.map((r) => ({ query: r.query, position: r.position, url: r.url, title: r.title })),
  };
}

/** Soft delete: keeps the row as "removed" so rediscovery doesn't bring it back. */
export async function removeCompetitor(projectId: string, competitorId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("project_competitors")
    .update({ status: "removed", updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("id", competitorId)
    .select("id");
  if (error) throw new Error(`Failed to remove competitor: ${error.message}`);
  return (data ?? []).length > 0;
}

export function competitorStats(list: CompetitorRow[]): CompetitorStats {
  const top = [...list].sort((a, b) => b.competitor_score - a.competitor_score)[0];
  return {
    competitorsFound: list.length,
    directCompetitors: list.filter((c) => c.competitor_type === "direct").length,
    adjacentCompetitors: list.filter((c) => c.competitor_type === "adjacent").length,
    strongest: top ? { domain: top.domain, competitorScore: top.competitor_score } : null,
  };
}
