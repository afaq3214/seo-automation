-- Module 04: Content Gap & SEO Strategy

alter table projects
  add column if not exists strategy_status       text not null default 'idle'
    check (strategy_status in ('idle', 'running', 'complete', 'failed')),
  add column if not exists strategy_error        text,
  add column if not exists strategy_started_at   timestamptz,
  add column if not exists strategy_generated_at timestamptz;

create table if not exists content_opportunities (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects (id) on delete cascade,
  topic                text not null,                     -- recommended article / page title
  primary_keyword      text not null,
  secondary_keywords   text[] not null default '{}',
  content_type         text not null
    check (content_type in ('blog_post', 'guide', 'comparison', 'listicle', 'landing_page', 'faq')),
  search_intent        text not null
    check (search_intent in ('informational', 'commercial', 'transactional', 'navigational')),
  reason               text not null,
  opportunity_score    integer not null check (opportunity_score between 0 and 100),
  relevance_score      numeric(4, 3) not null default 0,  -- 0-1
  search_volume        integer,                           -- summed volume when available
  demand_score         numeric(6, 3),                     -- summed estimated demand (Serper discovery)
  estimated_difficulty integer check (estimated_difficulty between 0 and 100),
  competitor_count     integer not null default 0,        -- competitors ranking in the top 10
  competitor_rankings  jsonb not null default '[]',       -- [{domain, position, url, title}]
  existing_page_url    text,                              -- partially covering page on the user's site
  coverage             text not null default 'none' check (coverage in ('none', 'partial')),
  -- new: fresh recommendation · blog_requested: queued for the blog module · dismissed: hidden by user
  status               text not null default 'new'
    check (status in ('new', 'blog_requested', 'dismissed')),
  blog_requested_at    timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, primary_keyword)
);

create index if not exists content_opportunities_project_score_idx
  on content_opportunities (project_id, opportunity_score desc);

alter table content_opportunities enable row level security;
