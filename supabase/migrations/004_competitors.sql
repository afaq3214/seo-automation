-- Module 03: Competitor Discovery & Analysis

-- Discovery run state on the project (one run at a time per project).
alter table projects
  add column if not exists competitors_status        text not null default 'idle'
    check (competitors_status in ('idle', 'running', 'complete', 'failed')),
  add column if not exists competitors_error         text,
  add column if not exists competitors_started_at    timestamptz,
  add column if not exists competitors_discovered_at timestamptz,
  add column if not exists competitor_queries        text[] not null default '{}';

create table if not exists project_competitors (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects (id) on delete cascade,
  domain             text not null,
  homepage_url       text,
  title              text,
  meta_description   text,
  h1                 text,
  nav_labels         text[] not null default '{}',
  homepage_status    text not null default 'ok'
    check (homepage_status in ('ok', 'rendered', 'blocked', 'failed')),
  competitor_type    text
    check (competitor_type in ('direct', 'adjacent', 'publisher', 'marketplace', 'directory', 'ugc', 'irrelevant')),
  relevance_score    integer check (relevance_score between 0 and 100),
  product_similarity integer check (product_similarity between 0 and 100),
  audience_similarity integer check (audience_similarity between 0 and 100),
  serp_appearances   integer not null default 0,        -- distinct discovery queries it ranked for
  best_position      integer,
  competitor_score   integer not null default 0 check (competitor_score between 0 and 100),
  reason             text,
  -- active: classified and kept · pending_review: classification failed · removed: hidden by the user
  status             text not null default 'active'
    check (status in ('active', 'pending_review', 'removed')),
  is_manual          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, domain)
);

create index if not exists project_competitors_project_score_idx
  on project_competitors (project_id, competitor_score desc);

-- Raw discovery SERP rows: explains why a competitor was found (which queries, which positions).
create table if not exists competitor_serp_results (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  query       text not null,
  position    integer not null,
  domain      text not null,          -- root domain, e.g. sophiie.ai
  url         text not null,
  title       text,
  description text,
  created_at  timestamptz not null default now()
);

create index if not exists competitor_serp_results_project_domain_idx
  on competitor_serp_results (project_id, domain);

alter table project_competitors enable row level security;
alter table competitor_serp_results enable row level security;
