-- Full automation: crawl → keywords → competitors → strategy → one article per day (write, optimize,
-- images, quality, publish). The strategy refreshes every few days. Runs one step per request.

alter table projects
  add column if not exists auto_enabled          boolean not null default false,
  add column if not exists auto_step             text,          -- step currently/last run
  add column if not exists auto_attempts         integer not null default 0,
  add column if not exists auto_error            text,
  add column if not exists auto_locked_until     timestamptz,   -- lease so two runs never work on one project
  add column if not exists auto_retry_at         timestamptz,   -- after a failure: wait until then
  add column if not exists auto_article_id       uuid references articles (id) on delete set null,
  add column if not exists auto_next_post_at     timestamptz,   -- when the next daily article is due
  add column if not exists auto_pages_queued_at  timestamptz,   -- full-site crawl queued once
  add column if not exists auto_last_run_at      timestamptz;

create index if not exists projects_auto_enabled_idx on projects (auto_enabled) where auto_enabled;

create table if not exists automation_events (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  step        text not null,
  level       text not null default 'info' check (level in ('info', 'error')),
  message     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists automation_events_project_idx on automation_events (project_id, created_at desc);

alter table automation_events enable row level security;
