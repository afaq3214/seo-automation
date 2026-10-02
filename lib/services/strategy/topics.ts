import { supabaseAdmin } from "@/lib/supabase";
import type { KeywordRow, SearchIntent, SerpResult } from "@/lib/types";
import { jaccard, tokenSet } from "../keywords/text";

export type TopicKeyword = Pick<
  KeywordRow,
  "keyword" | "search_volume" | "demand_score" | "intent" | "cluster_name" | "is_primary_keyword" | "relevance_score" | "estimated_difficulty"
> & { serp_top10: SerpResult[] | null };

export interface Topic {
  /** Strongest keyword — used for the SERP check and as the default primary keyword */
  primary: TopicKeyword;
  members: TopicKeyword[];
  intent: SearchIntent;
}

const MERGE_SIMILARITY = 0.6;
const PAGE = 1000;

/** All keywords of a project from Module 02 (paged past Supabase's 1000-row limit). */
export async function loadProjectKeywords(projectId: string): Promise<TopicKeyword[]> {
  const rows: TopicKeyword[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin()
      .from("project_keywords")
      .select(
        "keyword,search_volume,demand_score,intent,cluster_name,is_primary_keyword,relevance_score,estimated_difficulty,serp_top10",
      )
      .eq("project_id", projectId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load keywords: ${error.message}`);
    rows.push(...((data ?? []) as TopicKeyword[]));
    if (!data || data.length < PAGE) break;
  }
  return rows.map((r) => ({
    ...r,
    relevance_score: Number(r.relevance_score),
    demand_score: r.demand_score == null ? null : Number(r.demand_score),
  }));
}

/** Volume when known, otherwise estimated demand (scaled so both sort the same way). */
export function keywordStrength(k: TopicKeyword): number {
  return k.search_volume ?? (k.demand_score ?? 0) * 100;
}

/**
 * Keywords → article topics. Starts from the Module 02 clusters, then merges clusters whose
 * primary keywords are near-duplicates (mostly the same words once stop words are dropped, e.g.
 * "missed call automation" / "best missed call automation") and share an intent class.
 * Industry variants ("… for restaurants") stay separate topics on purpose.
 */
export function buildTopics(keywords: TopicKeyword[]): Topic[] {
  const byCluster = new Map<string, TopicKeyword[]>();
  for (const k of keywords) {
    const list = byCluster.get(k.cluster_name) ?? [];
    list.push(k);
    byCluster.set(k.cluster_name, list);
  }

  const topics: Topic[] = [...byCluster.values()].map((members) => {
    const sorted = [...members].sort((a, b) => keywordStrength(b) - keywordStrength(a));
    const primary = members.find((m) => m.is_primary_keyword) ?? sorted[0];
    return { primary, members: sorted, intent: primary.intent };
  });

  // Rule-based merge of near-duplicate topics.
  const merged: Topic[] = [];
  const sets: Set<string>[] = [];
  for (const t of topics.sort((a, b) => keywordStrength(b.primary) - keywordStrength(a.primary))) {
    const set = tokenSet(t.primary.keyword);
    const i = merged.findIndex(
      (m, idx) => sameIntentClass(m.intent, t.intent) && jaccard(sets[idx], set) >= MERGE_SIMILARITY,
    );
    if (i >= 0) merged[i].members.push(...t.members);
    else {
      merged.push({ ...t, members: [...t.members] });
      sets.push(set);
    }
  }
  return merged;
}

function sameIntentClass(a: SearchIntent, b: SearchIntent): boolean {
  const cls = (i: SearchIntent) => (i === "commercial" || i === "transactional" ? "buy" : i);
  return cls(a) === cls(b);
}
