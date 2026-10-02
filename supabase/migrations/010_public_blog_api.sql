-- Public blog API: site keys per project + publishing fields on articles.

create extension if not exists pgcrypto;

-- Public identifier used as ?site=SITE_KEY (not a secret: it only unlocks published articles).
alter table projects
  add column if not exists site_key      text unique default encode(gen_random_bytes(9), 'hex'),
  add column if not exists blog_base_url text;   -- e.g. https://callacy.com/blog (default: <site>/blog)

update projects set site_key = encode(gen_random_bytes(9), 'hex') where site_key is null;
alter table projects alter column site_key set not null;

alter table articles
  add column if not exists excerpt       text,
  add column if not exists canonical_url text,
  add column if not exists faq_json      jsonb not null default '[]',
  add column if not exists publish_at    timestamptz;   -- public once status is ready/published and this is <= now()

-- Backfill from the final content (optimized version when it exists).
update articles set
  excerpt  = coalesce(excerpt, coalesce(optimized_json, content_json)->>'metaDescription'),
  faq_json = coalesce(coalesce(optimized_json, content_json)->'faq', '[]'::jsonb);

-- The public API filters on these.
create index if not exists articles_public_idx on articles (project_id, status, publish_at desc);

-- Canonical URL for existing articles: <blog_base_url or site origin + /blog>/<slug>
update articles a set canonical_url =
  rtrim(coalesce(p.blog_base_url, substring(p.url from '^(https?://[^/]+)') || '/blog'), '/') || '/' || a.slug
from projects p
where p.id = a.project_id and a.canonical_url is null;
