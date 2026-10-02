"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, cn, formatDate, ProgressSteps, type BadgeTone } from "@/components/ui";
import { useStreamJob } from "@/components/use-stream-job";
import type { CheckStatus, Pillar, QualityEvent, QualityReport, QualityStep } from "@/lib/types";

const STEPS: { key: QualityStep; label: string }[] = [
  { key: "scoring", label: "Score" },
  { key: "improving", label: "Improve" },
  { key: "saving", label: "Save" },
  { key: "complete", label: "Done" },
];
const PILLARS: { key: Pillar; label: string }[] = [
  { key: "seo", label: "SEO" },
  { key: "geo", label: "GEO" },
  { key: "aeo", label: "AEO" },
];
const STATUS: Record<CheckStatus, [string, BadgeTone]> = { pass: ["Pass", "emerald"], warn: ["Warn", "amber"], fail: ["Fail", "red"] };

type Complete = Extract<QualityEvent, { type: "complete" }>;

/** Module 09: scores vs targets, status, rounds and per-criterion reasons + the improvement loop button. */
export function QualityPanel({
  projectId,
  articleId,
  report,
  checkedAt,
}: {
  projectId: string;
  articleId: string;
  report: QualityReport | null;
  checkedAt: string | null;
}) {
  const router = useRouter();
  const job = useStreamJob<QualityStep, Complete>();
  const [showAll, setShowAll] = useState(false);

  function run() {
    void job.run(`/api/projects/${projectId}/articles/${articleId}/quality`, {}, () => router.refresh());
  }

  const criteria = report ? (showAll ? report.criteria : report.criteria.filter((c) => c.status !== "pass")) : [];

  return (
    <Card>
      <CardHeader
        title="Quality score"
        description={checkedAt ? `Scored ${formatDate(checkedAt)}` : "Score, then fix failed criteria (max 3 rounds)"}
        actions={
          <Button size="sm" onClick={run} disabled={job.running}>
            {job.running ? "Working…" : report ? "Re-score & improve" : "Score & improve"}
          </Button>
        }
      />
      <div className="space-y-4 p-5">
        {job.visible && <ProgressSteps steps={STEPS} current={job.step} running={job.running} error={job.error} />}

        {report ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {PILLARS.map((p) => {
                const s = report.finalScores[p.key];
                const t = report.targets[p.key];
                return (
                  <div key={p.key} className={cn("rounded-lg px-3 py-2.5 text-center", s >= t ? "bg-emerald-50" : "bg-amber-50")}>
                    <p className="text-xs font-medium text-slate-500">{p.label}</p>
                    <p className={cn("text-2xl font-semibold tabular-nums", s >= t ? "text-emerald-700" : "text-amber-700")}>{s}</p>
                    <p className="text-[11px] text-slate-500">target {t}</p>
                    {report.breakdown && (
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        rules {report.breakdown[p.key].rules ?? "–"} · judge {report.breakdown[p.key].judge ?? "–"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-start gap-2">
              <Badge tone={report.status === "ready" ? "emerald" : "amber"}>{report.status === "ready" ? "Ready" : "Needs review"}</Badge>
              <p className="text-xs leading-relaxed text-slate-600">{report.summary}</p>
            </div>

            {report.rounds.length > 1 && (
              <table className="w-full text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-1 text-left font-medium">Round</th>
                    <th className="text-right font-medium">SEO</th>
                    <th className="text-right font-medium">GEO</th>
                    <th className="text-right font-medium">AEO</th>
                    <th className="text-right font-medium">Edits</th>
                    <th className="text-right font-medium">Words</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-slate-700">
                  {report.rounds.map((r) => (
                    <tr key={r.round} className="border-t border-slate-100">
                      <td className="py-1">
                        {r.round === 0 ? "Start" : r.round}
                        {r.reverted && <span className="ml-1 text-red-600">reverted</span>}
                      </td>
                      <td className="text-right">{r.scores.seo}</td>
                      <td className="text-right">{r.scores.geo}</td>
                      <td className="text-right">{r.scores.aeo}</td>
                      <td className="text-right">{r.round === 0 ? "—" : r.editsApplied}</td>
                      <td className="text-right">{r.words}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {showAll ? "All criteria" : `Open criteria (${criteria.length})`}
                </p>
                <button onClick={() => setShowAll(!showAll)} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                  {showAll ? "Show open only" : `Show all ${report.criteria.length}`}
                </button>
              </div>
              <ul className="space-y-1.5">
                {criteria.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-xs">
                    <span className="w-12 shrink-0">
                      <Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>
                    </span>
                    <span className="min-w-0 flex-1 text-slate-700">
                      <span className="font-medium">{c.label}</span>{" "}
                      <span className="text-slate-400">
                        · {c.pillar.toUpperCase()} · {c.source === "rule" ? "measured" : "judge"}
                      </span>
                      <span className="block text-slate-500">{c.reason}</span>
                    </span>
                  </li>
                ))}
                {!criteria.length && <li className="text-xs text-emerald-700">Every criterion passes.</li>}
              </ul>
            </div>

            <p className="rounded-lg border border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-500">
              {report.criteria.filter((c) => c.source === "rule").length} of {report.criteria.length} criteria are measured by
              rules (repeatable).
              {report.judge && ` The other ${report.criteria.filter((c) => c.source === "ai").length} are graded by an independent judge (${report.judge.model}, median of ${report.judge.votes} runs).`}{" "}
              {report.disclaimer}
            </p>
          </>
        ) : (
          !job.visible && (
            <p className="text-sm text-slate-500">
              Scores SEO, GEO and AEO (0-100): 20 measured rules (topics, questions, terms, structure, readability…) plus
              4 criteria graded by an independent judge model. Then fixes only the failed criteria — at most 3 rounds. Ends as <strong>Ready</strong> (targets met) or <strong>Needs review</strong>.
            </p>
          )
        )}
      </div>
    </Card>
  );
}
