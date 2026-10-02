-- Module 05: SERP Brief & Blog Generation

create table if not exists articles (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects (id) on delete cascade,
  opportunity_id     uuid references content_opportunities (id) on delete set null,
  title              text not null,
  slug               text not null,
  meta_title         text not null,
  meta_description   text not null,
  primary_keyword    text not null,
  secondary_keywords text[] not null default '{}',
  brief              jsonb not null,            -- ContentBrief
  serp_research      jsonb not null,            -- SERP results, questions and competitor page outlines used
  content_json       jsonb not null,            -- ArticleContent (structured sections)
  content_html       text not null,             -- sanitized HTML rendered from content_json
  word_count         integer not null default 0,
  status             text not null default 'draft' check (status in ('draft', 'approved', 'published')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, slug)
);

create index if not exists articles_project_created_idx on articles (project_id, created_at desc);

-- Opportunities get a "drafted" status once an article exists for them.
alter table content_opportunities drop constraint if exists content_opportunities_status_check;
alter table content_opportunities
  add constraint content_opportunities_status_check
  check (status in ('new', 'blog_requested', 'drafted', 'dismissed'));

alter table articles enable row level security;
