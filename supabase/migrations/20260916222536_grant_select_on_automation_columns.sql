-- The automation columns were invisible to the dashboard.
--
-- `projects` is granted to `authenticated` column by column, not as a table —
-- that is how access_token_id and webhook_secret are withheld. A column added
-- with ALTER TABLE inherits nothing from that, so analyze_branch_patterns and
-- analyze_on_new_branch arrived with INSERT and UPDATE but no SELECT, and
-- silently joined the two secrets.
--
-- PostgREST reports this as `permission denied for table projects` — the whole
-- table, not the column — so every Repositories query failed the moment
-- PROJECT_COLUMNS started naming them. Nothing was wrong with RLS.
--
-- Anything that adds a column to `projects` has to grant SELECT on it, or
-- deliberately not. There is no default to fall back on.
GRANT SELECT (analyze_branch_patterns, analyze_on_new_branch)
  ON public.projects TO authenticated;
