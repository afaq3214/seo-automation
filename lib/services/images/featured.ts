import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type { ArticleContent, ArticleRow, BusinessAnalysis, ImageSlot } from "@/lib/types";
import { slugify } from "../articles/html";
import { middleSection, refreshArticleOutputs } from "../articles/render";
import { getArticle } from "../articles/repository";
import { getProject } from "../projects";
import { generateImageWebp } from "./openaiImage";
import { uploadImage } from "./storage";

/** House style applied to every article image unless a project overrides it later. */
export const VISUAL_GUIDELINES = [
  "Professional, modern editorial photograph or clean photorealistic illustration.",
  "Natural lighting, uncluttered composition, landscape framing with space around the subject.",
  "Realistic people and settings relevant to the reader; no stock-photo clichés.",
  "No text, letters, numbers, logos, watermarks or UI screenshots in the image.",
].join(" ");

const conceptSchema = z.object({
  concept: z.string(),
  imagePrompt: z.string(),
  altText: z.string(),
  filename: z.string(),
});

/** What a concept is about: the whole article (featured) or one section in the middle (inline). */
interface ImageSubject {
  title: string;
  summary: string;
  headings: string[];
  section?: { heading: string; text: string };
  avoid?: string | null;
}

/**
 * Modules 08: concept (Claude) → image (OpenAI, WebP) → storage (R2, or Supabase Storage fallback) → save on the article.
 * Two slots: "featured" (top of the article) and "inline" (in the middle, illustrating the middle section).
 * Never throws for generation problems: the article keeps working and the slot's status becomes "failed"
 * with the error, so the user can retry.
 */
export async function generateArticleImage(projectId: string, articleId: string, slot: ImageSlot = "featured"): Promise<ArticleRow> {
  const article = await getArticle(projectId, articleId);
  if (!article) throw new Error("Article not found");
  const project = await getProject(projectId);
  if (!project?.analysis) throw new Error("Project analysis not found");
  const col = (name: string) => `${slot}_image_${name}`;

  await setImageFields(articleId, { [col("status")]: "generating", [col("error")]: null });
  try {
    const content = article.optimized_json ?? article.content_json;
    const section = slot === "inline" ? middleSection(content) : null;
    if (slot === "inline" && !section) throw new Error("The article has no H2 sections to place a mid-article image in");

    const concept = await createConcept(
      {
        ...articleSubject(content),
        ...(section && { section: { heading: section.heading, text: sectionText(section) } }),
        // Keep the two images visibly different.
        avoid: slot === "inline" ? article.featured_image_prompt : article.inline_image_prompt,
      },
      article.primary_keyword,
      project.analysis,
    );

    const webp = await generateImageWebp(concept.imagePrompt);
    const filename = `${slugify(concept.filename || article.primary_keyword).slice(0, 60)}-${articleId.slice(0, 8)}${slot === "inline" ? "-2" : ""}.webp`;
    const key = `projects/${projectId}/articles/${filename}`;
    const url = await uploadImage(key, webp, "image/webp");

    await setImageFields(articleId, {
      [col("url")]: url,
      [col("alt")]: concept.altText.trim().slice(0, 150),
      [col("status")]: "ready",
      [col("error")]: null,
      [col("prompt")]: concept.imagePrompt,
      [col("key")]: key,
      [col("generated_at")]: new Date().toISOString(),
      ...(section && { inline_image_heading: section.heading }),
    });
    logger.info("article image ready", { articleId, slot, key, bytes: webp.byteLength });
  } catch (err) {
    const message = errorMessage(err);
    logger.error("article image failed", { articleId, slot, error: message });
    await setImageFields(articleId, { [col("status")]: "failed", [col("error")]: message });
  }

  // HTML and schema include the images when they exist.
  return refreshArticleOutputs(projectId, articleId);
}

/** Kept for existing callers: the featured image. */
export function generateFeaturedImage(projectId: string, articleId: string): Promise<ArticleRow> {
  return generateArticleImage(projectId, articleId, "featured");
}

function articleSubject(content: ArticleContent): ImageSubject {
  return {
    title: content.title,
    summary: [content.metaDescription, ...content.intro.slice(0, 2)].filter(Boolean).join(" "),
    headings: content.sections.filter((s) => s.level === 2).map((s) => s.heading),
  };
}

function sectionText(section: ArticleContent["sections"][number]): string {
  return section.blocks
    .flatMap((b) => (b.type === "list" ? b.items : b.type === "table" ? b.rows.flat() : [b.text]))
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .slice(0, 1200);
}

async function createConcept(subject: ImageSubject, primaryKeyword: string, analysis: BusinessAnalysis) {
  return claudeJson({
    label: subject.section ? "inline image concept" : "image concept",
    schema: conceptSchema,
    maxTokens: 1000,
    system: [
      subject.section
        ? "You art-direct one image placed in the middle of a blog article, next to the section given. It must show what THAT section is about (its situation, idea or outcome), so it adds something to the reader at that point in the article."
        : "You art-direct one featured image for a blog article. The image must show what THIS article is about: its main subject, the situation it discusses or the outcome it helps the reader reach. A reader should be able to guess the article's topic from the image.",
      "The business and its customers are background context only: do not default to picturing a customer",
      "doing their everyday job unless that is genuinely the subject. Vary the scene from article to article",
      "rather than reusing one stock idea.",
      "- concept: one sentence describing the scene and how it reflects the topic",
      "- imagePrompt: a detailed prompt for an image model (subject, setting, people, mood, composition,",
      "  lighting, style). It must follow the visual guidelines. Never ask for text, words, signs, logos,",
      "  brand names, screens with readable content or watermarks in the image.",
      "- altText: accurate, specific description of what the image shows (80-125 characters): describe the",
      "  scene, include the topic naturally, don't start with 'Image of', no keyword stuffing",
      "- filename: 3-6 descriptive words, lowercase, hyphen-separated, no extension",
    ].join("\n"),
    user: [
      `Article title: ${subject.title}`,
      `Summary: ${subject.summary}`,
      `Main sections: ${subject.headings.slice(0, 9).join(" | ")}`,
      ...(subject.section ? [`THE SECTION THIS IMAGE ILLUSTRATES: ${subject.section.heading}`, `Section text: ${subject.section.text}`] : []),
      ...(subject.avoid
        ? [`The article's other image already shows this, so use a clearly different scene, subject and composition: ${subject.avoid}`]
        : []),
      `Primary keyword: ${primaryKeyword}`,
      `Background context (not the subject): ${analysis.businessType} — customers: ${analysis.targetCustomer}`,
      `Visual guidelines: ${VISUAL_GUIDELINES}`,
    ].join("\n"),
  });
}

async function setImageFields(articleId: string, fields: Record<string, unknown>) {
  const { error } = await supabaseAdmin()
    .from("articles")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", articleId);
  if (error) throw new Error(`Failed to update the article image: ${error.message}`);
}
