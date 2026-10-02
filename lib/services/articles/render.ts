import { supabaseAdmin } from "@/lib/supabase";
import type { ArticleContent, ArticleRow, FeaturedImage, Project } from "@/lib/types";
import { getProject } from "../projects";
import { IMAGE_SIZE } from "../images/openaiImage";
import { renderArticleHtml } from "./html";
import { getArticle } from "./repository";

/** The article's featured image, if one is ready. */
export function featuredImageOf(article: ArticleRow): FeaturedImage | null {
  if (article.featured_image_status !== "ready" || !article.featured_image_url) return null;
  return { url: article.featured_image_url, alt: article.featured_image_alt ?? "", ...IMAGE_SIZE };
}

/**
 * JSON-LD for the article: BlogPosting (+ FAQPage when there are FAQs). Built from the final content —
 * deterministic, no AI. The page URL isn't known until publishing, so `url` is omitted.
 */
export function buildSchema(content: ArticleContent, project: Project, image: FeaturedImage | null, dates: { created: string; updated: string }) {
  const origin = new URL(project.url).origin;
  const organization = { "@type": "Organization", name: project.domain, url: origin };
  const strip = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "");

  const schema: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: content.title.slice(0, 110),
      description: content.metaDescription,
      ...(image ? { image: [image.url] } : {}),
      author: organization,
      publisher: organization,
      datePublished: dates.created,
      dateModified: dates.updated,
      inLanguage: project.language,
    },
  ];
  if (content.faq.length >= 2) {
    schema.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: content.faq.map((f) => ({
        "@type": "Question",
        name: strip(f.question),
        acceptedAnswer: { "@type": "Answer", text: strip(f.answer) },
      })),
    });
  }
  return schema;
}

/** Where a project's blog posts live: blog_base_url, or <site>/blog by default. */
export function canonicalUrl(project: Project, slug: string): string {
  const base = (project.blog_base_url ?? `${new URL(project.url).origin}/blog`).replace(/\/+$/, "");
  return `${base}/${slug}`;
}

/**
 * Re-render both HTML versions, the schema and the publishing fields (excerpt, FAQ, canonical URL)
 * from the final content. Call after any content or image change.
 */
export async function refreshArticleOutputs(projectId: string, articleId: string): Promise<ArticleRow> {
  const article = await getArticle(projectId, articleId);
  const project = await getProject(projectId);
  if (!article || !project) throw new Error("Article not found");

  const host = new URL(project.url).hostname;
  const image = featuredImageOf(article);
  const finalContent = article.optimized_json ?? article.content_json;
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin()
    .from("articles")
    .update({
      content_html: renderArticleHtml(article.content_json, host, image),
      optimized_html: article.optimized_json ? renderArticleHtml(article.optimized_json, host, image) : null,
      schema_json: buildSchema(finalContent, project, image, { created: article.created_at, updated: now }),
      excerpt: finalContent.metaDescription || null,
      faq_json: finalContent.faq,
      canonical_url: canonicalUrl(project, article.slug),
      updated_at: now,
    })
    .eq("id", articleId)
    .select()
    .single();
  if (error) throw new Error(`Failed to update article output: ${error.message}`);
  return data as ArticleRow;
}
