import { closeBrowser } from "../crawler/render";
import { getProject } from "../projects";
import { classifyCompetitor } from "./classify";
import { CompetitorError, toRow, type DomainCandidate } from "./discover";
import { parseDomainInput, rootDomain } from "./domains";
import { fetchCompetitorHomepage } from "./homepage";
import { getSerpRowsForDomain, upsertCompetitor } from "./repository";
import type { CompetitorRow } from "@/lib/types";

/**
 * Add a competitor the user knows about: validate the domain, fetch its homepage, classify, score, save.
 * SERP appearances come from the last discovery run (0 if it never showed up).
 * Re-adding a removed competitor brings it back.
 */
export async function addManualCompetitor(projectId: string, domainInput: string): Promise<CompetitorRow> {
  const project = await getProject(projectId);
  if (!project) throw new CompetitorError("Project not found", 404);
  if (!project.analysis) throw new CompetitorError("Run the website analysis for this project first", 409);

  let domain: string;
  try {
    domain = parseDomainInput(domainInput);
  } catch (err) {
    throw new CompetitorError((err as Error).message, 400);
  }
  if (domain === rootDomain(project.domain)) throw new CompetitorError("That's this project's own website", 400);

  const serpRows = await getSerpRowsForDomain(projectId, domain);
  // The homepage fetch may launch Playwright for JS-heavy sites; always close it.
  const homepage = await fetchCompetitorHomepage(domain).finally(closeBrowser);
  if (homepage.status === "failed" && !serpRows.length) {
    throw new CompetitorError(`Could not reach ${domain}. Check the domain and try again.`, 400);
  }

  const candidate: DomainCandidate = { domain, positions: new Map(), titles: [], descriptions: [] };
  for (const r of serpRows) {
    const prev = candidate.positions.get(r.query);
    if (prev == null || r.position < prev) candidate.positions.set(r.query, r.position);
    if (r.title) candidate.titles.push(r.title);
    if (r.description) candidate.descriptions.push(r.description);
  }

  const classification = await classifyCompetitor({
    analysis: project.analysis,
    domain,
    homepage,
    serpTitles: candidate.titles,
    serpDescriptions: candidate.descriptions,
    queries: [...candidate.positions.keys()],
  });

  const totalQueries = Math.max(project.competitor_queries.length, candidate.positions.size);
  return upsertCompetitor(toRow(projectId, candidate, homepage, classification, totalQueries, true));
}
