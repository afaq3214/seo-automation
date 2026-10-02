import { errorMessage, logger } from "@/lib/logger";

export const CRAWLER_USER_AGENT =
  "Mozilla/5.0 (compatible; SEOAutomationBot/1.0; +https://github.com/seo-automation)";

export interface FetchTextResult {
  ok: boolean;
  status: number;
  /** Final URL after redirects */
  url: string;
  contentType: string;
  text: string;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** GET a URL as text. Returns null on network errors/timeouts instead of throwing. */
export async function fetchText(url: string, timeoutMs = 15_000): Promise<FetchTextResult | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
      cache: "no-store",
    });
    const contentType = res.headers.get("content-type") ?? "";
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) {
      logger.warn("fetch skipped: response too large", { url, bytes: declared });
      return { ok: false, status: res.status, url: res.url || url, contentType, text: "" };
    }
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      contentType,
      text: text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text,
    };
  } catch (err) {
    logger.warn("fetch failed", { url, error: errorMessage(err) });
    return null;
  }
}

export function isHtml(contentType: string): boolean {
  return contentType === "" || /text\/html|application\/xhtml\+xml/i.test(contentType);
}
