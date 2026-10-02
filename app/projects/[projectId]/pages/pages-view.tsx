"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  cn,
  EmptyState,
  formatNumber,
  inputClass,
  Notice,
  PageHeader,
  StatCard,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { readJson } from "@/components/read-json";
import type { PageCounts, PageListRow } from "@/lib/services/crawler/fullCrawl";

type StatusFilter = "" | "crawled" | "pending" | "failed";

const PAGE_SIZE = 50;

export function PagesView({ projectId }: { projectId: string }) {
  const [counts, setCounts] = useState<PageCounts | null>(null);
  const [pages, setPages] = useState<PageListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [crawlNote, setCrawlNote] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (status) params.set("status", status);
    if (debouncedQ) params.set("q", debouncedQ);
    try {
      const res = await fetch(`/api/projects/${projectId}/pages?${params}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setCounts(json.counts);
      setPages(json.pages);
      setTotal(json.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, status, debouncedQ, page]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Queue all sitemap URLs, then crawl batch after batch until nothing is pending (or Stop). */
  async function crawlAll() {
    setCrawling(true);
    setError(null);
    stopRef.current = false;
    let first = true;
    try {
      while (!stopRef.current) {
        const res = await fetch(`/api/projects/${projectId}/pages/crawl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queue: first }),
        });
        const json = await readJson(res);
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        if (first && json.queued) {
          setCrawlNote(`Found ${json.queued.sitemapUrls} sitemap URLs · ${json.queued.queued} new pages queued`);
        }
        first = false;
        setCounts(json.counts);
        if (json.counts.pending === 0 || json.batch.crawled + json.batch.failed === 0) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCrawling(false);
      void load();
    }
  }

  const done = counts ? counts.crawled + counts.failed : 0;
  const percent = counts && counts.total ? Math.round((done / counts.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pages"
        description="Every page from the sitemap, crawled in batches (title, headings, content, links, images)."
        actions={
          crawling ? (
            <Button variant="secondary" onClick={() => (stopRef.current = true)}>
              Stop after this batch
            </Button>
          ) : (
            <Button onClick={crawlAll}>{counts?.pending ? "Continue crawling" : "Crawl all pages"}</Button>
          )
        }
      />

      {(crawling || crawlNote) && counts && (
        <Card className="px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-900">
              {crawling ? "Crawling…" : "Crawl progress"} {done} / {counts.total} pages
            </span>
            <span className="tabular-nums text-slate-500">{percent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${percent}%` }} />
          </div>
          {crawlNote && <p className="mt-2 text-xs text-slate-500">{crawlNote}</p>}
        </Card>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pages known" value={formatNumber(counts?.total)} />
        <StatCard label="Crawled" value={formatNumber(counts?.crawled)} />
        <StatCard label="Waiting" value={formatNumber(counts?.pending)} />
        <StatCard label="Failed" value={formatNumber(counts?.failed)} />
      </div>

      {counts?.total === 0 && !loading ? (
        <EmptyState title="No pages yet" description="Click “Crawl all pages” to read the sitemap and crawl every page." />
      ) : (
        <Card>
          <CardHeader
            title="All pages"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <input className={cn(inputClass, "h-8 w-56")} placeholder="Search URL or title…" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                  {(["", "crawled", "pending", "failed"] as StatusFilter[]).map((s) => (
                    <button
                      key={s || "all"}
                      onClick={() => {
                        setStatus(s);
                        setPage(0);
                      }}
                      className={cn("rounded-md px-3 py-1 capitalize", status === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900")}
                    >
                      {s || "All"}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th>Page</Th>
                <Th>H1</Th>
                <Th className="text-right">Words</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className={cn(loading && "opacity-60")}>
              {pages.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td className="max-w-md">
                    <p className="truncate font-medium text-slate-900">{p.title ?? <span className="text-slate-400">(not crawled yet)</span>}</p>
                    <a href={p.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-slate-500 hover:text-indigo-600">
                      {p.url.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  </Td>
                  <Td className="max-w-xs">
                    <span className="block truncate text-slate-600">{p.h1 ?? "—"}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{p.crawl_status === "crawled" ? formatNumber(p.word_count) : "—"}</Td>
                  <Td>
                    {p.crawl_status === "crawled" ? (
                      <Badge tone="emerald">Crawled{p.rendered_with === "playwright" ? " · JS" : ""}</Badge>
                    ) : p.crawl_status === "pending" ? (
                      <Badge>Waiting</Badge>
                    ) : (
                      <Badge tone="red" title={p.crawl_error ?? undefined}>
                        Failed{p.crawl_error ? ` · ${p.crawl_error}` : ""}
                      </Badge>
                    )}
                  </Td>
                </tr>
              ))}
              {!loading && pages.length === 0 && (
                <tr>
                  <Td colSpan={4} className="py-10 text-center text-slate-500">
                    No pages match.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
          <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500">
            <span>{total ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}` : "0 pages"}</span>
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
      )}
    </div>
  );
}
