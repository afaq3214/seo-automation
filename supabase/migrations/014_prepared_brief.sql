-- Automation writes an article in two steps (research + brief, then the article) so each fits in one
-- 5-minute run even with a slower model. The brief is kept on the opportunity between the two steps.
alter table content_opportunities
  add column if not exists brief_json    jsonb,
  add column if not exists research_json jsonb;
