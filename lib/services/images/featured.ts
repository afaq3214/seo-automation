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
  "A real photograph, the kind a magazine photographer would take on assignment: documentary, candid, unposed.",
  "One single scene in one frame, landscape. A real place with real people doing something specific, real objects and",
  "believable everyday detail (worn tools, a half-drunk coffee, paperwork, a van, a shop counter).",
  "Natural or available light with a clear direction (window light, late-afternoon sun, shop lighting). Shallow depth of",
  "field, true-to-life colour, slight film grain. People look like ordinary locals of the target country, not models,",
  "and never look at the camera.",
  "NEVER: abstract or conceptual art; glowing networks, nodes, particles, light trails, sound waves or data streams;",
  "holograms, robots, AI brains or faces made of dots; floating icons; dark blue and orange 'tech' gradients; 3D renders",
  "or illustrations; split screens, collages or before/after panels; call-centre staff in headsets smiling at a laptop;",
  "handshakes, thumbs up, people pointing at screens.",
  "No text, letters, numbers, logos, watermarks, or screens with readable content anywhere in the image.",
].join(" ");

/** ISO country code → name used to place the scene. */
const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", NZ: "New Zealand", US: "the United States", GB: "the United Kingdom", CA: "Canada", IE: "Ireland",
  IN: "India", SG: "Singapore", ZA: "South Africa", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "the Netherlands",
};

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
      project.country,
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

async function createConcept(subject: ImageSubject, primaryKeyword: string, analysis: BusinessAnalysis, country: string) {
  return claudeJson({
    label: subject.section ? "inline image concept" : "image concept",
    schema: conceptSchema,
    maxTokens: 1200,
    system: [
      "You are a photo editor at a business magazine commissioning ONE photograph for a blog article.",
      subject.section
        ? "This photograph sits in the middle of the article, next to the section given. It must show the real-life moment THAT section is about."
        : "This is the article's lead photograph. It must show the real-life moment the article is about, so a reader can guess the topic from the picture alone.",
      "",
      "How to find the picture:",
      "1. Translate the topic into a moment in someone's working day. Software, AI and services are invisible, so never",
      "   try to show the technology. Show the human situation it changes: the problem happening, or life once it is solved.",
      "   Example: an article about missed calls is a florist with both hands full of stems while a phone lights up on",
      "   the bench, not a glowing phone icon. An article about pricing is an owner at a kitchen table at night with",
      "   invoices and a calculator, not a chart.",
      "2. Choose ONE specific person in ONE specific place, in the target country. Pick the trade or business that the",
      "   article itself talks about most; if it names none, pick a different kind of small business each time (cafe,",
      "   clinic, workshop, salon, building site, farm office, real estate agency, vet, law office), not always a tradesperson.",
      "3. Give the scene a small story: what the person is in the middle of doing, what they are holding, what is",
      "   around them, what time of day it is. The detail that tells the story must be visible and obvious.",
      "",
      "Output:",
      "- concept: one sentence saying what moment is shown and why it fits the topic",
      "- imagePrompt: 90-140 words written as a photographer's brief, in this order: who (age, clothing, what they are",
      "  doing with their hands), where (specific place, country, concrete objects in frame), the story detail, time of",
      "  day and light direction, camera (e.g. 35mm lens at eye level, medium shot, shallow depth of field, subject",
      "  off-centre), and mood. End with: 'Candid documentary photograph, natural colour, subtle film grain. No text,",
      "  logos or readable screens.' It must obey every rule in the visual guidelines, including the NEVER list.",
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
      `Target country (set the scene there): ${COUNTRY_NAMES[country.toUpperCase()] ?? country}`,
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
