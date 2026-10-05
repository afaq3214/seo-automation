"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AnalyzeEvent, AnalyzeStep, PageSummary, Project } from "@/lib/types";
import { Badge, Button, buttonClass, Card, CardHeader, inputClass, ProgressSteps, Table, Td, Th } from "./ui";
import { useStreamJob } from "./use-stream-job";

const COUNTRIES = [
  ["AU", "Australia"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["NZ", "New Zealand"],
  ["IE", "Ireland"],
  ["IN", "India"],
  ["SG", "Singapore"],
  ["ZA", "South Africa"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
] as const;

const LANGUAGES = [
  ["en", "English"],
  ["de", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["it", "Italian"],
  ["nl", "Dutch"],
  ["pt", "Portuguese"],
  ["ja", "Japanese"],
] as const;

const STEPS: { key: AnalyzeStep; label: string }[] = [
  { key: "creating", label: "Creating project" },
  { key: "reading", label: "Reading site" },
  { key: "analyzing", label: "Analyzing business" },
  { key: "complete", label: "Complete" },
];

type CompleteEvent = Extract<AnalyzeEvent, { type: "complete" }>;

export function NewProjectForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [country, setCountry] = useState("AU");
  const [language, setLanguage] = useState("en");
  const [automate, setAutomate] = useState(true);
  const [result, setResult] = useState<{ project: Project; pages: PageSummary[] } | null>(null);
  const job = useStreamJob<AnalyzeStep, CompleteEvent>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    await job.run("/api/projects/analyze", { url, country, language, automate }, (event) => {
      setResult({ project: event.project, pages: event.pages });
      router.refresh(); // show the new project in the sidebar
    });
  }

  const label = "mb-1.5 block text-xs font-medium text-slate-700";

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Website" description="We crawl the key pages and summarize the business." />
          <form onSubmit={submit} className="space-y-4 p-5">
            <div>
              <label className={label} htmlFor="url">
                Website URL
              </label>
              <input
                id="url"
                type="text"
                inputMode="url"
                required
                placeholder="example.com.au"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={job.running}
                className={`${inputClass} w-full`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="country">
                  Target country
                </label>
                <select
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  disabled={job.running}
                  className={`${inputClass} w-full`}
                >
                  {COUNTRIES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="language">
                  Language
                </label>
                <select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={job.running}
                  className={`${inputClass} w-full`}
                >
                  {LANGUAGES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={automate}
                onChange={(e) => setAutomate(e.target.checked)}
                disabled={job.running}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Run everything automatically</span>
                <span className="block text-xs text-slate-500">
                  Keywords, competitors and strategy, then one blog written and published every day. Research refreshes every 20 days.
                </span>
              </span>
            </label>
            <Button type="submit" disabled={job.running} className="w-full">
              {job.running ? "Analyzing…" : "Create project & analyze"}
            </Button>
          </form>
        </Card>
        {job.visible && <ProgressSteps steps={STEPS} current={job.step} running={job.running} error={job.error} />}
      </div>

      {result?.project.analysis ? (
        <Result project={result.project} pages={result.pages} />
      ) : (
        <Card className="flex min-h-[320px] items-center justify-center p-8 text-center">
          <div>
            <p className="text-sm font-semibold text-slate-900">Business analysis appears here</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Enter a website and click “Create project &amp; analyze”. It usually takes 15–60 seconds.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function Result({ project, pages }: { project: Project; pages: PageSummary[] }) {
  const a = project.analysis!;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={a.businessType}
          description={project.domain}
          actions={
            <Link href={`/projects/${project.id}`} className={buttonClass("primary", "sm")}>
              Open project →
            </Link>
          }
        />
        <div className="space-y-4 p-5">
          <p className="text-sm leading-6 text-slate-700">{a.businessSummary}</p>
          <div className="flex flex-wrap gap-1.5">
            {a.mainOfferings.map((o) => (
              <Badge key={o} tone="indigo">
                {o}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title={`Pages crawled (${pages.length})`} />
        <div className="max-h-80 overflow-y-auto">
          <Table minWidth={480}>
            <thead>
              <tr>
                <Th>Page</Th>
                <Th className="text-right">Words</Th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.url}>
                  <Td>
                    <p className="truncate font-medium">{p.title ?? "(no title)"}</p>
                    <p className="truncate text-xs text-slate-500">{p.url}</p>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {p.wordCount}
                    {p.renderedWith === "playwright" && <span className="ml-1 text-xs text-slate-400">(JS)</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
