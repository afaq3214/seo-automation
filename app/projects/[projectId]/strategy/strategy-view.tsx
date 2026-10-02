"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  CardHeader,
  cn,
  DetailGrid,
  difficultyTone,
  EmptyState,
  formatDate,
  Notice,
  PageHeader,
  ProgressSteps,
  ScoreBar,
  SortTh,
  StatCard,
  Table,
  Td,
  Th,
  type BadgeTone,
} from "@/components/ui";
import { Drawer } from "@/components/drawer";
import { readJson } from "@/components/read-json";
import { useStreamJob } from "@/components/use-stream-job";
import type {
  ArticleEvent,
  ArticleStep,
  ContentOpportunity,
  ContentType,
  SearchIntent,
  StrategyEvent,
  StrategyStep,
} from "@/lib/types";

interface StrategyResponse {
  project: { strategyStatus: string; strategyError: string | null; strategyGeneratedAt: string | null };
  opportunities: ContentOpportunity[];
}

type SortKey = "score" | "competitors" | "difficulty";

const STEPS: { key: StrategyStep; label: string }[] = [
  { key: "loading", label: "Loading data" },
  { key: "coverage", label: "Existing pages" },
  { key: "rankings", label: "Competitor rankings" },
  { key: "scoring", label: "Scoring" },
  { key: "writing", label: "Writing strategy" },
  { key: "complete", label: "Complete" },
];

const CONTENT_TYPE: Record<ContentType, [string, BadgeTone]> = {
  blog_post: ["Blog post", "slate"],
  guide: ["Guide", "sky"],
  comparison: ["Comparison", "violet"],
  listicle: ["Listicle", "sky"],
  landing_page: ["Landing page", "emerald"],
  faq: ["FAQ page", "slate"],
};

const INTENT_TONE: Record<SearchIntent, BadgeTone> = {
  informational: "sky",
  commercial: "violet",
  transactional: "emerald",
  navigational: "slate",
};

type CompleteEvent = Extract<StrategyEvent, { type: "complete" }>;
type ArticleComplete = Extract<ArticleEvent, { type: "complete" }>;

const ARTICLE_STEPS: { key: ArticleStep; label: string }[] = [
  { key: "serp", label: "Google research" },
  { key: "pages", label: "Top pages" },
  { key: "brief", label: "Brief" },
  { key: "writing", label: "Writing" },
  { key: "saving", label: "Saving" },
  { key: "complete", label: "Done" },
];

export function StrategyView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<StrategyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [selected, setSelected] = useState<ContentOpportunity | null>(null);
  const [typeFilter, setTypeFilter] = useState<"" | ContentType>("");
  const [sort, setSort] = useState<SortKey>("score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const job = useStreamJob<StrategyStep, CompleteEvent>();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/strategy`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setData(json);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const all = useMemo(() => data?.opportunities ?? [], [data]);
  const rows = useMemo(() => {
    const value = (o: ContentOpportunity) =>
      sort === "competitors" ? o.competitor_count : sort === "difficulty" ? (o.estimated_difficulty ?? 101) : o.opportunity_score;
    return all
      .filter((o) => !typeFilter || o.content_type === typeFilter)
      .sort((a, b) => (order === "asc" ? value(a) - value(b) : value(b) - value(a)));
  }, [all, typeFilter, sort, order]);

  function generate() {
    setNotices([]);
    void job.run(`/api/projects/${projectId}/strategy/generate`, {}, async (e) => {
      setNotices(e.warnings);
      await load();
    });
  }

  function onSort(k: SortKey) {
    if (k === sort) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setOrder(k === "difficulty" ? "asc" : "desc");
    }
  }

  function onDrafted(updated: ContentOpportunity) {
    setData((d) => d && { ...d, opportunities: d.opportunities.map((o) => (o.id === updated.id ? updated : o)) });
    setSelected(updated);
  }

  const types = [...new Set(all.map((o) => o.content_type))];
  const drafted = all.filter((o) => o.status === "drafted").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SEO strategy"
        description={`Topics competitors rank for that this site doesn't cover yet · generated ${formatDate(data?.project.strategyGeneratedAt)}`}
        actions={
          <Button onClick={generate} disabled={job.running}>
            {job.running ? "Generating…" : all.length ? "Refresh strategy" : "Generate strategy"}
          </Button>
        }
      />

      {job.visible && <ProgressSteps steps={STEPS} current={job.step} running={job.running} error={job.error} />}
      {notices.map((n) => (
        <Notice key={n} tone="warning">
          {n}
        </Notice>
      ))}
      {data?.project.strategyStatus === "failed" && !job.visible && data.project.strategyError && (
        <Notice tone="error">Last run failed: {data.project.strategyError}</Notice>
      )}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Opportunities" value={all.length} />
        <StatCard label="Top score" value={all[0]?.opportunity_score ?? "—"} hint={all[0]?.primary_keyword} />
        <StatCard label="Landing pages" value={all.filter((o) => o.content_type === "landing_page").length} hint="commercial pages to build" />
        <StatCard label="Drafts written" value={drafted} />
      </div>

      {!all.length && !loading && !job.running ? (
        <EmptyState
          title="No strategy yet"
          description="Run keyword research and competitor discovery first, then generate the strategy to find topics your competitors rank for and you don't."
          action={<Button onClick={generate}>Generate strategy</Button>}
        />
      ) : (
        <Card>
          <CardHeader
            title="Content opportunities"
            description="Click a row for the full brief"
            actions={
              <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                {(["", ...types] as ("" | ContentType)[]).map((t) => (
                  <button
                    key={t || "all"}
                    onClick={() => setTypeFilter(t)}
                    className={cn(
                      "rounded-md px-3 py-1",
                      typeFilter === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900",
                    )}
                  >
                    {t ? CONTENT_TYPE[t][0] : "All"}
                  </button>
                ))}
              </div>
            }
          />
          <Table minWidth={940}>
            <thead>
              <tr>
                <Th className="w-10">#</Th>
                <Th>Topic</Th>
                <Th>Type</Th>
                <Th>Intent</Th>
                <Th>Demand</Th>
                <SortTh label="Difficulty" sortKey="difficulty" sort={sort} order={order} onSort={onSort} />
                <SortTh label="Competitors" sortKey="competitors" sort={sort} order={order} onSort={onSort} />
                <SortTh label="Score" sortKey="score" sort={sort} order={order} onSort={onSort} />
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className={cn(loading && "opacity-60")}>
              {rows.map((o, i) => (
                <tr key={o.id} onClick={() => setSelected(o)} className="cursor-pointer hover:bg-slate-50">
                  <Td className="tabular-nums text-slate-400">{i + 1}</Td>
                  <Td className="max-w-76">
                    <p className="truncate font-medium text-slate-900" title={o.topic}>
                      {o.topic}
                    </p>
                    <p className="truncate text-xs text-slate-500">{o.primary_keyword}</p>
                  </Td>
                  <Td>
                    <Badge tone={CONTENT_TYPE[o.content_type][1]}>{CONTENT_TYPE[o.content_type][0]}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={INTENT_TONE[o.search_intent]}>{o.search_intent}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">{demandLabel(o)}</Td>
                  <Td>
                    {o.estimated_difficulty != null ? (
                      <Badge tone={difficultyTone(o.estimated_difficulty)}>{o.estimated_difficulty}</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                  <Td className="tabular-nums">{o.competitor_count}</Td>
                  <Td>
                    <ScoreBar score={o.opportunity_score} />
                  </Td>
                  <Td>{o.status === "drafted" ? <Badge tone="emerald">Draft ready</Badge> : <Badge>New</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {selected && (
        <OpportunityDrawer projectId={projectId} opportunity={selected} onClose={() => setSelected(null)} onDrafted={onDrafted} />
      )}
    </div>
  );
}

function demandLabel(o: ContentOpportunity): string {
  if (o.search_volume != null) return `${o.search_volume.toLocaleString()}/mo`;
  if (o.demand_score != null) return `${Number(o.demand_score).toFixed(1)} est.`;
  return "—";
}

function OpportunityDrawer({
  projectId,
  opportunity: o,
  onClose,
  onDrafted,
}: {
  projectId: string;
  opportunity: ContentOpportunity;
  onClose: () => void;
  onDrafted: (o: ContentOpportunity) => void;
}) {
  const job = useStreamJob<ArticleStep, ArticleComplete>();
  const [articleId, setArticleId] = useState<string | null>(null);

  function generateBlog() {
    void job.run(`/api/projects/${projectId}/articles/generate`, { opportunityId: o.id }, (e) => {
      setArticleId(e.article.id);
      onDrafted({ ...o, status: "drafted" });
    });
  }

  return (
    <Drawer open onClose={onClose} title={o.topic}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CONTENT_TYPE[o.content_type][1]}>{CONTENT_TYPE[o.content_type][0]}</Badge>
          <Badge tone={INTENT_TONE[o.search_intent]}>{o.search_intent}</Badge>
          <span className="ml-auto text-sm text-slate-500">
            Opportunity <span className="text-lg font-semibold text-slate-900">{o.opportunity_score}</span>/100
          </span>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Primary keyword</p>
          <p className="mt-1 text-base font-semibold">{o.primary_keyword}</p>
          {o.secondary_keywords.length > 0 && (
            <>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Secondary keywords</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {o.secondary_keywords.map((k) => (
                  <Badge key={k}>{k}</Badge>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Why create it</p>
          <p className="mt-1 text-sm leading-6 text-slate-700">{o.reason}</p>
        </div>

        <DetailGrid
          items={[
            { label: "Demand", value: demandLabel(o) },
            { label: "Estimated difficulty", value: o.estimated_difficulty ?? "Not checked" },
            { label: "Relevance", value: `${Math.round(o.relevance_score * 100)}%` },
            { label: "Competitors ranking", value: o.competitor_count },
          ]}
        />

        {o.competitor_rankings.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Competitor pages ranking now</p>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {o.competitor_rankings.map((r) => (
                <li key={r.domain} className="flex gap-3 px-3 py-2.5">
                  <span className="w-8 shrink-0 text-right tabular-nums text-slate-400">#{r.position}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{r.domain}</p>
                    <a href={r.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-slate-500 hover:text-indigo-600">
                      {r.title || r.url}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {o.coverage === "partial" && o.existing_page_url && (
          <Notice tone="warning">
            Partly covered by{" "}
            <a href={o.existing_page_url} target="_blank" rel="noreferrer" className="font-medium underline">
              {o.existing_page_url}
            </a>
            . Link the new page to it, or expand that page instead.
          </Notice>
        )}

        <div className="space-y-3 border-t border-slate-200 pt-5">
          {job.visible && <ProgressSteps steps={ARTICLE_STEPS} current={job.step} running={job.running} error={job.error} />}
          {articleId ? (
            <Link href={`/projects/${projectId}/articles/${articleId}`} className={buttonClass("primary") + " w-full"}>
              Open the draft →
            </Link>
          ) : (
            <Button onClick={generateBlog} disabled={job.running} className="w-full">
              {job.running
                ? "Writing… (1–3 minutes)"
                : o.status === "drafted"
                  ? "Generate another draft"
                  : "Generate blog for this opportunity"}
            </Button>
          )}
          {o.status === "drafted" && !articleId && (
            <p className="text-center text-xs text-slate-500">
              A draft already exists — see{" "}
              <Link href={`/projects/${projectId}/articles`} className="text-indigo-600 hover:text-indigo-500">
                Articles
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </Drawer>
  );
}
