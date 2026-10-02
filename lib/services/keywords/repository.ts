import { supabaseAdmin } from "@/lib/supabase";
import type { ClusterSummary, KeywordRow, KeywordStats, SearchIntent } from "@/lib/types";

export type NewKeywordRow = Omit<KeywordRow, "id" | "created_at" | "updated_at">;

const PAGE = 1000; // Supabase returns at most 1000 rows per request

/**
 * Upsert this run's keywords, then delete the project's keywords that weren't in this run.
 * Upsert-then-delete means a failed save never leaves the project with an empty keyword list.
 */
export async function replaceProjectKeywords(projectId: string, rows: NewKeywordRow[]): Promise<void> {
  const db = supabaseAdmin();
  const runStartedAt = new Date().toISOString();

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await db.from("project_keywords").upsert(batch, { onConflict: "project_id,keyword" });
    if (error) throw new Error(`Failed to save keywords: ${error.message}`);
  }

  const { error } = await db.from("project_keywords").delete().eq("project_id", projectId).lt("updated_at", runStartedAt);
  if (error) throw new Error(`Failed to remove old keywords: ${error.message}`);
}

export interface KeywordFilters {
  minVolume?: number;
  maxDifficulty?: number;
  intent?: SearchIntent;
  cluster?: string;
  q?: string;
  sort: "opportunity" | "volume" | "difficulty" | "cpc";
  order: "asc" | "desc";
  limit: number;
  offset: number;
}

const SORT_COLUMNS = {
  opportunity: "opportunity_score",
  volume: "search_volume",
  difficulty: "estimated_difficulty",
  cpc: "cpc_high",
} as const;

/** List columns — everything except the bulky SERP snapshot. */
const LIST_COLUMNS =
  "id,project_id,keyword,search_volume,competition,competition_index,cpc_low,cpc_high,intent,cluster_name," +
  "is_primary_keyword,relevance_score,demand_score,estimated_difficulty,difficulty_label,difficulty_status,opportunity_score," +
  "serp_checked_at,country,language,source,created_at,updated_at";

export async function listKeywords(
  projectId: string,
  f: KeywordFilters,
): Promise<{ keywords: KeywordRow[]; total: number }> {
  let query = supabaseAdmin()
    .from("project_keywords")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("project_id", projectId);

  if (f.minVolume != null) query = query.gte("search_volume", f.minVolume);
  if (f.maxDifficulty != null) query = query.lte("estimated_difficulty", f.maxDifficulty);
  if (f.intent) query = query.eq("intent", f.intent);
  if (f.cluster) query = query.eq("cluster_name", f.cluster);
  if (f.q) query = query.ilike("keyword", `%${f.q.replace(/[%_\\]/g, "\\$&")}%`);

  const ascending = f.order === "asc";
  query = query.order(SORT_COLUMNS[f.sort], { ascending, nullsFirst: false });
  // Without real volumes (Serper discovery), "volume" sorting uses the estimated demand.
  if (f.sort === "volume") query = query.order("demand_score", { ascending, nullsFirst: false });

  const { data, error, count } = await query
    .order("keyword", { ascending: true })
    .range(f.offset, f.offset + f.limit - 1);
  if (error) throw new Error(`Failed to list keywords: ${error.message}`);
  return { keywords: (data ?? []) as unknown as KeywordRow[], total: count ?? 0 };
}

export async function getKeyword(projectId: string, keywordId: string): Promise<KeywordRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("project_keywords")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", keywordId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load keyword: ${error.message}`);
  return (data as KeywordRow | null) ?? null;
}

export async function countKeywords(projectId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("project_keywords")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) throw new Error(`Failed to count keywords: ${error.message}`);
  return count ?? 0;
}

type StatsRow = Pick<
  KeywordRow,
  "keyword" | "search_volume" | "intent" | "cluster_name" | "estimated_difficulty" | "opportunity_score"
>;

/** Dashboard totals + cluster list, computed over all of the project's keywords. */
export async function keywordStats(projectId: string): Promise<{ stats: KeywordStats; clusters: ClusterSummary[] }> {
  const rows: StatsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin()
      .from("project_keywords")
      .select("keyword,search_volume,intent,cluster_name,estimated_difficulty,opportunity_score")
      .eq("project_id", projectId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load keyword stats: ${error.message}`);
    rows.push(...((data ?? []) as StatsRow[]));
    if (!data || data.length < PAGE) break;
  }

  const clusters = new Map<string, ClusterSummary>();
  let top: StatsRow | null = null;
  for (const r of rows) {
    const c = clusters.get(r.cluster_name) ?? { name: r.cluster_name, keywordCount: 0, totalVolume: 0 };
    c.keywordCount++;
    c.totalVolume += r.search_volume ?? 0;
    clusters.set(r.cluster_name, c);
    if (!top || r.opportunity_score > top.opportunity_score) top = r;
  }

  return {
    stats: {
      totalKeywords: rows.length,
      totalClusters: clusters.size,
      easyKeywords: rows.filter((r) => r.estimated_difficulty != null && r.estimated_difficulty <= 30).length,
      commercialKeywords: rows.filter((r) => r.intent === "commercial" || r.intent === "transactional").length,
      topOpportunity: top ? { keyword: top.keyword, opportunityScore: top.opportunity_score } : null,
      hasSearchVolume: rows.some((r) => r.search_volume != null),
    },
    clusters: [...clusters.values()].sort((a, b) => b.totalVolume - a.totalVolume || b.keywordCount - a.keywordCount),
  };
}
