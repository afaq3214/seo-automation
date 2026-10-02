import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";

/** Cloudflare R2 via its S3-compatible API (signed with SigV4, region "auto"). */

export function r2Missing(): string[] {
  const e = env();
  return Object.entries({
    R2_ACCOUNT_ID: e.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: e.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: e.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: e.R2_BUCKET,
    R2_PUBLIC_BASE_URL: e.R2_PUBLIC_BASE_URL,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
}

let client: AwsClient | null = null;

/** Upload an object and return its public URL. */
export async function uploadToR2(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<string> {
  const missing = r2Missing();
  if (missing.length) throw new Error(`Cloudflare R2 is not configured. Missing: ${missing.join(", ")}`);
  const e = env();
  client ??= new AwsClient({
    accessKeyId: e.R2_ACCESS_KEY_ID!,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });

  const endpoint = `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${e.R2_BUCKET}/${encodeURI(key)}`;
  const res = await client.fetch(endpoint, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`R2 upload failed (HTTP ${res.status})${text ? `: ${text}` : ""}`);
  }
  return `${e.R2_PUBLIC_BASE_URL}/${encodeURI(key)}`;
}
