"use client";

import { useState } from "react";
import { Button, Card, cn } from "@/components/ui";
import type { ArticleContent } from "@/lib/types";

type Tab = "preview" | "html" | "json";

export interface ArticleVersion {
  key: string;
  label: string;
  html: string;
  json: ArticleContent;
  words: number;
}

/** Preview of the sanitized HTML plus raw HTML/JSON with copy buttons, for each version (original / optimized). */
export function ArticleTabs({ versions }: { versions: ArticleVersion[] }) {
  const [tab, setTab] = useState<Tab>("preview");
  const [versionKey, setVersionKey] = useState(versions[versions.length - 1].key);
  const [copied, setCopied] = useState<Tab | null>(null);
  const version = versions.find((v) => v.key === versionKey) ?? versions[0];
  const jsonText = JSON.stringify(version.json, null, 2);

  async function copy(which: Tab) {
    await navigator.clipboard.writeText(which === "json" ? jsonText : version.html);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  const segmented = (active: boolean) =>
    cn("rounded-md px-3 py-1", active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900");

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {versions.length > 1 && (
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
              {versions.map((v) => (
                <button key={v.key} onClick={() => setVersionKey(v.key)} className={segmented(v.key === versionKey)}>
                  {v.label} · {v.words.toLocaleString()} words
                </button>
              ))}
            </div>
          )}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium uppercase">
            {(["preview", "html", "json"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={segmented(tab === t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {tab !== "preview" && (
          <Button variant="secondary" size="sm" onClick={() => copy(tab)}>
            {copied === tab ? "Copied ✓" : `Copy ${tab.toUpperCase()}`}
          </Button>
        )}
      </div>

      {tab === "preview" ? (
        // The HTML comes from our own renderer (escaped text, fixed tags, same-site links only).
        <div className="article-preview px-6 py-6 sm:px-10" dangerouslySetInnerHTML={{ __html: version.html }} />
      ) : (
        <pre className="max-h-[75vh] overflow-auto bg-slate-950 p-5 text-xs leading-relaxed text-slate-100">
          {tab === "json" ? jsonText : version.html}
        </pre>
      )}
    </Card>
  );
}
