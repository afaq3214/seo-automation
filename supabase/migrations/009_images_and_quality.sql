-- Module 08: one featured image per article · Module 09: SEO/GEO/AEO scores + improvement loop

alter table articles
  add column if not exists featured_image_url          text,
  add column if not exists featured_image_alt          text,
  add column if not exists featured_image_status       text not null default 'none'
    check (featured_image_status in ('none', 'generating', 'ready', 'failed')),
  add column if not exists featured_image_error        text,
  add column if not exists featured_image_prompt       text,
  add column if not exists featured_image_key          text,      -- object key in R2
  add column if not exists featured_image_generated_at timestamptz,
  add column if not exists schema_json                 jsonb,     -- Article + FAQPage JSON-LD
  add column if not exists seo_score                   integer,
  add column if not exists geo_score                   integer,
  add column if not exists aeo_score                   integer,
  add column if not exists quality_report              jsonb,     -- criteria, reasons, rounds
  add column if not exists quality_checked_at          timestamptz;

alter table articles drop constraint if exists articles_status_check;
alter table articles
  add constraint articles_status_check
  check (status in ('draft', 'ready', 'needs_review', 'approved', 'published'));
