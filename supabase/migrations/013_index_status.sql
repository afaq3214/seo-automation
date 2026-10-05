-- Google index status per article, read from Search Console (URL Inspection API).
alter table articles
  add column if not exists index_verdict     text,         -- PASS = indexed
  add column if not exists index_status      text,         -- Google's wording, e.g. "Submitted and indexed"
  add column if not exists index_last_crawl  timestamptz,
  add column if not exists index_checked_at  timestamptz;
