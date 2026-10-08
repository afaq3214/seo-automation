import { supabaseAdmin } from "@/lib/supabase";
import { siteBase } from "@/lib/url";
import type { ArticleContent, ArticleRow, FeaturedImage, Project } from "@/lib/types";
import { getProject } from "../projects";
import { IMAGE_SIZE } from "../images/openaiImage";
import { renderArticleHtml, type InlineImage } from "./html";
import { limitExternalLinks } from "./style";
import { getArticle } from "./repository";

/** URLs of the researched data sources the article may cite (rendered as external links). */
export function sourceUrlsOf(article: ArticleRow): string[] {
  return (article.serp_research?.dataSources ?? []).map((s) => s.url);
}

/** Articles link only to the site itself: any link to another website is turned into plain text. */
const MAX_EXTERNAL_LINKS = 0;

/** The article's featured image, if one is ready. */
export function featuredImageOf(article: ArticleRow): FeaturedImage | null {
  if (article.featured_image_status !== "ready" || !article.featured_image_url) return null;
  return { url: article.featured_image_url, alt: article.featured_image_alt ?? "", ...IMAGE_SIZE };
}

/** The mid-article image, if one is ready, with the heading of the section it belongs to. */
export function inlineImageOf(article: ArticleRow): InlineImage | null {
  if (article.inline_image_status !== "ready" || !article.inline_image_url) return null;
  return { url: article.inline_image_url, alt: article.inline_image_alt ?? "", heading: article.inline_image_heading, ...IMAGE_SIZE };
}

/** The H2 section in the middle of the article (where the inline image goes by default). */
export function middleSection(content: ArticleContent): ArticleContent["sections"][number] | null {
  const h2s = content.sections.filter((s) => s.level === 2);
  return h2s[Math.floor(h2s.length / 2)] ?? null;
}

/**
 * JSON-LD for the article: BlogPosting (+ FAQPage when there are FAQs). Built from the final content —
 * deterministic, no AI. The page URL isn't known until publishing, so `url` is omitted.
 */
export function buildSchema(content: ArticleContent, project: Project, images: (FeaturedImage | null)[], dates: { created: string; updated: string }) {
  const origin = new URL(project.url).origin;
  const organization = { "@type": "Organization", name: project.domain, url: origin };
  const urls = images.filter((i): i is FeaturedImage => !!i).map((i) => i.url);
  const strip = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "");

  const schema: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: content.title.slice(0, 110),
      description: content.metaDescription,
      ...(urls.length ? { image: urls } : {}),
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

/** Where a project's blog posts live: blog_base_url, or <site>/blog by default (<site>/au/blog for a region site). */
export function canonicalUrl(project: Project, slug: string): string {
  const base = (project.blog_base_url ?? `${siteBase(project.url)}/blog`).replace(/\/+$/, "");
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
  const sources = sourceUrlsOf(article);
  const inline = inlineImageOf(article);
  // House rule: no links to other websites (MAX_EXTERNAL_LINKS).
  const contentJson = limitExternalLinks(article.content_json, host, MAX_EXTERNAL_LINKS);
  const optimizedJson = article.optimized_json ? limitExternalLinks(article.optimized_json, host, MAX_EXTERNAL_LINKS) : null;
  const finalContent = optimizedJson ?? contentJson;
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin()
    .from("articles")
    .update({
      content_json: contentJson,
      optimized_json: optimizedJson,
      content_html: renderArticleHtml(contentJson, host, image, sources, inline),
      optimized_html: optimizedJson ? renderArticleHtml(optimizedJson, host, image, sources, inline) : null,
      schema_json: buildSchema(finalContent, project, [image, inline], { created: article.created_at, updated: now }),
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
