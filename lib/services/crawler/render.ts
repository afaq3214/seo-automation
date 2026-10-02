import type { Browser } from "playwright-core";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { CRAWLER_USER_AGENT } from "./http";

let browserPromise: Promise<Browser> | null = null;

/**
 * Render a JS-heavy page with headless Chromium and return the final HTML.
 * Disabled unless ENABLE_PLAYWRIGHT=true. Returns null if disabled or rendering fails,
 * so the crawler just keeps the plain-fetch result.
 */
export async function renderWithPlaywright(url: string): Promise<string | null> {
  if (!env().ENABLE_PLAYWRIGHT) return null;

  try {
    if (!browserPromise) {
      const { chromium } = await import("playwright-core");
      browserPromise = chromium.launch({ headless: true });
    }
    const browser = await browserPromise;
    const page = await browser.newPage({ userAgent: CRAWLER_USER_AGENT });
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      return await page.content();
    } finally {
      await page.close();
    }
  } catch (err) {
    logger.warn("playwright render failed", { url, error: errorMessage(err) });
    browserPromise = null;
    return null;
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    await (await pending).close();
  } catch {
    /* already closed */
  }
}
