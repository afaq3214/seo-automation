-- Serper keyword discovery: estimated demand (0-1) when real search volume isn't available.
alter table project_keywords
  add column if not exists demand_score numeric(4, 3);
