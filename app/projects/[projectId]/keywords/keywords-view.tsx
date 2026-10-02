"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  cn,
  DetailGrid,
  difficultyTone,
  EmptyState,
  formatDate,
  formatNumber,
  inputClass,
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
import type { ClusterSummary, KeywordResearchEvent, KeywordResearchStep, KeywordRow, KeywordStats, SearchIntent } from "@/lib/types";

type SortKey = "opportunity" | "volume" | "difficulty" | "cpc";

interface Filters {
  minVolume: string;
  maxDifficulty: string;
  intent: "" | SearchIntent;
  cluster: string;
  q: string;
}

interface ListResponse {
  project: { keywordsStatus: string; keywordsError: string | null; keywordsResearchedAt: string | null };
  stats?: KeywordStats;
  clusters?: ClusterSummary[];
  total: number;
  keywords: KeywordRow[];
}

const PAGE_SIZE = 50;
const EMPTY: Filters = { minVolume: "", maxDifficulty: "", intent: "", cluster: "", q: "" };

const STEPS: { key: KeywordResearchStep; label: string }[] = [
  { key: "seeds", label: "Seed keywords" },
  { key: "ideas", label: "Keyword ideas" },
  { key: "processing", label: "Processing" },
  { key: "grouping", label: "Grouping" },
  { key: "difficulty", label: "SEO difficulty" },
  { key: "complete", label: "Complete" },
];

export const INTENT_TONE: Record<SearchIntent, BadgeTone> = {
  informational: "sky",
  commercial: "violet",
  transactional: "emerald",
  navigational: "slate",
};

type CompleteEvent = Extract<KeywordResearchEvent, { type: "complete" }>;

export function KeywordsView({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [debounced, setDebounced] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<SortKey>("opportunity");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [stats, setStats] = useState<KeywordStats | null>(null);
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsVersion, setStatsVersion] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const job = useStreamJob<KeywordResearchStep, CompleteEvent>();

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(filters);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [filters]);

  const load = useCallback(
    async (withStats: boolean) => {
      setLoading(true);
      setLoadError(null);
      const params = new URLSearchParams({ sort, order, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      for (const [k, v] of Object.entries(debounced)) if (v) params.set(k, v);
      if (withStats) params.set("includeStats", "true");
      try {
        const res = await fetch(`/api/projects/${projectId}/keywords?${params}`);
        const json = await readJson(res);
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        setData(json);
        if (json.stats) setStats(json.stats);
        if (json.clusters) setClusters(json.clusters);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [projectId, sort, order, page, debounced],
  );

  const loadedStatsVersion = useRef(-1);
  useEffect(() => {
    const withStats = loadedStatsVersion.current !== statsVersion;
    loadedStatsVersion.current = statsVersion;
    void load(withStats);
  }, [load, statsVersion]);

  const hasKeywords = (stats?.totalKeywords ?? 0) > 0;
  const hasVolume = stats?.hasSearchVolume !== false;

  function research() {
    setNotices([]);
    void job.run(`/api/projects/${projectId}/keywords/research`, { refresh: hasKeywords }, (e) => {
      setNotices(e.reused ? ["Showing recent research — use Refresh to run it again."] : e.warnings);
      setPage(0);
      setStatsVersion((v) => v + 1);
    });
  }

  function onSort(k: SortKey) {
    if (k === sort) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setOrder(k === "difficulty" ? "asc" : "desc");
    }
    setPage(0);
  }

  const total = data?.total ?? 0;
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Keywords"
        description={`Last researched ${formatDate(data?.project.keywordsResearchedAt)}`}
        actions={
          <Button onClick={research} disabled={job.running}>
            {job.running ? "Researching…" : hasKeywords ? "Refresh research" : "Research keywords"}
          </Button>
        }
      />

      {job.visible && <ProgressSteps steps={STEPS} current={job.step} running={job.running} error={job.error} />}
      {notices.map((n) => (
        <Notice key={n} tone="warning">
          {n}
        </Notice>
      ))}
      {data?.project.keywordsStatus === "failed" && !job.visible && data.project.keywordsError && (
        <Notice tone="error">Last run failed: {data.project.keywordsError}</Notice>
      )}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Keywords" value={formatNumber(stats?.totalKeywords)} />
        <StatCard label="Clusters" value={formatNumber(stats?.totalClusters)} />
        <StatCard label="Easy (KD ≤ 30)" value={formatNumber(stats?.easyKeywords)} />
        <StatCard label="Commercial intent" value={formatNumber(stats?.commercialKeywords)} />
        <StatCard
          className="col-span-2 lg:col-span-1"
          label="Top opportunity"
          value={<span className="text-base">{stats?.topOpportunity?.keyword ?? "—"}</span>}
          hint={stats?.topOpportunity ? `Score ${stats.topOpportunity.opportunityScore}` : undefined}
        />
      </div>

      {!hasKeywords && !loading && !job.running ? (
        <EmptyState
          title="No keywords yet"
          description="Seed keywords are generated from the website analysis, expanded with Google autocomplete, cleaned, grouped and scored."
          action={<Button onClick={research}>Research keywords</Button>}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[240px_1fr]">
          {/* Filter column */}
          <Card className="h-fit">
            <CardHeader
              title="Filters"
              actions={
                Object.values(filters).some(Boolean) && (
                  <button onClick={() => setFilters(EMPTY)} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                    Clear
                  </button>
                )
              }
            />
            <div className="space-y-4 p-4">
              <Field label="Keyword contains">
                <input className={cn(inputClass, "w-full")} placeholder="e.g. dental" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
              </Field>
              {hasVolume && (
                <Field label="Min. search volume">
                  <input className={cn(inputClass, "w-full")} type="number" min={0} value={filters.minVolume} onChange={(e) => set({ minVolume: e.target.value })} />
                </Field>
              )}
              <Field label="Max. difficulty">
                <input className={cn(inputClass, "w-full")} type="number" min={0} max={100} value={filters.maxDifficulty} onChange={(e) => set({ maxDifficulty: e.target.value })} />
              </Field>
              <Field label="Intent">
                <select className={cn(inputClass, "w-full")} value={filters.intent} onChange={(e) => set({ intent: e.target.value as Filters["intent"] })}>
                  <option value="">All intents</option>
                  <option value="informational">Informational</option>
                  <option value="commercial">Commercial</option>
                  <option value="transactional">Transactional</option>
                  <option value="navigational">Navigational</option>
                </select>
              </Field>
              <Field label={`Clusters (${clusters.length})`}>
                <ul className="-mx-1 max-h-72 space-y-0.5 overflow-y-auto">
                  {clusters.map((c) => (
                    <li key={c.name}>
                      <button
                        onClick={() => set({ cluster: filters.cluster === c.name ? "" : c.name })}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                          filters.cluster === c.name ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 tabular-nums text-slate-400">{c.keywordCount}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Field>
            </div>
          </Card>

          {/* Table column */}
          <Card className="min-w-0">
            <Table minWidth={hasVolume ? 760 : 680}>
              <thead>
                <tr>
                  <Th>Keyword</Th>
                  <SortTh label={hasVolume ? "Volume" : "Demand (est.)"} sortKey="volume" sort={sort} order={order} onSort={onSort} />
                  <SortTh label="Difficulty" sortKey="difficulty" sort={sort} order={order} onSort={onSort} />
                  <Th>Intent</Th>
                  {hasVolume && <SortTh label="CPC" sortKey="cpc" sort={sort} order={order} onSort={onSort} />}
                  <SortTh label="Opportunity" sortKey="opportunity" sort={sort} order={order} onSort={onSort} />
                </tr>
              </thead>
              <tbody className={cn(loading && "opacity-60")}>
                {data?.keywords.map((k) => (
                  <tr key={k.id} onClick={() => setSelectedId(k.id)} className="cursor-pointer hover:bg-slate-50">
                    <Td className="min-w-64">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{k.keyword}</span>
                        {k.is_primary_keyword && <Badge tone="indigo">Primary</Badge>}
                      </div>
                      <p className="mt-0.5 max-w-72 truncate text-xs text-slate-500" title={k.cluster_name}>
                        {k.cluster_name}
                      </p>
                    </Td>
                    <Td className="tabular-nums">
                      <Volume row={k} />
                    </Td>
                    <Td>
                      <Difficulty row={k} />
                    </Td>
                    <Td>
                      <Badge tone={INTENT_TONE[k.intent]}>{k.intent}</Badge>
                    </Td>
                    {hasVolume && <Td className="tabular-nums text-slate-600">{formatCpc(k)}</Td>}
                    <Td>
                      <ScoreBar score={k.opportunity_score} />
                    </Td>
                  </tr>
                ))}
                {data && data.keywords.length === 0 && (
                  <tr>
                    <Td colSpan={hasVolume ? 6 : 5} className="py-10 text-center text-slate-500">
                      No keywords match these filters.
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
            <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500">
              <span>{total ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}` : "0 keywords"}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {selectedId && <KeywordDetail projectId={projectId} keywordId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-700">{label}</p>
      {children}
    </div>
  );
}

function Volume({ row }: { row: Pick<KeywordRow, "search_volume" | "demand_score"> }) {
  if (row.search_volume != null) return <>{formatNumber(row.search_volume)}</>;
  if (row.demand_score == null) return <span className="text-slate-400">—</span>;
  const d = Number(row.demand_score);
  const [label, tone]: [string, BadgeTone] = d >= 0.6 ? ["High", "emerald"] : d >= 0.3 ? ["Medium", "amber"] : ["Low", "slate"];
  return (
    <Badge tone={tone} title={`Estimated demand ${d.toFixed(2)} (from Google autocomplete)`}>
      {label}
    </Badge>
  );
}

function Difficulty({ row }: { row: Pick<KeywordRow, "estimated_difficulty" | "difficulty_label" | "difficulty_status"> }) {
  if (row.estimated_difficulty == null) {
    return <span className="text-xs text-slate-400">{row.difficulty_status === "pending" ? "Pending" : "Not checked"}</span>;
  }
  return (
    <Badge tone={difficultyTone(row.estimated_difficulty)}>
      {row.estimated_difficulty} · {row.difficulty_label}
    </Badge>
  );
}

function formatCpc(k: Pick<KeywordRow, "cpc_low" | "cpc_high">): string {
  if (k.cpc_low == null && k.cpc_high == null) return "—";
  const f = (n: number | null) => (n == null ? "?" : Number(n).toFixed(2));
  return `${f(k.cpc_low)}–${f(k.cpc_high)}`;
}

function KeywordDetail({ projectId, keywordId, onClose }: { projectId: string; keywordId: string; onClose: () => void }) {
  const [keyword, setKeyword] = useState<KeywordRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/keywords/${keywordId}`)
      .then(async (res) => {
        const json = await readJson(res);
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        if (!cancelled) setKeyword(json.keyword);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [projectId, keywordId]);

  return (
    <Drawer open onClose={onClose} title={keyword?.keyword ?? "Loading…"}>
      {error && <Notice tone="error">{error}</Notice>}
      {keyword && (
        <div className="space-y-6">
          <DetailGrid
            items={[
              { label: "Opportunity score", value: `${keyword.opportunity_score} / 100` },
              { label: "Estimated SEO difficulty", value: <Difficulty row={keyword} /> },
              { label: "Search volume", value: keyword.search_volume == null ? "Not available" : formatNumber(keyword.search_volume) },
              { label: "Estimated demand", value: <Volume row={{ search_volume: null, demand_score: keyword.demand_score }} /> },
              { label: "Intent", value: <Badge tone={INTENT_TONE[keyword.intent]}>{keyword.intent}</Badge> },
              { label: "Role", value: keyword.is_primary_keyword ? "Primary keyword" : "Secondary keyword" },
              { label: "Cluster", value: keyword.cluster_name },
              { label: "CPC", value: formatCpc(keyword) },
            ]}
          />
          <div>
            <h4 className="text-sm font-semibold">Top 10 Google results</h4>
            {keyword.serp_top10?.length ? (
              <ol className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {keyword.serp_top10.map((r) => (
                  <li key={`${r.position}-${r.link}`} className="flex gap-3 px-3 py-2.5">
                    <span className="w-5 shrink-0 text-right tabular-nums text-slate-400">{r.position}</span>
                    <div className="min-w-0">
                      <a href={r.link} target="_blank" rel="noreferrer" className="block truncate font-medium hover:text-indigo-600">
                        {r.title || r.link}
                      </a>
                      <p className="truncate text-xs text-slate-500">{r.domain}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                {keyword.difficulty_status === "pending"
                  ? "The SERP check is pending (Serper was unavailable during research)."
                  : "Only the top opportunities get a SERP check, to keep API costs low."}
              </p>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
