import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, buttonClass, Card, CardHeader, difficultyTone, formatDate, Notice, ScoreBar, StatCard, TextLink } from "@/components/ui";
import { errorMessage, logger } from "@/lib/logger";
import { competitorStats, listCompetitors } from "@/lib/services/competitors/repository";
import { keywordStats, listKeywords } from "@/lib/services/keywords/repository";
import { getProject } from "@/lib/services/projects";
import { listOpportunities } from "@/lib/services/strategy/repository";
import { headers } from "next/headers";
import { after } from "next/server";
import { env } from "@/lib/env";
import { kickAutomation } from "@/lib/services/automation/kick";
import { listEvents, STEP_LABELS, type AutoStep } from "@/lib/services/automation/engine";
import type { AutomationEvent, CompetitorRow, ContentOpportunity, KeywordRow, KeywordStats } from "@/lib/types";
import { AutomationCard, type AutomationState } from "./automation-card";

export const dynamic = "force-dynamic";

/** Loads a section's data without failing the whole page (e.g. a migration not run yet). */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`overview: ${label} unavailable`, { error: errorMessage(err) });
    return fallback;
  }
}

export default async function ProjectOverviewPage(props: PageProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  const project = await getProject(projectId);
  if (!project) notFound();
  const a = project.analysis;

  const [kw, topKeywords, competitors, opportunities] = await Promise.all([
    safe<{ stats: KeywordStats } | null>("keywords", () => keywordStats(projectId), null),
    safe<KeywordRow[]>(
      "top keywords",
      async () => (await listKeywords(projectId, { sort: "opportunity", order: "desc", limit: 5, offset: 0 })).keywords,
      [],
    ),
    safe<CompetitorRow[]>("competitors", () => listCompetitors(projectId), []),
    safe<ContentOpportunity[]>("strategy", () => listOpportunities(projectId), []),
  ]);
  const cStats = competitorStats(competitors);
  const base = `/projects/${projectId}`;
  const events = await safe<AutomationEvent[]>("automation", () => listEvents(projectId, 15), []);
  const locked = !!project.auto_locked_until && Date.parse(project.auto_locked_until) > Date.now();
  // Watchdog: while someone looks at this page, restart a stalled chain (a tick with nothing due is a no-op,
  // and the per-project lease prevents double work).
  const waiting = !!project.auto_retry_at && Date.parse(project.auto_retry_at) > Date.now();
  if (project.auto_enabled && !locked && !waiting) {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    after(() => kickAutomation(origin));
  }
  const stepLabel = (s: string | null) => (s && s in STEP_LABELS ? STEP_LABELS[s as AutoStep] : s);
  const automation: AutomationState = {
    enabled: !!project.auto_enabled,
    running: locked ? stepLabel(project.auto_step) : null,
    lastStep: stepLabel(project.auto_step ?? null),
    error: project.auto_error ?? null,
    retryAt: project.auto_retry_at ?? null,
    nextPostAt: project.auto_next_post_at ?? null,
    strategyAt: project.strategy_generated_at,
    refreshDays: env().AUTO_STRATEGY_REFRESH_DAYS,
    optimizeAfterDays: env().AUTO_OPTIMIZE_AFTER_DAYS,
    articleInProgress: !!project.auto_article_id,
  };

  if (!a) {
    return (
      <Notice tone="warning">
        This project has no website analysis ({project.status}
        {project.error ? `: ${project.error}` : ""}). Create it again from “New project”.
      </Notice>
    );
  }

  return (
    <div className="space-y-6">
      <AutomationCard projectId={projectId} state={automation} events={events} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pages crawled" value={project.pages_crawled} hint={`Analyzed ${formatDate(project.analyzed_at)}`} />
        <StatCard label="Keywords" value={kw?.stats.totalKeywords ?? 0} hint={`${kw?.stats.totalClusters ?? 0} clusters`} />
        <StatCard label="Competitors" value={cStats.competitorsFound} hint={`${cStats.directCompetitors} direct`} />
        <StatCard
          label="Content opportunities"
          value={opportunities.length}
          hint={opportunities[0] ? `Top score ${opportunities[0].opportunity_score}` : "Not generated"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Left column: the business */}
        <Card className="xl:col-span-1">
          <CardHeader title="Business analysis" description={a.businessType} />
          <div className="space-y-5 p-5 text-sm">
            <p className="leading-6 text-slate-700">{a.businessSummary}</p>
            <Section title="Target customer">
              <p className="text-slate-700">{a.targetCustomer}</p>
            </Section>
            <Section title="Products & services">
              <Tags items={a.mainOfferings} tone="indigo" />
            </Section>
            <Section title="Industries">
              <Tags items={a.likelyIndustries} />
            </Section>
            <Section title="Important topics">
              <Tags items={a.importantTopics} />
            </Section>
          </div>
        </Card>

        {/* Right columns: workflow modules */}
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Top keyword opportunities"
              description={kw ? `${kw.stats.totalKeywords} keywords · ${kw.stats.commercialKeywords} commercial` : "Not researched yet"}
              actions={<TextLink href={`${base}/keywords`}>View all →</TextLink>}
            />
            {topKeywords.length ? (
              <ul className="divide-y divide-slate-100">
                {topKeywords.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{k.keyword}</p>
                      <p className="truncate text-xs text-slate-500">{k.cluster_name}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {k.estimated_difficulty != null && (
                        <Badge tone={difficultyTone(k.estimated_difficulty)}>KD {k.estimated_difficulty}</Badge>
                      )}
                      <ScoreBar score={k.opportunity_score} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <ModuleEmpty text="Discover keywords from the website analysis." href={`${base}/keywords`} cta="Research keywords" />
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Competitors"
                description={cStats.strongest ? `Strongest: ${cStats.strongest.domain}` : "Not discovered yet"}
                actions={<TextLink href={`${base}/competitors`}>View all →</TextLink>}
              />
              {competitors.length ? (
                <ul className="divide-y divide-slate-100">
                  {competitors.slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.domain}</p>
                        <p className="text-xs capitalize text-slate-500">{c.competitor_type ?? "pending review"}</p>
                      </div>
                      <ScoreBar score={c.competitor_score} />
                    </li>
                  ))}
                </ul>
              ) : (
                <ModuleEmpty text="Find competitors from Google results." href={`${base}/competitors`} cta="Find competitors" />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Content strategy"
                description={opportunities.length ? `${opportunities.length} opportunities` : "Not generated yet"}
                actions={<TextLink href={`${base}/strategy`}>View all →</TextLink>}
              />
              {opportunities.length ? (
                <ul className="divide-y divide-slate-100">
                  {opportunities.slice(0, 5).map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{o.primary_keyword}</p>
                        <p className="truncate text-xs text-slate-500">{o.topic}</p>
                      </div>
                      <ScoreBar score={o.opportunity_score} />
                    </li>
                  ))}
                </ul>
              ) : (
                <ModuleEmpty text="Turn keywords and competitors into a content plan." href={`${base}/strategy`} cta="Generate strategy" />
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function Tags({ items, tone = "slate" }: { items: string[]; tone?: "slate" | "indigo" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Badge key={i} tone={tone}>
          {i}
        </Badge>
      ))}
    </div>
  );
}

function ModuleEmpty({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <p className="text-sm text-slate-500">{text}</p>
      <Link href={href} className={buttonClass("secondary", "sm")}>
        {cta}
      </Link>
    </div>
  );
}
