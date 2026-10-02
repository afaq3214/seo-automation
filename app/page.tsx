import Link from "next/link";
import { Badge, buttonClass, Card, EmptyState, formatDate, Notice, PageHeader, StatCard, Table, Td, Th, type BadgeTone } from "@/components/ui";
import { errorMessage, logger } from "@/lib/logger";
import { listProjects } from "@/lib/services/projects";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let projects: Project[] = [];
  let loadError: string | null = null;
  try {
    projects = await listProjects(50);
  } catch (err) {
    loadError = errorMessage(err);
    logger.error("dashboard: list projects failed", { error: loadError });
  }

  const count = (f: (p: Project) => boolean) => projects.filter(f).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="All SEO projects and where each one is in the workflow."
        actions={
          <Link href="/projects/new" className={buttonClass("primary")}>
            + New project
          </Link>
        }
      />

      {loadError && <Notice tone="error">Could not load projects: {loadError}</Notice>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Projects" value={projects.length} />
        <StatCard label="Websites analyzed" value={count((p) => p.status === "complete")} />
        <StatCard label="Keyword research done" value={count((p) => p.keywords_status === "complete")} />
        <StatCard label="Strategies ready" value={count((p) => p.strategy_status === "complete")} />
      </div>

      {projects.length === 0 && !loadError ? (
        <EmptyState
          title="No projects yet"
          description="Create a project from a website URL to analyze the business, research keywords and find competitors."
          action={
            <Link href="/projects/new" className={buttonClass("primary")}>
              Create your first project
            </Link>
          }
        />
      ) : (
        <Card>
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Website</Th>
                <Th>Business</Th>
                <Th>Market</Th>
                <Th>Analysis</Th>
                <Th>Keywords</Th>
                <Th>Competitors</Th>
                <Th>Strategy</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/projects/${p.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                      {p.domain}
                    </Link>
                    <p className="text-xs text-slate-500">{p.pages_crawled} pages crawled</p>
                  </Td>
                  <Td className="max-w-60">
                    <p className="truncate text-slate-700">{p.analysis?.businessType ?? "—"}</p>
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">
                    {p.country} · {p.language}
                  </Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                  <Td>
                    <StatusBadge status={p.keywords_status} />
                  </Td>
                  <Td>
                    <StatusBadge status={p.competitors_status} />
                  </Td>
                  <Td>
                    <StatusBadge status={p.strategy_status} />
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(p.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string | undefined }) {
  const map: Record<string, [string, BadgeTone]> = {
    complete: ["Done", "emerald"],
    running: ["Running", "indigo"],
    crawling: ["Crawling", "indigo"],
    analyzing: ["Analyzing", "indigo"],
    pending: ["Pending", "slate"],
    failed: ["Failed", "red"],
    idle: ["Not started", "slate"],
  };
  const [label, tone] = map[status ?? "idle"] ?? [status, "slate"];
  return <Badge tone={tone}>{label}</Badge>;
}
