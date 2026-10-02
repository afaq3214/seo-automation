import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge, Card, CardHeader, formatDate, formatNumber } from "@/components/ui";
import { getArticle } from "@/lib/services/articles/repository";
import { getProject } from "@/lib/services/projects";
import { ArticleTabs, type ArticleVersion } from "./article-tabs";
import { FeaturedImageCard } from "./featured-image-card";
import { OptimizationPanel } from "./optimization-panel";
import { PublishingCard } from "./publishing-card";
import { QualityPanel } from "./quality-panel";

export const dynamic = "force-dynamic";

export default async function ArticlePage(props: PageProps<"/projects/[projectId]/articles/[articleId]">) {
  const { projectId, articleId } = await props.params;
  if (!z.uuid().safeParse(articleId).success) notFound();
  const [article, project] = await Promise.all([getArticle(projectId, articleId), getProject(projectId)]);
  if (!article || !project) notFound();
  const b = article.brief;
  const versions: ArticleVersion[] = [
    { key: "original", label: "Original", html: article.content_html, json: article.content_json, words: article.word_count },
  ];
  if (article.optimized_json && article.optimized_html) {
    versions.push({
      key: "optimized",
      label: "Optimized",
      html: article.optimized_html,
      json: article.optimized_json,
      words: article.optimized_word_count ?? 0,
    });
  }
  const r = article.serp_research;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/projects/${projectId}/articles`} className="text-sm text-slate-500 hover:text-slate-900">
          ← All articles
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">{article.title}</h2>
          <Badge tone={article.status === "ready" ? "emerald" : article.status === "needs_review" ? "red" : "amber"}>
            {article.status.replace("_", " ")}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {formatNumber(article.word_count)} words · created {formatDate(article.created_at)}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <ArticleTabs versions={versions} />

        {/* Right column: SEO fields + brief */}
        <div className="space-y-6">
          <PublishingCard
            projectId={projectId}
            articleId={article.id}
            status={article.status}
            publishAt={article.publish_at}
            canonicalUrl={article.canonical_url}
            apiUrl={`/api/v1/blogs/${article.slug}?site=${project.site_key}`}
          />
          <QualityPanel projectId={projectId} articleId={article.id} report={article.quality_report} checkedAt={article.quality_checked_at} />
          <FeaturedImageCard
            projectId={projectId}
            articleId={article.id}
            status={article.featured_image_status ?? "none"}
            url={article.featured_image_url}
            alt={article.featured_image_alt}
            error={article.featured_image_error}
          />
          <OptimizationPanel
            projectId={projectId}
            articleId={article.id}
            report={article.optimization_report}
            optimizedAt={article.optimized_at}
          />
          <Card>
            <CardHeader title="SEO" />
            <dl className="space-y-3 p-5 text-sm">
              <Field label={`Meta title (${article.meta_title.length} chars)`}>{article.meta_title}</Field>
              <Field label={`Meta description (${article.meta_description.length} chars)`}>{article.meta_description}</Field>
              <Field label="Slug">/{article.slug}</Field>
              <Field label="Primary keyword">{article.primary_keyword}</Field>
              {article.secondary_keywords.length > 0 && (
                <Field label="Secondary keywords">
                  <div className="flex flex-wrap gap-1">
                    {article.secondary_keywords.map((k) => (
                      <Badge key={k}>{k}</Badge>
                    ))}
                  </div>
                </Field>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Content brief" description={`${b.searchIntent} intent · ~${b.recommendedWordCount} words`} />
            <div className="space-y-4 p-5 text-sm">
              <Field label="Target reader">{b.targetReader}</Field>
              <List label="Must-cover topics" items={b.mustCoverTopics} />
              <List label="Differentiating angles" items={b.differentiatingAngles} />
              <List label="Common questions" items={b.commonQuestions} />
              <Field label="CTA idea">{b.ctaIdea}</Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Research used"
              description={`${r.organic.length} Google results · ${r.peopleAlsoAsk.length} questions · ${r.competitorPages.length} pages read`}
            />
            <ul className="space-y-2 p-5 text-xs">
              {r.competitorPages.map((p) => (
                <li key={p.url}>
                  <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-slate-700 hover:text-indigo-600">
                    {p.title ?? p.url}
                  </a>
                  <span className="text-slate-400"> · {formatNumber(p.wordCount)} words · {p.h2s.length} H2s</span>
                </li>
              ))}
              {!r.competitorPages.length && <li className="text-slate-500">No top-ranking pages could be read.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-700">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
