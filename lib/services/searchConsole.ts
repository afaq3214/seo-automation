import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import { siteBase } from "@/lib/url";
import type { Project } from "@/lib/types";

/**
 * Google Search Console, through a service account that was added as a user on the property.
 * Two things Google allows: (re)submitting a sitemap so new posts are discovered sooner, and reading a
 * URL's index status. There is no API to request indexing of a normal page.
 */
const SCOPE = "https://www.googleapis.com/auth/webmasters";
const KEY_FILE = "google-service-account.json";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

let account: ServiceAccount | null | undefined;
let token: { value: string; expires: number } | null = null;
let sites: { siteUrl: string; permissionLevel: string }[] | null = null;

/** The key from GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64, for Vercel) or the local key file. */
function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  account = null;
  try {
    const raw = env().GOOGLE_SERVICE_ACCOUNT_JSON;
    const file = join(process.cwd(), KEY_FILE);
    const text = raw ? (raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) : existsSync(file) ? readFileSync(file, "utf8") : null;
    if (text) {
      const parsed = JSON.parse(text) as Partial<ServiceAccount>;
      if (parsed.client_email && parsed.private_key) {
        account = { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri ?? "https://oauth2.googleapis.com/token" };
      }
    }
  } catch (err) {
    logger.warn("search console: service account key unreadable", { error: errorMessage(err) });
  }
  return account;
}

export function searchConsoleConfigured(): boolean {
  return serviceAccount() !== null;
}

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const key = serviceAccount();
  if (!key) throw new Error("Search Console is not configured (no Google service account key)");

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + 3600 })}`;
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url")}`;

  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !json?.access_token) throw new Error(`Google sign-in failed: ${json?.error_description ?? res.status}`);
  token = { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** One API call, retried once on a network error. */
async function google<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      const json = text ? (JSON.parse(text) as T & { error?: { message?: string } }) : null;
      if (!res.ok) throw new GoogleError(json?.error?.message ?? `HTTP ${res.status}`);
      return json;
    } catch (err) {
      if (err instanceof GoogleError || attempt >= 2) throw err;
    }
  }
}

class GoogleError extends Error {}

/**
 * The Search Console property that contains this project: a domain property (sc-domain:example.com) or
 * the longest URL-prefix property the project's URL starts with. Null when the account has no access.
 */
export async function propertyFor(project: Pick<Project, "url" | "domain">): Promise<string | null> {
  sites ??= (await google<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>("https://www.googleapis.com/webmasters/v3/sites"))?.siteEntry ?? [];
  const usable = sites.filter((s) => s.permissionLevel !== "siteUnverifiedUser");
  const bare = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const target = bare(project.url);
  const prefix = usable
    .filter((s) => !s.siteUrl.startsWith("sc-domain:") && (target === bare(s.siteUrl) || target.startsWith(`${bare(s.siteUrl)}/`)))
    .sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0];
  const domain = usable.find((s) => s.siteUrl === `sc-domain:${project.domain.replace(/^www\./, "")}`);
  return (prefix ?? domain)?.siteUrl ?? null;
}

/** Ask Google to (re)read the project's sitemap. Returns the sitemap URL submitted. */
export async function submitSitemap(project: Project): Promise<string> {
  const property = await propertyFor(project);
  if (!property) throw new Error(`The service account has no access to a Search Console property for ${project.url}`);
  const sitemap = `${siteBase(project.url)}/sitemap.xml`;
  await google(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(sitemap)}`, { method: "PUT" });
  logger.info("sitemap submitted to Search Console", { property, sitemap });
  return sitemap;
}

export interface IndexStatus {
  /** PASS = indexed */
  verdict: string;
  /** Google's wording, e.g. "Submitted and indexed", "Discovered - currently not indexed" */
  coverage: string;
  lastCrawl: string | null;
}

export async function inspectUrl(property: string, url: string): Promise<IndexStatus> {
  const res = await google<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } } }>(
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    { method: "POST", body: { inspectionUrl: url, siteUrl: property } },
  );
  const r = res?.inspectionResult?.indexStatusResult;
  return { verdict: r?.verdict ?? "VERDICT_UNSPECIFIED", coverage: r?.coverageState ?? "Unknown", lastCrawl: r?.lastCrawlTime ?? null };
}

/** Published articles are checked from this age, and re-checked this often until Google has indexed them. */
const FIRST_CHECK_AFTER_MS = 2 * 86_400_000;
const RECHECK_EVERY_MS = 3 * 86_400_000;
const MAX_PER_RUN = 10;

type DueArticle = { id: string; title: string; canonical_url: string | null };

/** Published articles of a project whose index status should be (re)checked now. Empty if not set up. */
export async function articlesDueForIndexCheck(projectId: string): Promise<DueArticle[]> {
  if (!searchConsoleConfigured()) return [];
  const now = Date.now();
  const { data, error } = await supabaseAdmin()
    .from("articles")
    .select("id,title,canonical_url")
    .eq("project_id", projectId)
    .eq("status", "published")
    .lt("publish_at", new Date(now - FIRST_CHECK_AFTER_MS).toISOString())
    .or(`index_checked_at.is.null,and(index_verdict.neq.PASS,index_checked_at.lt.${new Date(now - RECHECK_EVERY_MS).toISOString()})`)
    .order("publish_at")
    .limit(MAX_PER_RUN);
  if (error) {
    // Migration 013 not run yet: indexing checks are simply off.
    logger.warn("index check unavailable", { error: error.message });
    return [];
  }
  return (data ?? []) as DueArticle[];
}

/** Check and store the index status of the project's due articles. Returns a one-line summary. */
export async function checkIndexStatus(project: Project): Promise<string | null> {
  const due = await articlesDueForIndexCheck(project.id);
  if (!due.length) return null;
  const property = await propertyFor(project);
  const db = supabaseAdmin();
  let indexed = 0;
  for (const a of due) {
    let status: IndexStatus = { verdict: "ERROR", coverage: property ? "Check failed" : "No Search Console access", lastCrawl: null };
    if (property && a.canonical_url) {
      try {
        status = await inspectUrl(property, a.canonical_url);
      } catch (err) {
        logger.warn("index check failed", { url: a.canonical_url, error: errorMessage(err) });
        status.coverage = `Check failed: ${errorMessage(err)}`.slice(0, 200);
      }
    }
    if (status.verdict === "PASS") indexed++;
    await db
      .from("articles")
      .update({ index_verdict: status.verdict, index_status: status.coverage, index_last_crawl: status.lastCrawl, index_checked_at: new Date().toISOString() })
      .eq("id", a.id);
  }
  return `Checked ${due.length} article(s) in Google: ${indexed} indexed, ${due.length - indexed} not yet.`;
}

/** Index status per article id, for the articles list. Empty when the columns don't exist yet. */
export async function indexStatusByArticle(projectId: string): Promise<Map<string, { verdict: string | null; status: string | null; checkedAt: string | null }>> {
  const { data, error } = await supabaseAdmin().from("articles").select("id,index_verdict,index_status,index_checked_at").eq("project_id", projectId);
  if (error) return new Map();
  return new Map((data ?? []).map((r) => [r.id as string, { verdict: r.index_verdict, status: r.index_status, checkedAt: r.index_checked_at }]));
}
