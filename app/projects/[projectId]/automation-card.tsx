"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readJson } from "@/components/read-json";
import { Badge, Button, Card, CardHeader, formatDate, Notice } from "@/components/ui";
import type { AutomationEvent } from "@/lib/types";

type Action = "enable" | "disable" | "run" | "post_now";

export interface AutomationState {
  enabled: boolean;
  /** Label of the step running now, or null */
  running: string | null;
  lastStep: string | null;
  error: string | null;
  retryAt: string | null;
  nextPostAt: string | null;
  strategyAt: string | null;
  refreshDays: number;
  /** 0 = optimized before publishing */
  optimizeAfterDays: number;
  articleInProgress: boolean;
}

/** Full automation: on/off, what it's doing, when the next post is due, and recent activity. */
export function AutomationCard({ projectId, state, events }: { projectId: string; state: AutomationState; events: AutomationEvent[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  // While enabled, refresh every 20s so progress shows without reloading.
  useEffect(() => {
    if (!state.enabled) return;
    const t = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [state.enabled, router]);

  async function act(action: Action) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/automation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const status = !state.enabled
    ? (["Off", "slate"] as const)
    : state.running
      ? (["Working", "indigo"] as const)
      : state.retryAt && Date.parse(state.retryAt) > Date.now()
        ? (["Waiting to retry", "amber"] as const)
        : (["On", "emerald"] as const);

  return (
    <Card>
      <CardHeader
        title="Automation"
        description={`Keywords, competitors and strategy refresh every ${state.refreshDays} days; one article is written and published daily${state.optimizeAfterDays ? `, then optimized ${state.optimizeAfterDays} days later` : ""}.`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={status[1]}>{status[0]}</Badge>
            {state.enabled ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => act("post_now")} disabled={!!busy || state.articleInProgress}>
                  {busy === "post_now" ? "Starting…" : "Write today's post now"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => act("disable")} disabled={!!busy}>
                  {busy === "disable" ? "Turning off…" : "Turn off"}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => act("enable")} disabled={!!busy}>
                {busy === "enable" ? "Starting…" : "Turn on"}
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-6 p-5 lg:grid-cols-[280px_1fr]">
        <dl className="space-y-3 text-sm">
          <Item label="Now">{state.running ?? (state.enabled ? "Idle, waiting for the next task" : "Not running")}</Item>
          <Item label="Next article due">{state.enabled ? (state.articleInProgress ? "In progress" : state.nextPostAt ? formatDate(state.nextPostAt) : "Now") : "—"}</Item>
          <Item label="Strategy last built">{formatDate(state.strategyAt)}</Item>
          {state.error && (
            <Item label="Last error">
              <span className="text-red-600">{state.error}</span>
              {state.retryAt && <span className="block text-xs text-slate-500">Retries after {formatDate(state.retryAt)}</span>}
              <button className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500" onClick={() => act("run")} disabled={!!busy}>
                {busy === "run" ? "Retrying…" : "Retry now"}
              </button>
            </Item>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </dl>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Recent activity</p>
          {events.length ? (
            <ul className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-32 shrink-0 text-xs text-slate-400">{formatDate(e.created_at)}</span>
                  <span className={e.level === "error" ? "text-red-600" : "text-slate-700"}>{e.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No activity yet.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}
