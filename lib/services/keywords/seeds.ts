import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import type { Project } from "@/lib/types";
import { normalizeKeyword } from "./text";

const MIN_SEEDS = 5;
const MAX_SEEDS = 15;

const seedSchema = z.object({ seeds: z.array(z.string()) });

/** 5–15 short, generic seed keywords generated from the Module 01 business analysis. */
export async function generateSeedKeywords(project: Project): Promise<string[]> {
  const a = project.analysis!;
  let seeds: string[] = [];

  try {
    const result = await claudeJson({
      label: "seed keywords",
      schema: seedSchema,
      system: [
        "You are an SEO keyword researcher. Generate seed keywords for Google Keyword Planner.",
        `Return ${MIN_SEEDS}-${MAX_SEEDS} seed keywords that potential customers would type into Google.`,
        "Rules:",
        "- 1 to 4 words each, generic category terms (no brand names, not the business's own name)",
        "- cover the main offerings first, then the most important use cases or industries",
        "- no near-duplicates (don't list both singular and plural)",
        `- write them in the language with code "${project.language}", as people in country "${project.country}" search`,
      ].join("\n"),
      user: [
        `Website: ${project.domain}`,
        `Business type: ${a.businessType}`,
        `Main offerings: ${a.mainOfferings.join("; ")}`,
        `Target customer: ${a.targetCustomer}`,
        `Industries: ${a.likelyIndustries.join("; ")}`,
        `Important topics: ${a.importantTopics.join("; ")}`,
        `Summary: ${a.businessSummary}`,
      ].join("\n"),
    });
    seeds = result.seeds;
  } catch (err) {
    logger.warn("seed generation via Claude failed, using analysis topics", { error: errorMessage(err) });
  }

  const unique = dedupe(seeds);
  if (unique.length >= MIN_SEEDS) return unique.slice(0, MAX_SEEDS);

  // Fallback: offerings and topics straight from the analysis.
  return dedupe([...unique, ...a.mainOfferings, ...a.importantTopics])
    .filter((s) => s.split(" ").length <= 5)
    .slice(0, MAX_SEEDS);
}

function dedupe(list: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const k = normalizeKeyword(raw);
    if (k) out.add(k);
  }
  return [...out];
}
