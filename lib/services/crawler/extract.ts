import * as cheerio from "cheerio";
import { isSameSite, normalizePageUrl } from "@/lib/url";

export interface PageImage {
  src: string;
  alt: string;
}

export interface ExtractedPage {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2s: string[];
  h3s: string[];
  canonical: string | null;
  bodyText: string;
  wordCount: number;
  internalLinks: string[];
  images: PageImage[];
  /** Main navigation link labels (header/nav), when easily found */
  navLabels: string[];
}

const MAX_BODY_CHARS = 20_000;
const MAX_LINKS = 300;
const MAX_IMAGES = 100;
const MAX_HEADINGS = 50;

const BLOCK_TAGS =
  "p, div, li, br, h1, h2, h3, h4, h5, h6, section, article, main, td, th, tr, blockquote, dd, dt, figcaption, a, span, button, label";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Extract SEO-relevant fields from raw HTML. `pageUrl` should be the final URL after redirects. */
export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);

  // Not "head > title": malformed <head> markup can push <title> into <body> when parsed.
  const title = clean($("title").first().text()) || null;
  const metaDescription = clean($('meta[name="description" i]').attr("content") ?? "") || null;

  const canonicalHref = $('link[rel="canonical" i]').attr("href");
  const canonical = canonicalHref ? normalizePageUrl(canonicalHref, pageUrl) : null;

  const headings = (sel: string) =>
    $(sel)
      .map((_, el) => clean($(el).text()))
      .get()
      .filter(Boolean)
      .slice(0, MAX_HEADINGS);

  const h1 = headings("h1")[0] ?? null;
  const h2s = headings("h2");
  const h3s = headings("h3");

  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    if (links.size >= MAX_LINKS) return false;
    const href = normalizePageUrl($(el).attr("href") ?? "", pageUrl);
    if (href && isSameSite(href, pageUrl)) links.add(href);
  });

  const images = new Map<string, string>();
  $("img").each((_, el) => {
    if (images.size >= MAX_IMAGES) return false;
    const $img = $(el);
    const rawSrc =
      $img.attr("src") ||
      $img.attr("data-src") ||
      $img.attr("data-lazy-src") ||
      ($img.attr("srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0];
    if (!rawSrc || rawSrc.startsWith("data:")) return;
    const src = normalizePageUrl(rawSrc, pageUrl);
    if (src && !images.has(src)) images.set(src, clean($img.attr("alt") ?? ""));
  });

  // Body text: drop non-content and site chrome, then pad block elements so words don't merge.
  const navLabels = [
    ...new Set(
      $("nav a, header a")
        .map((_, el) => clean($(el).text()))
        .get()
        .filter((t) => t.length > 1 && t.length < 40),
    ),
  ].slice(0, 20);

  $("script, style, noscript, svg, iframe, template, header, nav, footer, form").remove();
  $(BLOCK_TAGS).append(" ");
  const root = $("main").first().length ? $("main").first() : $("body");
  const bodyText = clean(root.text()).slice(0, MAX_BODY_CHARS);
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  return {
    url: pageUrl,
    title,
    metaDescription,
    h1,
    h2s,
    h3s,
    canonical,
    bodyText,
    wordCount,
    internalLinks: [...links],
    images: [...images].map(([src, alt]) => ({ src, alt })),
    navLabels,
  };
}
