import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";

export const IMAGE_SIZE = { width: 1536, height: 1024 } as const;

/**
 * One landscape featured image from the OpenAI Image API, returned directly as WebP
 * (web-friendly, compressed) so no conversion step is needed.
 */
export async function generateImageWebp(prompt: string): Promise<Uint8Array<ArrayBuffer>> {
  const e = env();
  if (!e.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set — featured images need the OpenAI Image API");

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: e.OPENAI_IMAGE_MODEL,
        prompt,
        n: 1,
        size: `${IMAGE_SIZE.width}x${IMAGE_SIZE.height}`,
        quality: e.OPENAI_IMAGE_QUALITY,
        output_format: "webp",
        output_compression: 82,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    throw new Error(`Could not reach the OpenAI Image API: ${errorMessage(err)}`);
  }

  const json = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string; code?: string } } | null;
  if (!res.ok) {
    const message = json?.error?.message ?? `HTTP ${res.status}`;
    logger.error("openai image error", { status: res.status, code: json?.error?.code, message });
    if (res.status === 401) throw new Error("OpenAI rejected the API key (OPENAI_API_KEY)");
    if (res.status === 429) throw new Error("OpenAI rate limit or quota reached — try again later or check billing");
    if (res.status === 400 && /safety|moderation|policy/i.test(message)) {
      throw new Error("OpenAI declined the image prompt (content policy) — retry to get a new concept");
    }
    throw new Error(`OpenAI image generation failed: ${message}`);
  }

  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return new Uint8Array(Buffer.from(b64, "base64"));
}
