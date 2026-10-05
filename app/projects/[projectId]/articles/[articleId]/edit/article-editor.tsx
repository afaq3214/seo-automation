"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJson } from "@/components/read-json";
import { Button, Card, CardHeader, inputClass, Notice } from "@/components/ui";
import type { ArticleBlock, ArticleContent } from "@/lib/types";

type BlockType = ArticleBlock["type"];
/** Every block is edited as plain text; see `toText` / `toBlock` for the format per type. */
interface EditBlock {
  type: BlockType;
  ordered: boolean;
  text: string;
}
interface EditSection {
  heading: string;
  level: 2 | 3;
  blocks: EditBlock[];
}

const BLOCK_HELP: Record<BlockType, string> = {
  paragraph: "One paragraph.",
  callout: "A highlighted tip or note.",
  list: "One list item per line.",
  table: "One row per line, cells separated by | . The first line is the header row.",
};

const toText = (b: ArticleBlock): EditBlock => {
  if (b.type === "list") return { type: "list", ordered: b.ordered, text: b.items.join("\n") };
  if (b.type === "table") return { type: "table", ordered: false, text: [b.headers, ...b.rows].map((r) => r.join(" | ")).join("\n") };
  return { type: b.type, ordered: false, text: b.text };
};

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

function toBlock(b: EditBlock) {
  if (b.type === "list") return { type: "list" as const, ordered: b.ordered, items: lines(b.text) };
  if (b.type === "table") {
    const rows = lines(b.text).map((l) => l.split("|").map((c) => c.trim()));
    return { type: "table" as const, headers: rows[0] ?? [], rows: rows.slice(1) };
  }
  return { type: b.type, text: b.text.trim() };
}

const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);

/** Manual editor for an article: SEO fields, intro, sections and their blocks, FAQ and call to action. */
export function ArticleEditor({ projectId, articleId, initial, published }: { projectId: string; articleId: string; initial: ArticleContent; published: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [metaTitle, setMetaTitle] = useState(initial.metaTitle);
  const [metaDescription, setMetaDescription] = useState(initial.metaDescription);
  const [slug, setSlug] = useState(initial.slug);
  const [intro, setIntro] = useState(initial.intro.join("\n\n"));
  const [sections, setSections] = useState<EditSection[]>(initial.sections.map((s) => ({ heading: s.heading, level: s.level, blocks: s.blocks.map(toText) })));
  const [faq, setFaq] = useState(initial.faq);
  const [cta, setCta] = useState(initial.cta);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateSection = (i: number, patch: Partial<EditSection>) => setSections((all) => all.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const updateBlock = (i: number, j: number, patch: Partial<EditBlock>) =>
    updateSection(i, { blocks: sections[i].blocks.map((b, n) => (n === j ? { ...b, ...patch } : b)) });
  const moveSection = (i: number, by: number) =>
    setSections((all) => {
      const next = [...all];
      const [s] = next.splice(i, 1);
      next.splice(i + by, 0, s);
      return next;
    });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const content = {
        title: title.trim(),
        metaTitle: metaTitle.trim(),
        metaDescription: metaDescription.trim(),
        slug: slug.trim(),
        intro: paragraphs(intro),
        sections: sections.map((s) => ({ heading: s.heading.trim(), level: s.level, blocks: s.blocks.map(toBlock) })),
        faq: faq.map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })),
        cta,
      };
      const res = await fetch(`/api/projects/${projectId}/articles/${articleId}/content`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const json = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      router.push(`/projects/${projectId}/articles/${articleId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  const label = "mb-1.5 block text-xs font-medium text-slate-700";
  const area = `${inputClass} h-auto w-full py-2 leading-6`;
  const small = "text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40";
  const remove = "text-xs font-medium text-red-600 hover:text-red-500";

  return (
    <div className="max-w-4xl space-y-6">
      <Notice tone="info">
        Formatting inside text: <code>**bold**</code> and <code>[link text](https://…)</code>. Links only work to pages on the site itself.
      </Notice>

      <Card>
        <CardHeader title="Title & SEO" />
        <div className="space-y-4 p-5">
          <div>
            <label className={label}>Title (H1)</label>
            <input className={`${inputClass} w-full`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className={label}>Meta title ({metaTitle.length}/60)</label>
            <input className={`${inputClass} w-full`} value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
          </div>
          <div>
            <label className={label}>Meta description ({metaDescription.length}/160)</label>
            <textarea className={area} rows={2} value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} />
          </div>
          <div>
            <label className={label}>Slug (the page's URL)</label>
            <input className={`${inputClass} w-full`} value={slug} onChange={(e) => setSlug(e.target.value)} />
            {published && slug.trim() !== initial.slug && (
              <p className="mt-1 text-xs text-amber-700">This article is live. Changing the slug changes its URL, and the old URL will stop working.</p>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Introduction" description="Leave an empty line between paragraphs." />
        <div className="p-5">
          <textarea className={area} rows={7} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </div>
      </Card>

      {sections.map((s, i) => (
        <Card key={i}>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
            <select className={inputClass} value={s.level} onChange={(e) => updateSection(i, { level: Number(e.target.value) === 3 ? 3 : 2 })}>
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
            <input className={`${inputClass} min-w-0 flex-1 font-medium`} value={s.heading} placeholder="Section heading" onChange={(e) => updateSection(i, { heading: e.target.value })} />
            <button className={small} onClick={() => moveSection(i, -1)} disabled={i === 0}>
              ↑ Up
            </button>
            <button className={small} onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1}>
              ↓ Down
            </button>
            <button className={remove} onClick={() => setSections((all) => all.filter((_, n) => n !== i))}>
              Delete section
            </button>
          </div>
          <div className="space-y-4 p-5">
            {s.blocks.map((b, j) => (
              <div key={j}>
                <div className="mb-1.5 flex flex-wrap items-center gap-3">
                  <select className={`${inputClass} h-8 text-xs`} value={b.type} onChange={(e) => updateBlock(i, j, { type: e.target.value as BlockType })}>
                    <option value="paragraph">Paragraph</option>
                    <option value="list">List</option>
                    <option value="table">Table</option>
                    <option value="callout">Callout</option>
                  </select>
                  {b.type === "list" && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={b.ordered} onChange={(e) => updateBlock(i, j, { ordered: e.target.checked })} /> Numbered
                    </label>
                  )}
                  <span className="text-xs text-slate-400">{BLOCK_HELP[b.type]}</span>
                  <button className={`${remove} ml-auto`} onClick={() => updateSection(i, { blocks: s.blocks.filter((_, n) => n !== j) })}>
                    Delete
                  </button>
                </div>
                <textarea
                  className={`${area} ${b.type === "table" ? "font-mono text-xs" : ""}`}
                  rows={Math.min(14, Math.max(2, Math.ceil(b.text.length / 95) + b.text.split("\n").length - 1))}
                  value={b.text}
                  onChange={(e) => updateBlock(i, j, { text: e.target.value })}
                />
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => updateSection(i, { blocks: [...s.blocks, { type: "paragraph", ordered: false, text: "" }] })}>
              + Add paragraph, list or table
            </Button>
          </div>
        </Card>
      ))}
      <Button variant="secondary" onClick={() => setSections((all) => [...all, { heading: "", level: 2, blocks: [{ type: "paragraph", ordered: false, text: "" }] }])}>
        + Add section
      </Button>

      <Card>
        <CardHeader title="Frequently asked questions" />
        <div className="space-y-4 p-5">
          {faq.map((f, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  className={`${inputClass} min-w-0 flex-1 font-medium`}
                  value={f.question}
                  placeholder="Question"
                  onChange={(e) => setFaq((all) => all.map((x, n) => (n === i ? { ...x, question: e.target.value } : x)))}
                />
                <button className={remove} onClick={() => setFaq((all) => all.filter((_, n) => n !== i))}>
                  Delete
                </button>
              </div>
              <textarea
                className={area}
                rows={3}
                value={f.answer}
                placeholder="Answer"
                onChange={(e) => setFaq((all) => all.map((x, n) => (n === i ? { ...x, answer: e.target.value } : x)))}
              />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setFaq((all) => [...all, { question: "", answer: "" }])}>
            + Add question
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Call to action" />
        <div className="space-y-4 p-5">
          <div>
            <label className={label}>Heading</label>
            <input className={`${inputClass} w-full`} value={cta.heading} onChange={(e) => setCta({ ...cta, heading: e.target.value })} />
          </div>
          <div>
            <label className={label}>Text</label>
            <textarea className={area} rows={2} value={cta.text} onChange={(e) => setCta({ ...cta, text: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Button label</label>
              <input className={`${inputClass} w-full`} value={cta.buttonLabel} onChange={(e) => setCta({ ...cta, buttonLabel: e.target.value })} />
            </div>
            <div>
              <label className={label}>Button link</label>
              <input className={`${inputClass} w-full`} value={cta.buttonUrl} onChange={(e) => setCta({ ...cta, buttonUrl: e.target.value })} />
            </div>
          </div>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      <div className="sticky bottom-0 flex items-center gap-3 border-t border-slate-200 bg-white/95 py-4 backdrop-blur">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="secondary" onClick={() => router.push(`/projects/${projectId}/articles/${articleId}`)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
