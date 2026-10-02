-- Module 01: Project Setup & Website Analysis

create extension if not exists pgcrypto;

create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  url           text not null,
  domain        text not null,
  country       text not null,           -- ISO 3166-1 alpha-2, e.g. AU
  language      text not null,           -- ISO 639-1, e.g. en
  status        text not null default 'pending'
                check (status in ('pending', 'crawling', 'analyzing', 'complete', 'failed')),
  error         text,
  robots_found  boolean not null default false,
  sitemap_url   text,
  pages_crawled integer not null default 0,
  analysis      jsonb,                   -- BusinessAnalysis from Claude
  analyzed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_domain_idx on projects (domain);

create table if not exists project_pages (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  url              text not null,
  status_code      integer,
  title            text,
  meta_description text,
  h1               text,
  h2s              text[] not null default '{}',
  h3s              text[] not null default '{}',
  canonical        text,
  body_text        text,
  word_count       integer not null default 0,
  internal_links   text[] not null default '{}',
  images           jsonb not null default '[]',   -- [{ "src": string, "alt": string }]
  rendered_with    text not null default 'fetch' check (rendered_with in ('fetch', 'playwright')),
  crawled_at       timestamptz not null default now(),
  unique (project_id, url)
);

create index if not exists project_pages_project_idx on project_pages (project_id);

-- The app talks to Supabase with the service role key from the server only.
-- RLS on with no policies = no access via the public anon key.
alter table projects enable row level security;
alter table project_pages enable row level security;
