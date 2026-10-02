"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJson } from "@/components/read-json";
import { Badge, Button, Card, CardHeader, cn, formatDate, inputClass, Notice } from "@/components/ui";
import type { ArticleStatus } from "@/lib/types";

/** Publishing: public once status is ready/published and publish_at <= now. */
export function PublishingCard({
  projectId,
  articleId,
  status,
  publishAt,
  canonicalUrl,
  apiUrl,
}: {
  projectId: string;
  articleId: string;
  status: ArticleStatus;
  publishAt: string | null;
  canonicalUrl: string | null;
  apiUrl: string;
}) {
  const router = useRouter();
  const [when, setWhen] = useState(toLocalInput(publishAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicStatus = status === "ready" || status === "published";
  const live = publicStatus && !!publishAt && new Date(publishAt).getTime() <= Date.now();
  const scheduled = publicStatus && !!publishAt && !live;

  async function save(patch: { status?: ArticleStatus; publish_at?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Publishing"
        actions={<Badge tone={live ? "emerald" : scheduled ? "indigo" : "slate"}>{live ? "Live" : scheduled ? "Scheduled" : "Not public"}</Badge>}
      />
      <div className="space-y-3 p-5 text-sm">
        <p className="text-xs text-slate-500">
          {live
            ? `Public since ${formatDate(publishAt)} — served by the blog API.`
            : scheduled
              ? `Goes live ${formatDate(publishAt)}.`
              : status === "needs_review" || status === "draft"
                ? "Drafts and articles that need review are never public. Approve it (mark ready) once you've reviewed it."
                : "Ready — publish now or schedule a date."}
        </p>

        {(status === "needs_review" || status === "draft") && (
          <Button variant="secondary" size="sm" className="w-full" disabled={busy} onClick={() => save({ status: "ready" })}>
            I reviewed it — mark as ready
          </Button>
        )}

        {publicStatus && (
          <>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className={cn(inputClass, "h-8 min-w-0 flex-1 text-xs")}
              />
              <Button size="sm" variant="secondary" disabled={busy || !when} onClick={() => save({ publish_at: new Date(when).toISOString() })}>
                Schedule
              </Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={busy || live} onClick={() => save({ status: "published", publish_at: new Date().toISOString() })}>
                Publish now
              </Button>
              {(live || scheduled) && (
                <Button size="sm" variant="danger" disabled={busy} onClick={() => save({ status: "ready", publish_at: null })}>
                  Unpublish
                </Button>
              )}
            </div>
          </>
        )}

        <dl className="space-y-1.5 border-t border-slate-100 pt-3 text-xs">
          <div>
            <dt className="text-slate-500">Canonical URL</dt>
            <dd className="break-all text-slate-800">{canonicalUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Public API</dt>
            <dd>
              <a href={apiUrl} target="_blank" rel="noreferrer" className="break-all text-indigo-600 hover:text-indigo-500">
                {apiUrl}
              </a>
            </dd>
          </div>
        </dl>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Card>
  );
}

/** ISO → value for <input type="datetime-local"> in the browser's timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
