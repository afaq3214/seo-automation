-- Module 06: SEO, GEO & AEO Optimization — the optimized version is stored next to the original draft.
alter table articles
  add column if not exists optimized_json       jsonb,         -- ArticleContent after targeted revisions
  add column if not exists optimized_html       text,          -- sanitized HTML rendered from optimized_json
  add column if not exists optimized_word_count integer,
  add column if not exists optimization_report  jsonb,         -- checks + scores before/after, edits applied
  add column if not exists optimized_at         timestamptz;
