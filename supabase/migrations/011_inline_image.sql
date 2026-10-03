-- Second image per article, shown in the middle of the article (next to the section it illustrates).
alter table articles
  add column if not exists inline_image_url          text,
  add column if not exists inline_image_alt          text,
  add column if not exists inline_image_status       text not null default 'none'
    check (inline_image_status in ('none', 'generating', 'ready', 'failed')),
  add column if not exists inline_image_error        text,
  add column if not exists inline_image_prompt       text,
  add column if not exists inline_image_key          text,      -- object key in storage
  add column if not exists inline_image_heading      text,      -- heading of the section it illustrates
  add column if not exists inline_image_generated_at timestamptz;
