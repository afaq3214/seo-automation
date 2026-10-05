import Link from "next/link";
import { Badge, buttonClass, Card, EmptyState, formatDate, formatNumber, Notice, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { errorMessage } from "@/lib/logger";
import { listArticles, type ArticleSummary } from "@/lib/services/articles/repository";
import { getProject } from "@/lib/services/projects";
import { indexStatusByArticle } from "@/lib/services/searchConsole";

export const dynamic = "force-dynamic";

export default async function ArticlesPage(props: PageProps<"/projects/[projectId]/articles">) {
  const { projectId } = await props.params;
  let articles: ArticleSummary[] = [];
  let loadError: string | null = null;
  try {
    articles = await listArticles(projectId);
  } catch (err) {
    loadError = errorMessage(err);
  }
  const words = articles.reduce((s, a) => s + a.word_count, 0);
  const project = await getProject(projectId);
  const index = await indexStatusByArticle(projectId).catch(() => new Map());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Articles"
        description="Drafts generated from the SEO strategy — research, brief and article for each opportunity."
        actions={
          <Link href={`/projects/${projectId}/strategy`} className={buttonClass("secondary")}>
            Pick an opportunity →
          </Link>
        }
      />
      {loadError && <Notice tone="error">{loadError}</Notice>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Ready" value={articles.filter((a) => a.status === "ready").length} hint={`${articles.filter((a) => a.status === "needs_review").length} need review`} />
        <StatCard label="Total words" value={formatNumber(words)} />
        <StatCard label="Average length" value={articles.length ? `${formatNumber(Math.round(words / articles.length))} words` : "—"} />
      </div>

      {project?.site_key && (
        <Card className="px-5 py-4">
          <p className="text-sm font-semibold text-slate-900">Public blog API</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Live articles only (status ready/published and publish date reached). Site key: <code className="font-mono text-slate-700">{project.site_key}</code>
          </p>
          <div className="mt-2 space-y-1 font-mono text-xs">
            <a href={`/api/v1/blogs?site=${project.site_key}`} target="_blank" rel="noreferrer" className="block text-indigo-600 hover:text-indigo-500">
              GET /api/v1/blogs?site={project.site_key}
            </a>
            <p className="text-slate-600">GET /api/v1/blogs/[slug]?site={project.site_key}</p>
          </div>
        </Card>
      )}

      {articles.length === 0 && !loadError ? (
        <EmptyState
          title="No articles yet"
          description="Open the Strategy tab, click an opportunity and press “Generate blog for this opportunity”."
          action={
            <Link href={`/projects/${projectId}/strategy`} className={buttonClass("primary")}>
              Go to strategy
            </Link>
          }
        />
      ) : (
        <Card>
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Article</Th>
                <Th>Primary keyword</Th>
                <Th className="text-right">Words</Th>
                <Th>Scores (SEO · GEO · AEO)</Th>
                <Th>Status</Th>
                <Th>Google</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <Td className="max-w-md">
                    <Link href={`/projects/${projectId}/articles/${a.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-600">
                      {a.title}
                    </Link>
                    <p className="truncate text-xs text-slate-500">/{a.slug}</p>
                  </Td>
                  <Td className="text-slate-600">{a.primary_keyword}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(a.word_count)}</Td>
                  <Td className="whitespace-nowrap tabular-nums text-slate-600">
                    {a.seo_score != null ? `${a.seo_score} · ${a.geo_score} · ${a.aeo_score}` : "—"}
                  </Td>
                  <Td>
                    <Badge tone={a.status === "ready" ? "emerald" : a.status === "needs_review" ? "red" : "amber"}>
                      {a.status.replace("_", " ")}
                    </Badge>
                  </Td>
                  <Td>
                    {index.get(a.id)?.checkedAt ? (
                      <Badge tone={index.get(a.id)?.verdict === "PASS" ? "emerald" : "slate"} title={`${index.get(a.id)?.status} · checked ${formatDate(index.get(a.id)?.checkedAt)}`}>
                        {index.get(a.id)?.verdict === "PASS" ? "Indexed" : "Not indexed"}
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(a.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
