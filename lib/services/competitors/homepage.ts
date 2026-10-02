import { logger } from "@/lib/logger";
import type { HomepageStatus } from "@/lib/types";
import { extractPage } from "../crawler/extract";
import { fetchText, isHtml } from "../crawler/http";
import { renderWithPlaywright } from "../crawler/render";

export interface CompetitorHomepage {
  homepageUrl: string;
  status: HomepageStatus;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  bodyText: string;
  navLabels: string[];
}

const THIN_PAGE_WORDS = 50;
const BODY_CHARS = 1500;
/** Interstitials from bot protection (Cloudflare, Sucuri, Akamai …) instead of the real page. */
const BLOCK_PAGE = /just a moment|attention required|access denied|checking your browser|verify you are human|captcha|ddos protection/i;

/**
 * Fetch one competitor homepage: plain fetch + Cheerio, Playwright only for thin/JS pages
 * (when ENABLE_PLAYWRIGHT=true). Never throws — failures return status "failed" or "blocked".
 */
export async function fetchCompetitorHomepage(domain: string): Promise<CompetitorHomepage> {
  const url = `https://${domain}/`;
  const empty = (status: HomepageStatus, homepageUrl = url): CompetitorHomepage => ({
    homepageUrl,
    status,
    title: null,
    metaDescription: null,
    h1: null,
    bodyText: "",
    navLabels: [],
  });

  let res = await fetchText(url, 15_000);
  if (!res || (!res.ok && res.status >= 500)) res = (await fetchText(`https://www.${domain}/`, 15_000)) ?? res;

  const blocked = !!res && (res.status === 403 || res.status === 429 || res.status === 503 || BLOCK_PAGE.test(titleOf(res.text)));
  let html = res?.ok && isHtml(res.contentType) && !blocked ? res.text : null;
  let status: HomepageStatus = "ok";
  const finalUrl = res?.url || url;

  let page = html ? extractPage(html, finalUrl) : null;
  if (!page || page.wordCount < THIN_PAGE_WORDS) {
    const rendered = await renderWithPlaywright(finalUrl);
    if (rendered && !BLOCK_PAGE.test(titleOf(rendered))) {
      const renderedPage = extractPage(rendered, finalUrl);
      if (!page || renderedPage.wordCount > page.wordCount) {
        page = renderedPage;
        html = rendered;
        status = "rendered";
      }
    }
  }

  // Some sites serve their error page with status 200 ("404 Not Found" as the title).
  if (page && /^(404|page not found|not found)|404 not found/i.test(page.title ?? "")) page = null;

  if (!page) {
    const failStatus: HomepageStatus = blocked ? "blocked" : "failed";
    logger.warn("competitor homepage unavailable", { domain, status: res?.status ?? "network error", result: failStatus });
    return empty(failStatus, finalUrl);
  }

  return {
    homepageUrl: page.url,
    status,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
    bodyText: page.bodyText.slice(0, BODY_CHARS),
    navLabels: page.navLabels,
  };
}

function titleOf(html: string): string {
  return /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
}
