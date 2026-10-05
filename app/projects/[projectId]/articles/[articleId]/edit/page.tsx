import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getArticle } from "@/lib/services/articles/repository";
import { ArticleEditor } from "./article-editor";

export const dynamic = "force-dynamic";

export default async function EditArticlePage(props: PageProps<"/projects/[projectId]/articles/[articleId]/edit">) {
  const { projectId, articleId } = await props.params;
  if (!z.uuid().safeParse(articleId).success) notFound();
  const article = await getArticle(projectId, articleId);
  if (!article) notFound();
  const content = { ...(article.optimized_json ?? article.content_json), slug: article.slug };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/projects/${projectId}/articles/${articleId}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← Back to article
        </Link>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">Edit article</h2>
        <p className="mt-1 text-sm text-slate-500">
          Editing the {article.optimized_json ? "optimized" : "original"} version, the one readers see.
          {article.status === "published" && " This article is live: changes show on the website within a few minutes of saving."}
        </p>
      </div>
      <ArticleEditor projectId={projectId} articleId={articleId} initial={content} published={article.status === "published"} />
    </div>
  );
}
