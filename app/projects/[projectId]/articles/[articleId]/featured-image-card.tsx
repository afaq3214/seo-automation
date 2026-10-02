"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJson } from "@/components/read-json";
import { Badge, Button, Card, CardHeader, Notice, type BadgeTone } from "@/components/ui";
import type { ImageStatus } from "@/lib/types";

const STATUS: Record<ImageStatus, [string, BadgeTone]> = {
  none: ["No image", "slate"],
  generating: ["Generating", "indigo"],
  ready: ["Ready", "emerald"],
  failed: ["Failed", "red"],
};

/** Module 08: one featured image per article — generate, retry, preview, alt text. */
export function FeaturedImageCard({
  projectId,
  articleId,
  status,
  url,
  alt,
  error,
}: {
  projectId: string;
  articleId: string;
  status: ImageStatus;
  url: string | null;
  alt: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setRequestError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/articles/${articleId}/image`, { method: "POST" });
      const json = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const shown: ImageStatus = busy ? "generating" : status;
  return (
    <Card>
      <CardHeader
        title="Featured image"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={STATUS[shown][1]}>{STATUS[shown][0]}</Badge>
            <Button size="sm" variant="secondary" onClick={generate} disabled={busy}>
              {busy ? "Generating…" : status === "ready" ? "Regenerate" : status === "failed" ? "Retry" : "Generate"}
            </Button>
          </div>
        }
      />
      <div className="space-y-3 p-5">
        {status === "ready" && url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- external R2 URL, shown as-is */}
            <img src={url} alt={alt ?? ""} className="aspect-[3/2] w-full rounded-lg object-cover" />
            <p className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">Alt text:</span> {alt}
            </p>
            <a href={url} target="_blank" rel="noreferrer" className="block truncate text-xs text-indigo-600 hover:text-indigo-500">
              {url}
            </a>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            {busy
              ? "Creating the concept, generating the image and uploading it — usually under a minute."
              : "One professional landscape image (WebP, 1536×1024) with descriptive alt text."}
          </p>
        )}
        {status === "failed" && error && !busy && <Notice tone="error">{error}</Notice>}
        {requestError && <Notice tone="error">{requestError}</Notice>}
      </div>
    </Card>
  );
}
