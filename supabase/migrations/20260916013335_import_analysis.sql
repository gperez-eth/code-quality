-- The write path, moved into the database.
--
-- Publishing an analysis was a drizzle transaction over a direct Postgres
-- connection: eight statements that had to land together, because a
-- half-imported analysis shows up in the dashboard as a real one. REST has no
-- multi-statement transaction, so going through the API means the transaction
-- moves here, behind one call.
--
-- SECURITY DEFINER, because the policies on these tables are read-only and
-- stay that way: nothing should be able to write a row by POSTing to
-- /rest/v1/issues. Authorisation is therefore this function's own job, and it
-- is the first thing it does.

-- Reliability and security are rated by the worst issue present. Mirrors
-- ratingFromWorstSeverity in packages/core/src/rating.ts — the two have to
-- agree, so a change to the bands there is a change here.
CREATE OR REPLACE FUNCTION private.rating_from_worst_severity(
  p_blocker int, p_critical int, p_major int, p_minor int
) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_blocker > 0 THEN 5
    WHEN p_critical > 0 THEN 4
    WHEN p_major > 0 THEN 3
    WHEN p_minor > 0 THEN 2
    ELSE 1
  END;
$$;

-- Maintainability is rated by the technical debt ratio. Mirrors
-- ratingFromDebtRatio in packages/core/src/rating.ts.
CREATE OR REPLACE FUNCTION private.rating_from_debt_ratio(p_ratio numeric)
RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_ratio <= 0.05 THEN 1
    WHEN p_ratio <= 0.10 THEN 2
    WHEN p_ratio <= 0.20 THEN 3
    WHEN p_ratio <= 0.50 THEN 4
    ELSE 5
  END;
$$;

-- The report's issues as rows, so the three reconciliation statements below
-- can each read them without repeating the unpacking.
CREATE OR REPLACE FUNCTION private.reported_issues(p_report jsonb)
RETURNS TABLE (
  fingerprint text,
  rule_key text,
  type public.issue_type,
  severity public.severity,
  file_path text,
  start_line int,
  end_line int,
  start_column int,
  end_column int,
  message text,
  effort_minutes int,
  tags text[],
  flow jsonb
)
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    i->>'fingerprint',
    i->>'ruleKey',
    (i->>'type')::public.issue_type,
    (i->>'severity')::public.severity,
    i->>'filePath',
    (i->'range'->>'startLine')::int,
    (i->'range'->>'endLine')::int,
    (i->'range'->>'startColumn')::int,
    (i->'range'->>'endColumn')::int,
    i->>'message',
    coalesce((i->>'effortMinutes')::int, 0),
    coalesce((SELECT array_agg(value) FROM jsonb_array_elements_text(i->'tags')), '{}'::text[]),
    CASE WHEN i->'flow' = 'null'::jsonb THEN NULL ELSE i->'flow' END
  FROM jsonb_array_elements(p_report->'issues') i;
$$;

CREATE OR REPLACE FUNCTION public.import_analysis(
  p_organization_id uuid,
  p_project_key text,
  p_report jsonb,
  -- The built-in gate, passed in rather than hardcoded: SONAR_WAY_GATE lives
  -- in packages/core and stays the one definition. Thresholds arrive numeric,
  -- ratings already converted.
  p_default_gate jsonb,
  p_project_name text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_repository_url text DEFAULT NULL,
  p_local_path text DEFAULT NULL,
  -- Already encrypted by the caller: this function never sees a plaintext token.
  p_access_token text DEFAULT NULL,
  p_branch text DEFAULT NULL,
  p_commit_sha text DEFAULT NULL,
  p_commit_message text DEFAULT NULL,
  p_commit_author text DEFAULT NULL,
  p_committed_at timestamptz DEFAULT NULL,
  p_trigger text DEFAULT 'CLI',
  p_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Matches the analyzer: 0.06 days per line, on an eight-hour day.
  c_dev_cost_per_line CONSTANT numeric := 0.06 * 8 * 60;

  v_gate_id uuid;
  v_project_id uuid;
  v_previous_id uuid;
  v_analysis_id uuid;
  v_first boolean;
  v_ncloc numeric;

  v_new int := 0;
  v_reopened int := 0;
  v_unchanged int := 0;
  v_closed int := 0;

  v_bugs int := 0;
  v_vulns int := 0;
  v_smells int := 0;
  v_hotspots int := 0;
  v_debt int := 0;
  v_bug_blocker int := 0; v_bug_critical int := 0; v_bug_major int := 0; v_bug_minor int := 0;
  v_vuln_blocker int := 0; v_vuln_critical int := 0; v_vuln_major int := 0; v_vuln_minor int := 0;
  v_new_code jsonb;
BEGIN
  -- Who is asking. A signed-in account must belong to the organisation it is
  -- writing to; the service role is the CI publisher and is trusted.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Not a member of organisation %', p_organization_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- The organisation's own copy of the built-in gate, created once and left
  -- alone after: a tenant retuning a threshold must not move anyone else's bar.
  SELECT id INTO v_gate_id
  FROM public.quality_gates
  WHERE organization_id = p_organization_id AND name = p_default_gate->>'name';

  IF v_gate_id IS NULL THEN
    INSERT INTO public.quality_gates (organization_id, name, is_default, is_built_in)
    VALUES (p_organization_id, p_default_gate->>'name', true, true)
    RETURNING id INTO v_gate_id;

    INSERT INTO public.quality_gate_conditions (gate_id, metric, operator, threshold, scope)
    SELECT v_gate_id, c->>'metric', (c->>'operator')::public.gate_operator,
           (c->>'threshold')::real, (c->>'scope')::public.gate_scope
    FROM jsonb_array_elements(p_default_gate->'conditions') c;
  END IF;

  -- Repository details are only written when supplied, so a re-analysis never
  -- wipes the token or the remote the project was connected with.
  INSERT INTO public.projects (
    organization_id, key, name, provider, repository_url, local_path,
    access_token, main_branch, quality_gate_id, last_analyzed_at
  )
  VALUES (
    p_organization_id, p_project_key, coalesce(p_project_name, p_project_key),
    coalesce(p_provider, 'LOCAL')::public.repository_provider, p_repository_url, p_local_path,
    p_access_token, coalesce(p_branch, 'main'), v_gate_id, now()
  )
  ON CONFLICT (organization_id, key) DO UPDATE SET
    name = coalesce(p_project_name, public.projects.name),
    last_analyzed_at = now(),
    provider = coalesce(p_provider::public.repository_provider, public.projects.provider),
    repository_url = coalesce(p_repository_url, public.projects.repository_url),
    local_path = coalesce(p_local_path, public.projects.local_path),
    access_token = coalesce(p_access_token, public.projects.access_token),
    main_branch = coalesce(p_branch, public.projects.main_branch),
    -- Keep whatever gate the project was moved to, if any.
    quality_gate_id = coalesce(public.projects.quality_gate_id, v_gate_id)
  RETURNING id INTO v_project_id;

  -- The rule catalogue is global and always the analyzer's latest word on it.
  INSERT INTO public.rules (key, name, languages, type, default_severity, description, effort_minutes, tags)
  SELECT
    r->>'key',
    r->>'name',
    coalesce((SELECT array_agg(value) FROM jsonb_array_elements_text(r->'languages')), '{}'::text[]),
    (r->>'type')::public.issue_type,
    (r->>'severity')::public.severity,
    coalesce(r->>'description', ''),
    coalesce((r->>'effortMinutes')::int, 5),
    coalesce((SELECT array_agg(value) FROM jsonb_array_elements_text(r->'tags')), '{}'::text[])
  FROM jsonb_array_elements(p_report->'rules') r
  ON CONFLICT (key) DO UPDATE SET
    name = excluded.name,
    languages = excluded.languages,
    type = excluded.type,
    default_severity = excluded.default_severity,
    description = excluded.description,
    effort_minutes = excluded.effort_minutes,
    tags = excluded.tags;

  SELECT id INTO v_previous_id
  FROM public.analyses
  WHERE project_id = v_project_id AND status = 'SUCCEEDED'
  ORDER BY started_at DESC
  LIMIT 1;

  v_first := v_previous_id IS NULL;

  INSERT INTO public.analyses (
    project_id, status, trigger, branch, commit_sha, commit_message, commit_author,
    committed_at, version, baseline_analysis_id, gate_status, started_at, finished_at
  )
  VALUES (
    v_project_id, 'SUCCEEDED', coalesce(p_trigger, 'CLI')::public.analysis_trigger,
    coalesce(p_branch, 'main'), p_commit_sha, p_commit_message, p_commit_author,
    p_committed_at, p_version, v_previous_id,
    (p_report->'gate'->>'status')::public.gate_status,
    now() - (coalesce((p_report->>'durationMs')::numeric, 0) || ' milliseconds')::interval,
    now()
  )
  RETURNING id INTO v_analysis_id;

  -- ORDER MATTERS, and it is not obvious: the update runs BEFORE the insert.
  --
  -- Reconciliation asks "which of these did this project already know?", and
  -- that question has to be asked while the answer is still true. Inserting
  -- first makes every new finding look like a pre-existing one to the
  -- statement below, and the counts come back nonsense.
  -- Findings already known. The line and the message drift while the finding
  -- stays the same one, so they are refreshed; anything that had been resolved
  -- and is back is reopened rather than silently re-opened as new.
  WITH seen AS (
    SELECT x.id, x.status AS previous_status, r.*
    FROM private.reported_issues(p_report) r
    JOIN public.issues x ON x.project_id = v_project_id AND x.fingerprint = r.fingerprint
  ), updated AS (
    UPDATE public.issues t SET
      severity = s.severity,
      type = s.type,
      file_path = s.file_path,
      start_line = s.start_line,
      end_line = s.end_line,
      start_column = s.start_column,
      end_column = s.end_column,
      message = s.message,
      effort_minutes = s.effort_minutes,
      tags = s.tags,
      status = CASE WHEN s.previous_status IN ('RESOLVED', 'CLOSED') THEN 'REOPENED'::public.issue_status
                    ELSE s.previous_status END,
      resolution = NULL,
      resolved_at = NULL,
      is_new_code = v_first
    FROM seen s
    WHERE t.id = s.id
    RETURNING s.previous_status
  )
  SELECT
    count(*) FILTER (WHERE previous_status IN ('RESOLVED', 'CLOSED')),
    count(*) FILTER (WHERE previous_status NOT IN ('RESOLVED', 'CLOSED'))
  INTO v_reopened, v_unchanged
  FROM updated;

  -- Findings this project has never seen. Inserted and tallied in one
  -- statement, so the leak-period numbers are computed from exactly the rows
  -- that were written, not from a second pass that could disagree.
  WITH fresh AS (
    SELECT r.* FROM private.reported_issues(p_report) r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.issues x
      WHERE x.project_id = v_project_id AND x.fingerprint = r.fingerprint
    )
  ), inserted AS (
    INSERT INTO public.issues (
      project_id, analysis_id, rule_key, fingerprint, type, severity, status, file_path,
      start_line, end_line, start_column, end_column, message, effort_minutes, tags, flow, is_new_code
    )
    SELECT
      v_project_id, v_analysis_id, f.rule_key, f.fingerprint, f.type, f.severity, 'OPEN', f.file_path,
      f.start_line, f.end_line, f.start_column, f.end_column, f.message, f.effort_minutes, f.tags, f.flow,
      -- On a first analysis the whole codebase is the leak period.
      true
    FROM fresh f
    RETURNING type, severity, effort_minutes
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE type = 'BUG'),
    count(*) FILTER (WHERE type = 'VULNERABILITY'),
    count(*) FILTER (WHERE type = 'CODE_SMELL'),
    count(*) FILTER (WHERE type = 'SECURITY_HOTSPOT'),
    coalesce(sum(effort_minutes) FILTER (WHERE type = 'CODE_SMELL'), 0),
    count(*) FILTER (WHERE type = 'BUG' AND severity = 'BLOCKER'),
    count(*) FILTER (WHERE type = 'BUG' AND severity = 'CRITICAL'),
    count(*) FILTER (WHERE type = 'BUG' AND severity = 'MAJOR'),
    count(*) FILTER (WHERE type = 'BUG' AND severity = 'MINOR'),
    count(*) FILTER (WHERE type = 'VULNERABILITY' AND severity = 'BLOCKER'),
    count(*) FILTER (WHERE type = 'VULNERABILITY' AND severity = 'CRITICAL'),
    count(*) FILTER (WHERE type = 'VULNERABILITY' AND severity = 'MAJOR'),
    count(*) FILTER (WHERE type = 'VULNERABILITY' AND severity = 'MINOR')
  INTO
    v_new, v_bugs, v_vulns, v_smells, v_hotspots, v_debt,
    v_bug_blocker, v_bug_critical, v_bug_major, v_bug_minor,
    v_vuln_blocker, v_vuln_critical, v_vuln_major, v_vuln_minor
  FROM inserted;

  -- Gone from the report: fixed, as far as anyone can tell.
  WITH closed AS (
    UPDATE public.issues t
    SET status = 'CLOSED', resolution = 'FIXED', resolved_at = now(), is_new_code = false
    WHERE t.project_id = v_project_id
      AND t.status <> 'CLOSED'
      AND NOT EXISTS (
        SELECT 1 FROM private.reported_issues(p_report) r WHERE r.fingerprint = t.fingerprint
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_closed FROM closed;

  SELECT coalesce(
    (SELECT (m->>'value')::numeric FROM jsonb_array_elements(p_report->'measures') m WHERE m->>'metric' = 'ncloc'),
    0
  ) INTO v_ncloc;

  -- What the leak period actually holds, once there is a baseline. Metrics
  -- that cannot be attributed to new code — duplication, size — are left
  -- unmeasured rather than restated, which is how the gate treats a missing
  -- value anyway.
  IF v_first THEN
    v_new_code := NULL;
  ELSE
    v_new_code := jsonb_build_object(
      'bugs', v_bugs,
      'vulnerabilities', v_vulns,
      'code_smells', v_smells,
      'security_hotspots', v_hotspots,
      'sqale_index', v_debt,
      'reliability_rating',
        private.rating_from_worst_severity(v_bug_blocker, v_bug_critical, v_bug_major, v_bug_minor),
      'security_rating',
        private.rating_from_worst_severity(v_vuln_blocker, v_vuln_critical, v_vuln_major, v_vuln_minor),
      'sqale_rating',
        private.rating_from_debt_ratio(
          CASE WHEN v_ncloc = 0 THEN 0 ELSE v_debt / (v_ncloc * c_dev_cost_per_line) END
        )
    );
  END IF;

  INSERT INTO public.measures (analysis_id, metric, value, new_code_value)
  SELECT
    v_analysis_id,
    m->>'metric',
    (m->>'value')::real,
    CASE
      -- Without a baseline every measure is a new-code measure.
      WHEN v_new_code IS NULL THEN (m->>'newCodeValue')::real
      ELSE (v_new_code->>(m->>'metric'))::real
    END
  FROM jsonb_array_elements(p_report->'measures') m;

  INSERT INTO public.file_measures (
    analysis_id, file_path, language, ncloc, issue_count, effort_minutes, duplicated_lines_density, complexity
  )
  SELECT
    v_analysis_id,
    f->>'path',
    f->>'language',
    coalesce((f->>'ncloc')::int, 0),
    coalesce((f->>'issueCount')::int, 0),
    coalesce((f->>'effortMinutes')::int, 0),
    CASE WHEN coalesce((f->>'lines')::numeric, 0) = 0 THEN 0
         ELSE (coalesce((f->>'duplicatedLines')::numeric, 0) / (f->>'lines')::numeric) * 100 END,
    coalesce((f->>'complexity')::int, 0)
  FROM jsonb_array_elements(p_report->'files') f;

  RETURN jsonb_build_object(
    'projectId', v_project_id,
    'analysisId', v_analysis_id,
    'baselineAnalysisId', v_previous_id,
    'newIssues', v_new,
    'reopenedIssues', v_reopened,
    'closedIssues', v_closed,
    'unchangedIssues', v_unchanged
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_analysis(
  uuid, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, timestamptz, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_analysis(
  uuid, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, timestamptz, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_analysis(
  uuid, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, timestamptz, text, text
) TO authenticated;
