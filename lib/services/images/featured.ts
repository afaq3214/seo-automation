import { z } from "zod";
import { claudeJson } from "@/lib/anthropic";
import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type { ArticleRow, BusinessAnalysis } from "@/lib/types";
import { slugify } from "../articles/html";
import { refreshArticleOutputs } from "../articles/render";
import { getArticle } from "../articles/repository";
import { getProject } from "../projects";
import { generateImageWebp } from "./openaiImage";
import { uploadImage } from "./storage";

/** House style applied to every featured image unless a project overrides it later. */
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

/**
 * Module 08: concept (Claude) → image (OpenAI, WebP) → storage (R2, or Supabase Storage fallback) → save on the article.
 * Never throws for generation problems: the article keeps working and the status becomes "failed"
 * with the error, so the user can retry.
 */
export async function generateFeaturedImage(projectId: string, articleId: string): Promise<ArticleRow> {
  const article = await getArticle(projectId, articleId);
  if (!article) throw new Error("Article not found");
  const project = await getProject(projectId);
  if (!project?.analysis) throw new Error("Project analysis not found");

  await setImageFields(articleId, { featured_image_status: "generating", featured_image_error: null });
  try {
    const content = article.optimized_json ?? article.content_json;
    const concept = await createConcept({
      title: content.title,
      summary: content.metaDescription || content.intro[0] || "",
      primaryKeyword: article.primary_keyword,
      analysis: project.analysis,
    });

    const webp = await generateImageWebp(concept.imagePrompt);
    const filename = `${slugify(concept.filename || article.primary_keyword).slice(0, 60)}-${articleId.slice(0, 8)}.webp`;
    const key = `projects/${projectId}/articles/${filename}`;
    const url = await uploadImage(key, webp, "image/webp");

    await setImageFields(articleId, {
      featured_image_url: url,
      featured_image_alt: concept.altText.trim().slice(0, 150),
      featured_image_status: "ready",
      featured_image_error: null,
      featured_image_prompt: concept.imagePrompt,
      featured_image_key: key,
      featured_image_generated_at: new Date().toISOString(),
    });
    logger.info("featured image ready", { articleId, key, bytes: webp.byteLength });
  } catch (err) {
    const message = errorMessage(err);
    logger.error("featured image failed", { articleId, error: message });
    await setImageFields(articleId, { featured_image_status: "failed", featured_image_error: message });
  }

  // HTML and schema include the image when it exists.
  return refreshArticleOutputs(projectId, articleId);
}

async function createConcept(input: { title: string; summary: string; primaryKeyword: string; analysis: BusinessAnalysis }) {
  return claudeJson({
    label: "image concept",
    schema: conceptSchema,
    maxTokens: 1000,
    system: [
      "You art-direct one featured image for a blog article.",
      "- concept: one sentence describing the scene and why it fits the article",
      "- imagePrompt: a detailed prompt for an image model (subject, setting, people, mood, composition,",
      "  lighting, style). It must follow the visual guidelines. Never ask for text, words, signs, logos,",
      "  brand names, screens with readable content or watermarks in the image.",
      "- altText: accurate, specific description of what the image shows (80-125 characters) — describe the",
      "  scene, include the topic naturally, don't start with 'Image of', no keyword stuffing",
      "- filename: 3-6 descriptive words, lowercase, hyphen-separated, no extension",
    ].join("\n"),
    user: [
      `Article title: ${input.title}`,
      `Summary: ${input.summary}`,
      `Primary keyword: ${input.primaryKeyword}`,
      `Business: ${input.analysis.businessType} — customers: ${input.analysis.targetCustomer}`,
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
