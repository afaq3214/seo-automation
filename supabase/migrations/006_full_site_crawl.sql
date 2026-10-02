-- Full-site crawl: every sitemap URL is stored first as "pending", then crawled in batches.
alter table project_pages
  add column if not exists crawl_status text not null default 'crawled'
    check (crawl_status in ('crawled', 'pending', 'failed')),
  add column if not exists crawl_error  text;

create index if not exists project_pages_project_status_idx on project_pages (project_id, crawl_status);
