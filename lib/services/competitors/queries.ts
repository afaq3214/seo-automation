import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type { Project } from "@/lib/types";
import { normalizeKeyword } from "../keywords/text";

const querySchema = z.object({ queries: z.array(z.string()) });

/**
 * 5–10 Google searches a potential customer would make when looking for what this business sells.
 * Uses the Module 01 analysis, plus the top Module 02 keywords as hints when they exist.
 */
export async function generateDiscoveryQueries(project: Project, max: number): Promise<string[]> {
  const a = project.analysis!;
  const hints = await topKeywordHints(project.id);
  let queries: string[] = [];

  try {
    const out = await claudeJson({
      label: "competitor discovery queries",
      schema: querySchema,
      system: [
        `Write ${Math.min(5, max)}-${max} Google search queries that would surface this business's competitors:`,
        "searches a potential customer makes when looking for the product/service this business sells.",
        "- 2 to 5 words each, commercial or transactional (someone looking for a provider)",
        "- cover the main offerings first; add the target country/city only where locality matters",
        "- no brand names, no informational questions, no near-duplicates",
        `- in the language with code "${project.language}", as searched in country "${project.country}"`,
      ].join("\n"),
      user: [
        `Website: ${project.domain}`,
        `Business type: ${a.businessType}`,
        `Main offerings: ${a.mainOfferings.join("; ")}`,
        `Target customer: ${a.targetCustomer}`,
        `Industries: ${a.likelyIndustries.join("; ")}`,
        `Important topics: ${a.importantTopics.join("; ")}`,
        `Summary: ${a.businessSummary}`,
        hints.length ? `Top keywords from keyword research: ${hints.join("; ")}` : "",
      ].join("\n"),
    });
    queries = out.queries;
  } catch (err) {
    logger.warn("discovery query generation failed, using offerings", { error: errorMessage(err) });
  }

  const unique = [...new Set([...queries, ...(queries.length < 3 ? a.mainOfferings : [])].map(normalizeKeyword))].filter(
    (q): q is string => Boolean(q),
  );
  return unique.slice(0, max);
}

async function topKeywordHints(projectId: string): Promise<string[]> {
  const { data } = await supabaseAdmin()
    .from("project_keywords")
    .select("keyword")
    .eq("project_id", projectId)
    .eq("is_primary_keyword", true)
    .in("intent", ["commercial", "transactional"])
    .order("opportunity_score", { ascending: false })
    .limit(10);
  return (data ?? []).map((r) => r.keyword as string);
}
