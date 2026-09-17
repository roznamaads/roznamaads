-- RoznamaAds.pk — add "toolnest_tool_slug" column to articles table
-- ---------------------------------------------------------------------------
-- Lets the admin pick ONE specific ToolNest tool (not just a category) for
-- an article's cross-promotion widget. If left NULL, article.html falls
-- back to picking a random tool from toolnest_category (old behavior).
-- ---------------------------------------------------------------------------

alter table public.articles
  add column if not exists toolnest_tool_slug text;
