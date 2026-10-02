import { logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import { r2Missing, uploadToR2 } from "./r2";

/**
 * Where featured images are stored: Cloudflare R2 when it's configured, otherwise a public
 * Supabase Storage bucket (created automatically) — so images work without extra setup.
 */
const SUPABASE_BUCKET = "article-images";

export function storageProvider(): "r2" | "supabase" {
  return r2Missing().length === 0 ? "r2" : "supabase";
}

/** Upload and return the public URL. */
export async function uploadImage(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<string> {
  if (storageProvider() === "r2") return uploadToR2(key, body, contentType);

  const storage = supabaseAdmin().storage;
  await ensureBucket();
  const { error } = await storage.from(SUPABASE_BUCKET).upload(key, body, {
    contentType,
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  return storage.from(SUPABASE_BUCKET).getPublicUrl(key).data.publicUrl;
}

let bucketReady = false;

async function ensureBucket() {
  if (bucketReady) return;
  const storage = supabaseAdmin().storage;
  const { data } = await storage.getBucket(SUPABASE_BUCKET);
  if (!data) {
    const { error } = await storage.createBucket(SUPABASE_BUCKET, {
      public: true,
      fileSizeLimit: "10MB",
      allowedMimeTypes: ["image/webp", "image/png", "image/jpeg"],
    });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Could not create the image bucket: ${error.message}`);
    logger.info("created Supabase Storage bucket for images", { bucket: SUPABASE_BUCKET });
  }
  bucketReady = true;
}
