-- Module 02: SEO Keyword Research & Metrics

-- Research run state on the project (one run at a time per project).
alter table projects
  add column if not exists keywords_status        text not null default 'idle'
    check (keywords_status in ('idle', 'running', 'complete', 'failed')),
  add column if not exists keywords_error         text,
  add column if not exists keywords_started_at    timestamptz,
  add column if not exists keywords_researched_at timestamptz,
  add column if not exists keyword_seeds          text[] not null default '{}';

create table if not exists project_keywords (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects (id) on delete cascade,
  keyword              text not null,
  search_volume        integer,
  competition          text check (competition in ('LOW', 'MEDIUM', 'HIGH')),  -- Google Ads (paid) competition
  competition_index    integer,                                                -- 0-100, Google Ads
  cpc_low              numeric(10, 2),                                         -- low top-of-page bid, account currency
  cpc_high             numeric(10, 2),                                         -- high top-of-page bid, account currency
  intent               text not null
    check (intent in ('informational', 'commercial', 'transactional', 'navigational')),
  cluster_name         text not null,
  is_primary_keyword   boolean not null default false,
  relevance_score      numeric(4, 3) not null default 0,                      -- 0-1, keyword vs business
  estimated_difficulty integer check (estimated_difficulty between 0 and 100),
  difficulty_label     text check (difficulty_label in ('Easy', 'Medium', 'Hard', 'Very Hard')),
  difficulty_status    text not null default 'not_selected'
    check (difficulty_status in ('checked', 'pending', 'not_selected')),
  opportunity_score    integer not null default 0 check (opportunity_score between 0 and 100),
  serp_top10           jsonb,                                                  -- [{position,title,link,domain}]
  serp_checked_at      timestamptz,
  country              text not null,
  language             text not null,
  source               text not null default 'google_ads',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, keyword)
);

create index if not exists project_keywords_project_opportunity_idx
  on project_keywords (project_id, opportunity_score desc);
create index if not exists project_keywords_project_cluster_idx
  on project_keywords (project_id, cluster_name);

-- Serper.dev results cached for ~7 days so the same keyword is never checked twice in a week.
create table if not exists keyword_serp_cache (
  id         uuid primary key default gen_random_uuid(),
  keyword    text not null,
  country    text not null,
  language   text not null,
  serp_data  jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (keyword, country, language)
);

alter table project_keywords enable row level security;
alter table keyword_serp_cache enable row level security;
