"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  cn,
  DetailGrid,
  EmptyState,
  formatDate,
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
import type {
  CompetitorDiscoveryEvent,
  CompetitorRow,
  CompetitorSerpAppearance,
  CompetitorStats,
  CompetitorStep,
  CompetitorType,
} from "@/lib/types";

type SortKey = "score" | "relevance" | "appearances";
type TypeFilter = "" | "direct" | "adjacent";

interface ListResponse {
  project: { competitorsStatus: string; competitorsError: string | null; competitorsDiscoveredAt: string | null; competitorQueries: string[] };
  stats: CompetitorStats;
  competitors: CompetitorRow[];
}

const STEPS: { key: CompetitorStep; label: string }[] = [
  { key: "queries", label: "Search queries" },
  { key: "searching", label: "Searching Google" },
  { key: "domains", label: "Repeated domains" },
  { key: "analyzing", label: "Analyzing" },
  { key: "ranking", label: "Ranking" },
  { key: "complete", label: "Complete" },
];

const TYPE_TONE: Record<CompetitorType, BadgeTone> = {
  direct: "red",
  adjacent: "amber",
  publisher: "sky",
  marketplace: "violet",
  directory: "violet",
  ugc: "slate",
  irrelevant: "slate",
};

type CompleteEvent = Extract<CompetitorDiscoveryEvent, { type: "complete" }>;

export function CompetitorsView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [sort, setSort] = useState<SortKey>("score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const job = useStreamJob<CompetitorStep, CompleteEvent>();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ sort, order });
    if (typeFilter) params.set("type", typeFilter);
    try {
      const res = await fetch(`/api/projects/${projectId}/competitors?${params}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setData(json);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, sort, order, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = data?.stats;
  const hasCompetitors = (stats?.competitorsFound ?? 0) > 0;

  function discover() {
    setNotices([]);
    void job.run(`/api/projects/${projectId}/competitors/discover`, { refresh: hasCompetitors }, async (e) => {
      setNotices(e.reused ? ["Showing recent results — use Refresh to run discovery again."] : e.warnings);
      await load();
    });
  }

  function onSort(k: SortKey) {
    if (k === sort) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setOrder("desc");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Competitors"
        description={`Last discovered ${formatDate(data?.project.competitorsDiscoveredAt)}`}
        actions={
          <Button onClick={discover} disabled={job.running}>
            {job.running ? "Searching…" : hasCompetitors ? "Refresh competitors" : "Find competitors"}
          </Button>
        }
      />

      {job.visible && <ProgressSteps steps={STEPS} current={job.step} running={job.running} error={job.error} />}
      {notices.map((n) => (
        <Notice key={n} tone="warning">
          {n}
        </Notice>
      ))}
      {data?.project.competitorsStatus === "failed" && !job.visible && data.project.competitorsError && (
        <Notice tone="error">Last run failed: {data.project.competitorsError}</Notice>
      )}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Competitors found" value={stats?.competitorsFound ?? "—"} />
        <StatCard label="Direct" value={stats?.directCompetitors ?? "—"} />
        <StatCard label="Adjacent" value={stats?.adjacentCompetitors ?? "—"} />
        <StatCard
          label="Strongest competitor"
          value={<span className="text-base">{stats?.strongest?.domain ?? "—"}</span>}
          hint={stats?.strongest ? `Score ${stats.strongest.competitorScore}` : undefined}
        />
      </div>

      {!hasCompetitors && !loading && !job.running ? (
        <EmptyState
          title="No competitors yet"
          description="We search Google for 5–10 queries based on the business, count the domains that keep appearing and classify each one."
          action={<Button onClick={discover}>Find competitors</Button>}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
          <Card className="min-w-0">
            <CardHeader
              title="Competitor list"
              actions={
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                  {(["", "direct", "adjacent"] as TypeFilter[]).map((t) => (
                    <button
                      key={t || "all"}
                      onClick={() => setTypeFilter(t)}
                      className={cn(
                        "rounded-md px-3 py-1 capitalize",
                        typeFilter === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900",
                      )}
                    >
                      {t || "All"}
                    </button>
                  ))}
                </div>
              }
            />
            <Table minWidth={640}>
              <thead>
                <tr>
                  <Th>Competitor</Th>
                  <Th>Type</Th>
                  <SortTh label="Relevance" sortKey="relevance" sort={sort} order={order} onSort={onSort} />
                  <SortTh label="Appearances" sortKey="appearances" sort={sort} order={order} onSort={onSort} />
                  <SortTh label="Score" sortKey="score" sort={sort} order={order} onSort={onSort} />
                </tr>
              </thead>
              <tbody className={cn(loading && "opacity-60")}>
                {data?.competitors.map((c) => (
                  <tr key={c.id} onClick={() => setSelectedId(c.id)} className="cursor-pointer hover:bg-slate-50">
                    <Td>
                      <div className="flex items-center gap-3">
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=32`}
                          alt=""
                          width={20}
                          height={20}
                          className="h-5 w-5 shrink-0 rounded"
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            {c.domain}
                            {c.is_manual && <span className="ml-2 text-[10px] font-semibold uppercase text-slate-400">Manual</span>}
                          </p>
                          <p className="max-w-72 truncate text-xs text-slate-500">{c.title ?? ""}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <TypeBadge row={c} />
                    </Td>
                    <Td className="tabular-nums">{c.relevance_score ?? "—"}</Td>
                    <Td className="tabular-nums">{c.serp_appearances}</Td>
                    <Td>
                      <ScoreBar score={c.competitor_score} />
                    </Td>
                  </tr>
                ))}
                {data && data.competitors.length === 0 && (
                  <tr>
                    <Td colSpan={5} className="py-10 text-center text-slate-500">
                      No {typeFilter} competitors.
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>

          <div className="space-y-6">
            <ManualAdd projectId={projectId} onAdded={load} />
            <Card>
              <CardHeader title="Discovery searches" description="Google searches used to find competitors" />
              <ul className="space-y-1.5 p-4">
                {(data?.project.competitorQueries ?? []).map((q) => (
                  <li key={q} className="rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                    {q}
                  </li>
                ))}
                {!data?.project.competitorQueries.length && <li className="text-xs text-slate-500">None yet</li>}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {selectedId && (
        <CompetitorDetail
          projectId={projectId}
          competitorId={selectedId}
          onClose={() => setSelectedId(null)}
          onRemoved={() => {
            setSelectedId(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function TypeBadge({ row }: { row: Pick<CompetitorRow, "competitor_type" | "status"> }) {
  if (row.status === "pending_review" || !row.competitor_type) return <Badge>Pending review</Badge>;
  return (
    <Badge tone={TYPE_TONE[row.competitor_type]}>
      <span className="capitalize">{row.competitor_type}</span>
    </Badge>
  );
}

function ManualAdd({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/competitors/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setDomain("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Add a competitor" description="We fetch its homepage and classify it." />
      <form onSubmit={submit} className="space-y-3 p-4">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          disabled={busy}
          className={cn(inputClass, "w-full")}
        />
        <Button type="submit" variant="secondary" disabled={busy || domain.trim().length < 3} className="w-full">
          {busy ? "Adding…" : "Add competitor"}
        </Button>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </form>
    </Card>
  );
}

function CompetitorDetail({
  projectId,
  competitorId,
  onClose,
  onRemoved,
}: {
  projectId: string;
  competitorId: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [data, setData] = useState<{ competitor: CompetitorRow; appearances: CompetitorSerpAppearance[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const url = `/api/projects/${projectId}/competitors/${competitorId}`;

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        const json = await readJson(res);
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        if (!cancelled) setData(json);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function remove() {
    if (!confirm("Remove this competitor? Future discovery won't add it back.")) return;
    setRemoving(true);
    const res = await fetch(url, { method: "DELETE" });
    if (res.ok) onRemoved();
    else {
      setError("Failed to remove competitor");
      setRemoving(false);
    }
  }

  const c = data?.competitor;
  return (
    <Drawer open onClose={onClose} title={c?.domain ?? "Loading…"}>
      {error && <Notice tone="error">{error}</Notice>}
      {c && data && (
        <div className="space-y-6">
          <div>
            {c.homepage_url && (
              <a href={c.homepage_url} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-indigo-600">
                {c.homepage_url} ↗
              </a>
            )}
            <p className="mt-1 font-medium">{c.title ?? "(no title)"}</p>
            {c.meta_description && <p className="mt-1 text-sm text-slate-600">{c.meta_description}</p>}
            {(c.homepage_status === "blocked" || c.homepage_status === "failed") && (
              <p className="mt-2 text-xs text-amber-700">
                Homepage {c.homepage_status === "blocked" ? "blocked our request" : "couldn't be fetched"} — classified from Google results.
              </p>
            )}
          </div>

          <DetailGrid
            items={[
              { label: "Type", value: <TypeBadge row={c} /> },
              { label: "Competitor score", value: `${c.competitor_score} / 100` },
              { label: "Relevance", value: c.relevance_score ?? "—" },
              { label: "SERP appearances", value: `${c.serp_appearances}${c.best_position ? ` · best #${c.best_position}` : ""}` },
              { label: "Product similarity", value: c.product_similarity ?? "—" },
              { label: "Audience similarity", value: c.audience_similarity ?? "—" },
            ]}
          />

          <div>
            <h4 className="text-sm font-semibold">Why it’s a competitor</h4>
            <p className="mt-1 text-sm leading-6 text-slate-700">{c.reason ?? "—"}</p>
          </div>

          <div>
            <h4 className="text-sm font-semibold">Found in these searches</h4>
            {data.appearances.length ? (
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {data.appearances.map((a) => (
                  <li key={`${a.query}-${a.position}-${a.url}`} className="flex gap-3 px-3 py-2.5">
                    <span className="w-8 shrink-0 text-right tabular-nums text-slate-400">#{a.position}</span>
                    <div className="min-w-0">
                      <p className="font-medium">{a.query}</p>
                      <a href={a.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-slate-500 hover:text-indigo-600">
                        {a.title || a.url}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Not found in the discovery searches (added manually).</p>
            )}
          </div>

          <Button variant="danger" size="sm" onClick={remove} disabled={removing}>
            {removing ? "Removing…" : "Remove competitor"}
          </Button>
        </div>
      )}
    </Drawer>
  );
}
