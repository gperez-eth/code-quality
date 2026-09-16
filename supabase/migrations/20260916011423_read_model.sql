-- Written by hand, not generated: views and functions are not modelled in
-- schema.ts.
--
-- PostgREST serves rows, not calculations: no GROUP BY, no window functions.
-- Everything the dashboard computes had to live somewhere the REST API can
-- reach, so it lives here.
--
-- Every view is SECURITY INVOKER. This is the whole ballgame: a Postgres view
-- runs as its OWNER by default, and the owner here is a role that bypasses RLS
-- — so a view created without this would hand every tenant's rows to anyone
-- who asked. With it, the underlying policies apply to the caller.

-- The newest analysis of each project, whatever state it ended in: a failed or
-- still-running one is exactly what the repository row needs to show.
CREATE OR REPLACE VIEW public.project_latest_analysis
WITH (security_invoker = on) AS
SELECT DISTINCT ON (a.project_id)
  a.project_id,
  a.id AS analysis_id,
  a.status,
  a.gate_status,
  a.branch,
  a.commit_sha,
  a.commit_message,
  a.commit_author,
  a.version,
  a.started_at,
  a.finished_at,
  a.baseline_analysis_id,
  a.error
FROM public.analyses a
ORDER BY a.project_id, a.started_at DESC;

-- What the dashboard calls "unresolved": still someone's problem.
CREATE OR REPLACE VIEW public.project_open_issue_counts
WITH (security_invoker = on) AS
SELECT
  i.project_id,
  count(*)::int AS open_issues,
  coalesce(sum(i.effort_minutes), 0)::int AS open_effort_minutes
FROM public.issues i
WHERE i.status IN ('OPEN', 'CONFIRMED', 'REOPENED')
GROUP BY i.project_id;

-- Lines of code per language, for the share bar on the overview. Reading this
-- from the REST API otherwise means pulling one row per file in the repository
-- to add up five numbers in the browser.
CREATE OR REPLACE VIEW public.analysis_language_ncloc
WITH (security_invoker = on) AS
SELECT
  f.analysis_id,
  f.language,
  sum(f.ncloc)::int AS ncloc
FROM public.file_measures f
GROUP BY f.analysis_id, f.language;

GRANT SELECT ON public.project_latest_analysis TO authenticated;
GRANT SELECT ON public.project_open_issue_counts TO authenticated;
GRANT SELECT ON public.analysis_language_ncloc TO authenticated;

-- The faceted counts down the side of the Issues screen.
--
-- Each facet is counted with its OWN dimension left out of the filter, which
-- is what makes the numbers useful: with severity BLOCKER selected, the
-- severity list still has to show how many MAJOR there would be if you
-- switched. That is four differently-filtered GROUP BYs plus the totals, so it
-- is one function returning one JSON document rather than six round trips.
--
-- SECURITY INVOKER (the default, stated here because it matters): the policies
-- on public.issues apply to whoever calls it.
CREATE OR REPLACE FUNCTION public.issue_facets(
  p_project_id uuid,
  p_types text[] DEFAULT NULL,
  p_severities text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_file text DEFAULT NULL,
  p_new_code_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH params AS (
  SELECT
    nullif(p_types, '{}') AS types,
    nullif(p_severities, '{}') AS severities,
    -- No status chosen means "unresolved", the same default the server used.
    coalesce(nullif(p_statuses, '{}'), ARRAY['OPEN', 'CONFIRMED', 'REOPENED']) AS statuses,
    nullif(p_tags, '{}') AS tags
),
base AS (
  SELECT i.*
  FROM public.issues i
  WHERE i.project_id = p_project_id
    AND (p_file IS NULL OR i.file_path = p_file)
    AND (NOT p_new_code_only OR i.is_new_code)
),
matched AS (
  SELECT b.*
  FROM base b, params p
  WHERE (p.types IS NULL OR b.type::text = ANY (p.types))
    AND (p.severities IS NULL OR b.severity::text = ANY (p.severities))
    AND b.status::text = ANY (p.statuses)
    AND (p.tags IS NULL OR b.tags && p.tags)
)
SELECT jsonb_build_object(
  'total', (SELECT count(*)::int FROM matched),
  'effort_minutes', (SELECT coalesce(sum(effort_minutes), 0)::int FROM matched),
  'types', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', count) ORDER BY value), '[]'::jsonb)
    FROM (
      SELECT b.type::text AS value, count(*)::int AS count
      FROM base b, params p
      WHERE (p.severities IS NULL OR b.severity::text = ANY (p.severities))
        AND b.status::text = ANY (p.statuses)
        AND (p.tags IS NULL OR b.tags && p.tags)
      GROUP BY b.type
    ) facet
  ),
  'severities', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', count) ORDER BY sort_key), '[]'::jsonb)
    FROM (
      -- The enum is declared worst-first, so ordering by it sorts correctly.
      SELECT b.severity::text AS value, b.severity AS sort_key, count(*)::int AS count
      FROM base b, params p
      WHERE (p.types IS NULL OR b.type::text = ANY (p.types))
        AND b.status::text = ANY (p.statuses)
        AND (p.tags IS NULL OR b.tags && p.tags)
      GROUP BY b.severity
    ) facet
  ),
  'statuses', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', count) ORDER BY value), '[]'::jsonb)
    FROM (
      SELECT b.status::text AS value, count(*)::int AS count
      FROM base b, params p
      WHERE (p.types IS NULL OR b.type::text = ANY (p.types))
        AND (p.severities IS NULL OR b.severity::text = ANY (p.severities))
        AND (p.tags IS NULL OR b.tags && p.tags)
      GROUP BY b.status
    ) facet
  ),
  'tags', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', count) ORDER BY count DESC, value), '[]'::jsonb)
    FROM (
      SELECT tag AS value, count(*)::int AS count
      FROM (
        SELECT unnest(b.tags) AS tag
        FROM base b, params p
        WHERE (p.types IS NULL OR b.type::text = ANY (p.types))
          AND (p.severities IS NULL OR b.severity::text = ANY (p.severities))
          AND b.status::text = ANY (p.statuses)
      ) tags
      GROUP BY tag
      ORDER BY count(*) DESC, tag
      LIMIT 20
    ) facet
  )
);
$$;

REVOKE EXECUTE ON FUNCTION public.issue_facets(uuid, text[], text[], text[], text[], text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_facets(uuid, text[], text[], text[], text[], text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_facets(uuid, text[], text[], text[], text[], text, boolean) TO authenticated;
