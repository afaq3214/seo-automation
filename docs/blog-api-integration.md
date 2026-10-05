# Integrating SEO Automation blogs into callacy.com

This guide shows how to display articles from the SEO Automation app on every regional version of callacy.com. Each region has its own blog with its own articles, at `https://callacy.com/<region>/blog` and `https://callacy.com/<region>/blog/<slug>`.

| | |
|---|---|
| **API base URL** | `https://seo-automation-sooty.vercel.app` |
| **Site keys** | One per region, see the table below (public, they only unlock published articles) |
| **Auth** | None. The blog API is public and read-only |
| **CORS** | `Access-Control-Allow-Origin: *`, so it can be called from the browser |
| **Caching** | CDN cache 1 minute (`s-maxage=60`), stale for up to 5 minutes while refreshing. Newly published posts appear within about a minute |

### Regions and site keys

| Region | Site key | Blog list | Article URL |
|---|---|---|---|
| Main site (US) | `650d564aff1c91d05a` | `https://callacy.com/blog` | `https://callacy.com/blog/<slug>` |
| Australia | `458d61eb825b92852e` | `https://callacy.com/au/blog` | `https://callacy.com/au/blog/<slug>` |
| Canada | `fa68adc7d3571a183e` | `https://callacy.com/ca/blog` | `https://callacy.com/ca/blog/<slug>` |
| New Zealand | `250602c9e2b866583f` | `https://callacy.com/nz/blog` | `https://callacy.com/nz/blog/<slug>` |
| United Kingdom | `bcdc780cf706ec471e` | `https://callacy.com/uk/blog` | `https://callacy.com/uk/blog/<slug>` |

Try one in the browser: `https://seo-automation-sooty.vercel.app/api/v1/blogs?site=458d61eb825b92852e`

Every region is its own project in the SEO Automation app. Its articles are researched for that country (local keywords, competitors and Google results), and their internal links point to that region's pages (e.g. `/au/pricing`). A new article is published automatically **every day in each region**, so each list grows by one post per day.

---

## 1. What the API returns

Only **live** articles are ever returned: status `ready` or `published` **and** a publish date that has passed. Drafts, articles that need review and posts scheduled for the future return `404`, so the website never has to filter anything.

Articles are published automatically by the app's daily automation, or by hand from the app (article → **Publishing** → **Publish now** or **Schedule**).

### List: `GET /api/v1/blogs?site=SITE_KEY&page=1&limit=20`

| Query param | Required | Default | Notes |
|---|---|---|---|
| `site` | yes | – | The site key |
| `page` | no | `1` | 1-based |
| `limit` | no | `20` | Max `50` |

```json
{
  "site": { "domain": "callacy.com" },
  "articles": [
    {
      "slug": "tradie-answering-service",
      "title": "Tradie Answering Services: How to Stop Missing Jobs When You're On the Tools",
      "excerpt": "Discover how a tradie answering service …",
      "url": "https://callacy.com/au/blog/tradie-answering-service",
      "publishedAt": "2026-10-02T09:00:00.000Z",
      "updatedAt": "2026-10-02T09:05:12.000Z",
      "meta": {
        "title": "Tradie Answering Service: Stop Missing Jobs On the Tools",
        "description": "Discover how a tradie answering service …",
        "canonicalUrl": "https://callacy.com/au/blog/tradie-answering-service"
      },
      "image": { "url": "https://…r2.dev/…/tradie-answering-service-on-site.webp", "alt": "Electrician on a ladder answering …" },
      "primaryKeyword": "tradie answering service"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

`image` is `null` when the article has no featured image yet. Articles are sorted newest first.

### Single article: `GET /api/v1/blogs/{slug}?site=SITE_KEY`

Returns everything in the list item, plus:

| Field | Type | Use |
|---|---|---|
| `article.html` | string | **Ready-to-render, sanitized HTML** of the whole article (see section 3) |
| `article.content` | object | The same article as structured JSON, if you prefer to render it yourself (section 6) |
| `article.faq` | `{ question, answer }[]` | FAQ items (also already inside `html`) |
| `article.schema` | object[] | JSON-LD (`BlogPosting` + `FAQPage`) to put in `<head>` |
| `article.wordCount` | number | For "x min read" (about 220 words per minute) |

```json
{
  "site": { "domain": "callacy.com" },
  "article": {
    "slug": "tradie-answering-service",
    "title": "…", "excerpt": "…", "url": "…", "publishedAt": "…", "updatedAt": "…",
    "meta": { "title": "…", "description": "…", "canonicalUrl": "https://callacy.com/au/blog/tradie-answering-service" },
    "image": { "url": "…", "alt": "…" },
    "primaryKeyword": "tradie answering service",
    "wordCount": 1980,
    "content": { "title": "…", "intro": ["…"], "sections": [ … ], "faq": [ … ], "cta": { … } },
    "html": "<article>\n<h1>…</h1>\n…</article>",
    "faq": [ { "question": "…", "answer": "…" } ],
    "schema": [ { "@context": "https://schema.org", "@type": "BlogPosting", … }, { "@type": "FAQPage", … } ]
  }
}
```

### Errors

| Status | When | Body |
|---|---|---|
| `400` | Missing or invalid `site` | `{ "error": "A valid site key is required (?site=SITE_KEY)" }` |
| `404` | Unknown site, unknown slug, or article not live | `{ "error": "Article not found" }` |
| `500` | Server problem | `{ "error": "Failed to load article" }` |

---

## 2. Routes on callacy.com

| Route | Region | Site key |
|---|---|---|
| `/blog`, `/blog/:slug` | Main site (US) | `650d564aff1c91d05a` |
| `/au/blog`, `/au/blog/:slug` | Australia | `458d61eb825b92852e` |
| `/ca/blog`, `/ca/blog/:slug` | Canada | `fa68adc7d3571a183e` |
| `/nz/blog`, `/nz/blog/:slug` | New Zealand | `250602c9e2b866583f` |
| `/uk/blog`, `/uk/blog/:slug` | United Kingdom | `bcdc780cf706ec471e` |

The list page calls the list endpoint with that region's key, and the article page calls the single-article endpoint with the same key.

The routes **must** match these paths, because each article's canonical URL is `https://callacy.com/<region>/blog/<slug>` (or `/blog/<slug>` for the main site); the API returns it in `article.url`. A slug only exists in its own region: asking the AU key for a UK slug returns `404`. If a region's blog has to live somewhere else, ask for that project's `blog_base_url` to be changed in the SEO Automation app's database so canonical URLs match.

**Regions are separate articles, not translations.** Two regions can have articles on similar topics, written separately for each country. Don't add `hreflang` links between them unless they are genuinely the same article; each page's own canonical is enough.

---

## 3. Rendering the article HTML

`article.html` is generated by the SEO Automation app from structured content. All text is escaped, it only contains a fixed set of tags, and links only point to callacy.com or to the cited data sources. It is safe to render as-is:

```tsx
<div className="blog-content" dangerouslySetInnerHTML={{ __html: article.html }} />
```

**Important:**

- The HTML **already contains the `<h1>` (title), both images and the FAQ section.** Don't render a second H1 or the featured image again above it, or the page will have two H1s.
- Links are internal links to the same region's pages, plus (in some articles) links to the sources of statistics, which open in a new tab.
- Defence in depth (optional): run it through `DOMPurify.sanitize(article.html)` before rendering.

### Tags and classes to style

```
<article>
  <h1>                                   title
  <figure class="featured-image"><img>   featured image (only if one exists)
  <figure class="article-image"><img>    second image in the middle of the article (only if one exists)
  <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <a href>
  <table><thead><tr><th>…<tbody><tr><td>
  <blockquote class="callout"><p>        tip / note
  <section class="faq"><h2><h3><p>       FAQ
  <aside class="cta"><h2><p>
    <a class="cta-button" href="…">      call to action
</article>
```

Starter CSS, to adjust to Callacy's design:

```css
.blog-content { max-width: 760px; margin: 0 auto; line-height: 1.7; font-size: 1.05rem; }
.blog-content h1 { font-size: 2.25rem; line-height: 1.2; margin-bottom: 1.5rem; }
.blog-content h2 { font-size: 1.5rem; margin: 2.5rem 0 0.75rem; }
.blog-content h3 { font-size: 1.15rem; margin: 1.75rem 0 0.5rem; }
.blog-content p, .blog-content ul, .blog-content ol { margin: 0.9rem 0; }
.blog-content ul { list-style: disc; padding-left: 1.5rem; }
.blog-content ol { list-style: decimal; padding-left: 1.5rem; }
.blog-content a { color: #e11d48; text-decoration: underline; }
.blog-content .featured-image img { width: 100%; height: auto; border-radius: 12px; margin-bottom: 1.5rem; }
.blog-content .article-image img { width: 100%; height: auto; border-radius: 12px; margin: 1.5rem 0; }
.blog-content table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.95rem; }
.blog-content th, .blog-content td { border: 1px solid #e5e7eb; padding: 0.6rem 0.8rem; text-align: left; vertical-align: top; }
.blog-content th { background: #f9fafb; }
.blog-content .callout { border-left: 4px solid #e11d48; background: #fff1f2; padding: 0.25rem 1rem; margin: 1.5rem 0; }
.blog-content .faq { margin-top: 3rem; border-top: 1px solid #e5e7eb; }
.blog-content .cta { margin-top: 3rem; padding: 1.5rem; border-radius: 12px; background: #111827; color: #f3f4f6; }
.blog-content .cta h2 { color: #fff; margin-top: 0; }
.blog-content .cta-button { display: inline-block; padding: 0.6rem 1.2rem; border-radius: 8px; background: #e11d48; color: #fff; text-decoration: none; font-weight: 600; }
```

---

## 4. Example code (React + React Router)

### API client

```ts
// src/lib/blogApi.ts
const API_BASE = import.meta.env.VITE_BLOG_API_BASE; // https://seo-automation-sooty.vercel.app

/** Region path prefix ("" = main site) → site key. The keys are public. */
export const BLOG_SITE_KEYS = {
  "": "650d564aff1c91d05a", // callacy.com/blog (US)
  au: "458d61eb825b92852e",
  ca: "fa68adc7d3571a183e",
  nz: "250602c9e2b866583f",
  uk: "bcdc780cf706ec471e",
} as const;
export type BlogRegion = keyof typeof BLOG_SITE_KEYS;

/** "/au/blog/x" → "au", "/blog/x" → "" */
export function regionFromPath(pathname: string): BlogRegion {
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  return (first in BLOG_SITE_KEYS ? first : "") as BlogRegion;
}

/** Where a region's blog lives: "/blog" or "/au/blog". */
export const blogPath = (region: BlogRegion) => (region ? `/${region}/blog` : "/blog");

export interface BlogSummary {
  slug: string;
  title: string;
  excerpt: string | null;
  url: string;
  publishedAt: string;
  updatedAt: string;
  meta: { title: string; description: string; canonicalUrl: string };
  image: { url: string; alt: string } | null;
  primaryKeyword: string;
}

export interface BlogArticle extends BlogSummary {
  wordCount: number;
  content: unknown;
  html: string;
  faq: { question: string; answer: string }[];
  schema: Record<string, unknown>[];
}

export async function listBlogs(region: BlogRegion, page = 1, limit = 12) {
  const res = await fetch(`${API_BASE}/api/v1/blogs?site=${BLOG_SITE_KEYS[region]}&page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`Blog list failed (${res.status})`);
  return (await res.json()) as {
    articles: BlogSummary[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
}

/** Returns null when the article doesn't exist or isn't published (404). */
export async function getBlog(region: BlogRegion, slug: string): Promise<BlogArticle | null> {
  const res = await fetch(`${API_BASE}/api/v1/blogs/${encodeURIComponent(slug)}?site=${BLOG_SITE_KEYS[region]}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blog article failed (${res.status})`);
  return ((await res.json()) as { article: BlogArticle }).article;
}
```

Add to callacy's `.env`:

```
VITE_BLOG_API_BASE=https://seo-automation-sooty.vercel.app
```

### Routes (React Router)

Register the two blog routes once per region, all with the same components:

```tsx
import { BLOG_SITE_KEYS, blogPath, type BlogRegion } from "@/lib/blogApi";

const regions = Object.keys(BLOG_SITE_KEYS) as BlogRegion[];

{regions.map((region) => [
  <Route key={`${region}-list`} path={blogPath(region)} element={<BlogIndex />} />,
  <Route key={`${region}-post`} path={`${blogPath(region)}/:slug`} element={<BlogPost />} />,
])}
```

### Blog list page (`/blog`, `/au/blog`, …)

```tsx
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { blogPath, listBlogs, regionFromPath, type BlogSummary } from "@/lib/blogApi";

export function BlogIndex() {
  const region = regionFromPath(useLocation().pathname);
  const [articles, setArticles] = useState<BlogSummary[]>([]);
  useEffect(() => { listBlogs(region).then((r) => setArticles(r.articles)); }, [region]);

  return (
    <main>
      <h1>Blog</h1>
      <div className="grid gap-6 md:grid-cols-3">
        {articles.map((a) => (
          <Link key={a.slug} to={`${blogPath(region)}/${a.slug}`}>
            {a.image && <img src={a.image.url} alt={a.image.alt} width={1536} height={1024} loading="lazy" />}
            <h2>{a.title}</h2>
            <p>{a.excerpt}</p>
            <time dateTime={a.publishedAt}>{new Date(a.publishedAt).toLocaleDateString("en-AU")}</time>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

### Article page (`/blog/:slug`, `/au/blog/:slug`, …) with SEO tags

Callacy already sets per-page meta tags. Use the same mechanism (e.g. `react-helmet-async`):

```tsx
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { getBlog, regionFromPath, type BlogArticle } from "@/lib/blogApi";

export function BlogPost() {
  const { slug = "" } = useParams();
  const region = regionFromPath(useLocation().pathname);
  const [article, setArticle] = useState<BlogArticle | null | undefined>(undefined);
  useEffect(() => { getBlog(region, slug).then(setArticle).catch(() => setArticle(null)); }, [region, slug]);

  if (article === undefined) return <p>Loading…</p>;
  if (article === null) {
    return (
      <>
        <Helmet><meta name="robots" content="noindex" /></Helmet>
        <p>Article not found.</p>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{article.meta.title}</title>
        <meta name="description" content={article.meta.description} />
        <link rel="canonical" href={article.meta.canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={article.meta.title} />
        <meta property="og:description" content={article.meta.description} />
        <meta property="og:url" content={article.meta.canonicalUrl} />
        {article.image && <meta property="og:image" content={article.image.url} />}
        <meta name="twitter:card" content="summary_large_image" />
        {article.schema.map((s, i) => (
          <script key={i} type="application/ld+json">{JSON.stringify(s)}</script>
        ))}
      </Helmet>
      <div className="blog-content" dangerouslySetInnerHTML={{ __html: article.html }} />
    </>
  );
}
```

---

## 5. ⚠️ SEO: the page must not depend only on browser JavaScript

callacy.com is a client-side React app. With the code above, the article is fetched **in the browser**, so the HTML Google first downloads is still the empty shell. It has the homepage title and a canonical pointing to `https://callacy.com`. Google may render JavaScript later, but many crawlers (Bing, AI search tools, link previews) never do. **Client-side fetching alone will not rank well.**

Pick one of these so the article is in the HTML the server sends. Check the result with **View Source (Ctrl+U)**, not Inspect: you should see the article text, its own `<title>`, and `<link rel="canonical" href="https://callacy.com/au/blog/<slug>">` (with that page's own region and slug).

| Option | How | Trade-off |
|---|---|---|
| **A. Pre-render at build time** (recommended for this stack) | At build, call the list endpoint, then the article endpoint for each slug, and pre-render every region's blog list and every `<region>/blog/:slug` page to static HTML (loop over the site keys). Use React Router v7's `prerender` option or a Vite SSG plugin (e.g. `vite-react-ssg`). | New posts need a rebuild. Posts go out daily, so rebuild daily (e.g. a cron that calls a **Vercel Deploy Hook** on the callacy project). |
| **B. Edge/server injection** | A Vercel Edge Middleware/Function on `/blog/*` that fetches the article from the API and writes `<title>`, meta, canonical, JSON-LD and the article HTML into `index.html` before sending it. | New posts appear instantly. More custom code. |
| **C. Blog as a separate SSR app** | A small Next.js app serving `/blog/*` (rewrite from the main domain) that renders from this API on the server. | Cleanest SEO. A second app to run. |

**Also fix `index.html`:** remove the hard-coded `<link rel="canonical" href="https://callacy.com">`. It tells Google every page, including every blog post, is a copy of the homepage.

---

## 6. Optional: render from structured JSON instead of HTML

Use `article.content` if you want full control over markup and components:

```ts
interface ArticleContent {
  title: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  intro: string[];                                   // paragraphs
  sections: {
    heading: string;
    level: 2 | 3;                                    // render as h2 / h3
    blocks: (
      | { type: "paragraph"; text: string }
      | { type: "list"; ordered: boolean; items: string[] }
      | { type: "table"; headers: string[]; rows: string[][] }
      | { type: "callout"; text: string }
    )[];
  }[];
  faq: { question: string; answer: string }[];
  cta: { heading: string; text: string; buttonLabel: string; buttonUrl: string };
}
```

Text fields can contain two inline formats: `**bold**` and `[link text](https://callacy.com/...)`. Convert them yourself, and escape everything else. The featured image isn't part of `content`; use `article.image`.

---

## 7. Sitemap

Add the blog URLs to callacy's sitemaps. At build time (option A), or from a small server function, call the list endpoint (all pages) **for each region's site key** and add one entry per article to that region's sitemap (`callacy.com/au/sitemap.xml` for AU, and so on):

```xml
<url>
  <loc>https://callacy.com/au/blog/tradie-answering-service</loc>
  <lastmod>2026-10-02</lastmod>
</url>
```

Use `article.url` for `<loc>` and `article.updatedAt` (date part) for `<lastmod>`.

---

## 8. Checklist

- [ ] `VITE_BLOG_API_BASE` set in callacy's environment, and the 5 site keys in `blogApi.ts`
- [ ] Blog list and article routes for every region: `/blog`, `/au/blog`, `/ca/blog`, `/nz/blog`, `/uk/blog` (each with `/:slug`)
- [ ] Blog CSS added, including `.article-image` for the mid-article image
- [ ] Article HTML rendered once, with no second H1 or duplicate image
- [ ] Per-article `<title>`, meta description, canonical, Open Graph and JSON-LD set
- [ ] Unknown or unpublished slugs show "not found" with `noindex`
- [ ] Article content and tags visible in **View Source** (section 5)
- [ ] Hard-coded homepage canonical removed from `index.html`
- [ ] Each region's blog URLs added to that region's sitemap
- [ ] After deploying, inspect one URL in **Google Search Console → URL Inspection** and check that the "Google-selected canonical" is the article URL itself
