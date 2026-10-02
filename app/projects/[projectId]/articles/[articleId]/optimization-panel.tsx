"use client";

import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, cn, formatDate, ProgressSteps, type BadgeTone } from "@/components/ui";
import { useStreamJob } from "@/components/use-stream-job";
import type { CheckResult, CheckStatus, OptimizationReport, OptimizeEvent, OptimizeStep, Pillar } from "@/lib/types";

const STEPS: { key: OptimizeStep; label: string }[] = [
  { key: "measuring", label: "Measure" },
  { key: "auditing", label: "Audit" },
  { key: "revising", label: "Revise" },
  { key: "rechecking", label: "Re-check" },
  { key: "saving", label: "Save" },
  { key: "complete", label: "Done" },
];

const PILLARS: { key: Pillar; label: string }[] = [
  { key: "seo", label: "SEO" },
  { key: "geo", label: "GEO" },
  { key: "aeo", label: "AEO" },
];

const STATUS: Record<CheckStatus, [string, BadgeTone]> = {
  pass: ["Pass", "emerald"],
  warn: ["Warn", "amber"],
  fail: ["Fail", "red"],
};

type Complete = Extract<OptimizeEvent, { type: "complete" }>;

/** Run the SEO/GEO/AEO optimization and show the report (scores before → after, checks, edits). */
export function OptimizationPanel({
  projectId,
  articleId,
  report,
  optimizedAt,
}: {
  projectId: string;
  articleId: string;
  report: OptimizationReport | null;
  optimizedAt: string | null;
}) {
  const router = useRouter();
  const job = useStreamJob<OptimizeStep, Complete>();

  function run() {
    void job.run(`/api/projects/${projectId}/articles/${articleId}/optimize`, {}, () => router.refresh());
  }

  return (
    <Card>
      <CardHeader
        title="SEO · GEO · AEO optimization"
        description={optimizedAt ? `Optimized ${formatDate(optimizedAt)}` : "Checks the draft and revises only the weak parts"}
        actions={
          <Button size="sm" onClick={run} disabled={job.running}>
            {job.running ? "Optimizing…" : report ? "Re-optimize" : "Optimize"}
          </Button>
        }
      />
      <div className="space-y-4 p-5">
        {job.visible && <ProgressSteps steps={STEPS} current={job.step} running={job.running} error={job.error} />}

        {report ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {PILLARS.map((p) => (
                <div key={p.key} className="rounded-lg bg-slate-50 px-3 py-2.5 text-center">
                  <p className="text-xs font-medium text-slate-500">{p.label}</p>
                  <p className="mt-1 text-sm tabular-nums">
                    <span className="text-slate-400">{report.scoresBefore[p.key]}</span>
                    <span className="mx-1 text-slate-300">→</span>
                    <span className="text-lg font-semibold text-slate-900">{report.scoresAfter[p.key]}</span>
                  </p>
                </div>
              ))}
            </div>

            {PILLARS.map((p) => (
              <div key={p.key}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{p.label} checks</p>
                <ul className="space-y-1.5">
                  {report.checksAfter
                    .filter((c) => c.pillar === p.key)
                    .map((c) => (
                      <CheckRow key={c.id} check={c} before={report.checksBefore.find((b) => b.id === c.id)} />
                    ))}
                </ul>
              </div>
            ))}

            {report.note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{report.note}</p>}

            {report.edits.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Planned revisions ({report.appliedEdits ?? report.edits.length} of {report.edits.length} applied)
                </p>
                <ul className="space-y-1.5 text-xs text-slate-600">
                  {report.edits.map((e, i) => (
                    <li key={i} className="rounded-md bg-slate-50 px-2.5 py-1.5">
                      <span className="font-medium text-slate-800">
                        {e.target === "insert_after" ? "New section" : e.target === "section" ? `Section ${(e.index ?? 0) + 1}` : e.target.toUpperCase()}
                      </span>{" "}
                      — {e.instruction}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="rounded-lg border border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-500">{report.disclaimer}</p>
          </>
        ) : (
          !job.visible && (
            <p className="text-sm text-slate-500">
              Runs 18 checks (search intent, keyword use, headings, definitions, answer-first summaries, question
              sections, FAQ…), then rewrites only the parts that fail. The original draft is kept.
            </p>
          )
        )}
      </div>
    </Card>
  );
}

function CheckRow({ check, before }: { check: CheckResult; before?: CheckResult }) {
  const [label, tone] = STATUS[check.status];
  const improved = before && before.status !== check.status;
  return (
    <li className="flex items-start gap-2 text-xs" title={check.note}>
      <span className="w-12 shrink-0">
        <Badge tone={tone}>{label}</Badge>
      </span>
      <span className={cn("min-w-0 flex-1 text-slate-700", improved && "font-medium")}>
        {check.label}
        {improved && <span className="ml-1 text-emerald-600">(was {before.status})</span>}
        <span className="block text-slate-400">{check.note}</span>
      </span>
    </li>
  );
}
