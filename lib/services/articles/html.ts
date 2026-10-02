import type { ArticleBlock, ArticleContent, FeaturedImage } from "@/lib/types";

/**
 * Render ArticleContent to HTML. Sanitized by construction: every piece of text is HTML-escaped,
 * the only markup produced is a fixed set of tags, and links are allowed only to the site's own
 * domain (anything else becomes plain text). No scripts, styles or attributes from the model.
 */
export function renderArticleHtml(content: ArticleContent, siteHost: string, image?: FeaturedImage | null): string {
  const inline = (text: string) => renderInline(text, siteHost);
  const out: string[] = ["<article>", `<h1>${escapeHtml(content.title)}</h1>`];

  // Featured image (our own R2 URL — https only).
  if (image && image.url.startsWith("https://")) {
    out.push(
      `<figure class="featured-image"><img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.alt)}" width="${image.width}" height="${image.height}" loading="eager" decoding="async"></figure>`,
    );
  }

  for (const p of content.intro) out.push(`<p>${inline(p)}</p>`);

  for (const section of content.sections) {
    const tag = section.level === 3 ? "h3" : "h2";
    out.push(`<${tag}>${escapeHtml(section.heading)}</${tag}>`);
    for (const block of section.blocks) out.push(renderBlock(block, inline));
  }

  if (content.faq.length) {
    out.push('<section class="faq">', "<h2>Frequently asked questions</h2>");
    for (const f of content.faq) out.push(`<h3>${escapeHtml(f.question)}</h3>`, `<p>${inline(f.answer)}</p>`);
    out.push("</section>");
  }

  const ctaUrl = safeUrl(content.cta.buttonUrl, siteHost);
  out.push(
    '<aside class="cta">',
    `<h2>${escapeHtml(content.cta.heading)}</h2>`,
    `<p>${inline(content.cta.text)}</p>`,
    ctaUrl ? `<p><a class="cta-button" href="${escapeAttr(ctaUrl)}">${escapeHtml(content.cta.buttonLabel)}</a></p>` : "",
    "</aside>",
    "</article>",
  );
  return out.filter(Boolean).join("\n");
}

function renderBlock(block: ArticleBlock, inline: (t: string) => string): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${inline(block.text)}</p>`;
    case "callout":
      return `<blockquote class="callout"><p>${inline(block.text)}</p></blockquote>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${block.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${tag}>`;
    }
    case "table":
      return [
        "<table>",
        `<thead><tr>${block.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`,
        `<tbody>${block.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`,
        "</table>",
      ].join("");
  }
}

/** **bold** and [text](url) → HTML; everything else escaped. */
function renderInline(text: string, siteHost: string): string {
  const parts: string[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    parts.push(escapeHtml(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      const url = safeUrl(m[2], siteHost);
      parts.push(url ? `<a href="${escapeAttr(url)}">${escapeHtml(m[1])}</a>` : escapeHtml(m[1]));
    } else {
      parts.push(`<strong>${escapeHtml(m[3])}</strong>`);
    }
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join("");
}

/** Only http(s) links to the site's own domain (www or not). */
function safeUrl(raw: string, siteHost: string): string | null {
  try {
    const url = new URL(raw, `https://${siteHost}`);
    const bare = (h: string) => h.replace(/^www\./, "");
    if ((url.protocol === "https:" || url.protocol === "http:") && bare(url.hostname) === bare(siteHost)) return url.toString();
  } catch {
    /* invalid URL */
  }
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** Words across all visible text of the article. */
export function countWords(content: ArticleContent): number {
  const texts = [
    content.title,
    ...content.intro,
    ...content.sections.flatMap((s) => [
      s.heading,
      ...s.blocks.flatMap((b) =>
        b.type === "list" ? b.items : b.type === "table" ? [...b.headers, ...b.rows.flat()] : [b.text],
      ),
    ]),
    ...content.faq.flatMap((f) => [f.question, f.answer]),
    content.cta.heading,
    content.cta.text,
  ];
  return texts.join(" ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").split(/\s+/).filter(Boolean).length;
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "article"
  );
}
