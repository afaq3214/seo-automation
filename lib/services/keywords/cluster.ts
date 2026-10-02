import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import { jaccard, titleCase } from "./text";

export interface ClusterInput {
  keyword: string;
  tokens: string[];
  searchVolume: number | null;
  demand?: number | null;
  intent?: string;
}

export interface ClusterAssignment {
  clusterName: string;
  isPrimary: boolean;
}

const AI_CLUSTER_LIMIT = 300;
const SIMILARITY_THRESHOLD = 0.5;
const MEMBERS_COMPARED = 25;

interface Cluster {
  name: string;
  members: ClusterInput[];
  tokenSets: Set<string>[];
}

/**
 * Group keywords into topic clusters.
 * 1. Claude groups the top ~300 keywords (input is expected sorted by importance) by topic.
 * 2. Every other keyword joins the most similar cluster (token overlap), or starts its own.
 * The highest-volume keyword in each cluster becomes its primary keyword.
 */
export async function clusterKeywords(
  items: ClusterInput[],
  businessType: string,
): Promise<Map<string, ClusterAssignment>> {
  const head = items.slice(0, AI_CLUSTER_LIMIT);
  const clusters = await aiClusters(head, businessType);
  const assigned = new Set(clusters.flatMap((c) => c.members.map((m) => m.keyword)));

  const rest = items
    .filter((i) => !assigned.has(i.keyword))
    .sort(byStrength);

  for (const item of rest) {
    const set = new Set(item.tokens);
    let best: Cluster | null = null;
    let bestScore = 0;
    for (const c of clusters) {
      for (const s of c.tokenSets.slice(0, MEMBERS_COMPARED)) {
        const score = jaccard(set, s);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    if (best && bestScore >= SIMILARITY_THRESHOLD) {
      best.members.push(item);
      best.tokenSets.push(set);
    } else {
      clusters.push({ name: titleCase(item.keyword), members: [item], tokenSets: [set] });
    }
  }

  const result = new Map<string, ClusterAssignment>();
  const usedNames = new Set<string>();
  for (const c of clusters) {
    const primary = [...c.members].sort((a, b) => byStrength(a, b) || a.keyword.length - b.keyword.length)[0];
    let name = c.name;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${c.name} ${n}`;
    usedNames.add(name.toLowerCase());
    for (const m of c.members) result.set(m.keyword, { clusterName: name, isPrimary: m === primary });
  }

  logger.info("keywords clustered", { keywords: items.length, clusters: clusters.length, aiClustered: assigned.size });
  return result;
}

function byStrength(a: ClusterInput, b: ClusterInput): number {
  return (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || (b.demand ?? 0) - (a.demand ?? 0);
}

const clusterSchema = z.object({
  clusters: z.array(z.object({ name: z.string(), keywordIndexes: z.array(z.number().int()) })),
});

async function aiClusters(head: ClusterInput[], businessType: string): Promise<Cluster[]> {
  if (!head.length) return [];
  try {
    const out = await claudeJson({
      label: "keyword clustering",
      schema: clusterSchema,
      maxTokens: 8000,
      system: [
        "Group SEO keywords into topic clusters. A cluster = keywords one web page could target together",
        "(same topic and same search intent; synonyms and close variants belong together).",
        "Each keyword is shown with its search intent in brackets. Never mix informational keywords with",
        "commercial/transactional ones, and keep different products or services in separate clusters.",
        "Name each cluster with a short descriptive title of 2-6 words in the keywords' language.",
        "Each keyword index must appear in exactly one cluster. Single-keyword clusters are fine.",
        `The keywords are for a ${businessType}.`,
      ].join("\n"),
      user: head.map((k, i) => `${i}. ${k.keyword}${k.intent ? ` [${k.intent}]` : ""}`).join("\n"),
    });

    const taken = new Set<number>();
    const clusters: Cluster[] = [];
    for (const c of out.clusters) {
      const members = c.keywordIndexes.filter((i) => head[i] && !taken.has(i));
      members.forEach((i) => taken.add(i));
      if (!members.length) continue;
      clusters.push({
        name: c.name.trim() || titleCase(head[members[0]].keyword),
        members: members.map((i) => head[i]),
        tokenSets: members.map((i) => new Set(head[i].tokens)),
      });
    }
    return clusters;
  } catch (err) {
    logger.warn("AI clustering failed, using text similarity only", { error: errorMessage(err) });
    return [];
  }
}
