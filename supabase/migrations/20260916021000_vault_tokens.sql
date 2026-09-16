-- Repository tokens move into Supabase Vault.
--
-- They used to be encrypted by the app, with AES-256-GCM and a key from
-- CODE_QUALITY_SECRET. That worked while a server action was the only thing
-- that ever handled one. It stops working the moment the browser is what asks
-- for an analysis: there is nowhere in a browser to keep a key.
--
-- Vault is the answer that removes a moving part instead of adding one. The
-- token travels once, over TLS, to a function that hands it straight to
-- `vault.create_secret`; the database holds the ciphertext and the key, and the
-- row keeps only an id. The app no longer has a secret to manage, and
-- CODE_QUALITY_SECRET goes away entirely.
--
-- The table is empty, so there is nothing to migrate: the old column is simply
-- dropped.
ALTER TABLE public.projects DROP COLUMN access_token;
ALTER TABLE public.projects ADD COLUMN access_token_id uuid;

COMMENT ON COLUMN public.projects.access_token_id IS
  'vault.secrets id for the repository access token. Never the token itself.';

ALTER TABLE public.analysis_jobs ADD COLUMN access_token_id uuid;

-- The readable column list changes with the schema, so it is restated. Note
-- access_token_id is NOT in it: an id is useless without the vault, but there
-- is no reason to hand it out either.
REVOKE SELECT ON public.projects FROM authenticated;
GRANT SELECT (
  id, organization_id, key, name, provider, repository_url, local_path,
  main_branch, analyze_on_push, quality_gate_id, created_at, last_analyzed_at
) ON public.projects TO authenticated;

REVOKE SELECT ON public.analysis_jobs FROM authenticated;
GRANT SELECT (
  id, organization_id, project_key, project_name, provider, repository_url, local_path,
  branch, requested_by, trigger, status, attempts, error, analysis_id,
  created_at, started_at, finished_at
) ON public.analysis_jobs TO authenticated;

-- Asking for an analysis, now able to carry a token for a private repository.
DROP FUNCTION IF EXISTS public.request_analysis(uuid, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.request_analysis(
  p_organization_id uuid,
  p_provider text DEFAULT 'GITHUB',
  p_repository_url text DEFAULT NULL,
  p_local_path text DEFAULT NULL,
  p_project_key text DEFAULT NULL,
  p_project_name text DEFAULT NULL,
  p_branch text DEFAULT NULL,
  p_trigger text DEFAULT 'MANUAL',
  -- Plaintext, and it stays plaintext for exactly as long as this function
  -- runs. It is never stored, logged or returned.
  p_access_token text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_secret_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of organisation %', p_organization_id USING ERRCODE = '42501';
  END IF;

  IF p_repository_url IS NULL AND p_local_path IS NULL AND p_project_key IS NULL THEN
    RAISE EXCEPTION 'Nothing to analyse: give a repository URL, a path, or an existing project key'
      USING ERRCODE = '22023';
  END IF;

  -- One at a time per project: a second request while one is in flight returns
  -- the job already running, which is what double-clicking should do.
  IF p_project_key IS NOT NULL THEN
    SELECT id INTO v_job_id
    FROM public.analysis_jobs
    WHERE organization_id = p_organization_id
      AND project_key = p_project_key
      AND status IN ('QUEUED', 'RUNNING')
    ORDER BY created_at
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      RETURN v_job_id;
    END IF;
  END IF;

  IF nullif(btrim(coalesce(p_access_token, '')), '') IS NOT NULL THEN
    v_secret_id := vault.create_secret(
      p_access_token,
      'repo_token_' || replace(gen_random_uuid()::text, '-', ''),
      'Repository access token for ' || coalesce(p_project_key, p_repository_url, 'a new project')
    );
  END IF;

  INSERT INTO public.analysis_jobs (
    organization_id, project_key, project_name, provider, repository_url, local_path,
    branch, requested_by, trigger, access_token_id
  )
  VALUES (
    p_organization_id, p_project_key, p_project_name,
    coalesce(p_provider, 'GITHUB')::public.repository_provider, p_repository_url, p_local_path,
    p_branch, auth.uid(), coalesce(p_trigger, 'MANUAL')::public.analysis_trigger, v_secret_id
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_analysis(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_analysis(uuid, text, text, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_analysis(uuid, text, text, text, text, text, text, text, text) TO authenticated;

-- The worker's view of a job: everything needed to do the work, including the
-- token in the clear, because cloning a private repository needs it. Service
-- role only, and it is the only way the plaintext ever comes back out.
CREATE OR REPLACE FUNCTION public.claim_analysis_job()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.analysis_jobs%ROWTYPE;
  v_token text;
  v_token_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a worker may claim jobs' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM public.analysis_jobs
  WHERE status = 'QUEUED'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.analysis_jobs
  SET status = 'RUNNING', started_at = now(), attempts = attempts + 1
  WHERE id = v_job.id;

  -- The job's own token if it brought one; otherwise the one the project was
  -- connected with, which is the re-analysis case.
  v_token_id := v_job.access_token_id;
  IF v_token_id IS NULL AND v_job.project_key IS NOT NULL THEN
    SELECT access_token_id INTO v_token_id
    FROM public.projects
    WHERE organization_id = v_job.organization_id AND key = v_job.project_key;
  END IF;

  IF v_token_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id = v_token_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_job.id,
    'organizationId', v_job.organization_id,
    'projectKey', v_job.project_key,
    'projectName', v_job.project_name,
    'provider', v_job.provider,
    'repositoryUrl', v_job.repository_url,
    'localPath', v_job.local_path,
    'branch', v_job.branch,
    'trigger', v_job.trigger,
    'attempts', v_job.attempts + 1,
    'accessTokenId', v_token_id,
    'accessToken', v_token
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_analysis_job() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_analysis_job() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_analysis_job() FROM authenticated;

-- import_analysis now stores a vault id rather than a ciphertext, so its
-- signature changes and the old one goes.
DROP FUNCTION IF EXISTS public.import_analysis(
  uuid, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, timestamptz, text, text
);

-- project_credentials returned the ciphertext to any member so the app could
-- decrypt it. Nothing decrypts in the app any more, and no member has a reason
-- to hold a token: it is gone.
DROP FUNCTION IF EXISTS public.project_credentials(uuid);

-- Recreated with the new parameter. The body is unchanged.
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
  -- A vault.secrets id, not a token. The plaintext went into the vault in
  -- request_analysis and never comes back out on this path.
  p_access_token_id uuid DEFAULT NULL,
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
    access_token_id, main_branch, quality_gate_id, last_analyzed_at
  )
  VALUES (
    p_organization_id, p_project_key, coalesce(p_project_name, p_project_key),
    coalesce(p_provider, 'LOCAL')::public.repository_provider, p_repository_url, p_local_path,
    p_access_token_id, coalesce(p_branch, 'main'), v_gate_id, now()
  )
  ON CONFLICT (organization_id, key) DO UPDATE SET
    name = coalesce(p_project_name, public.projects.name),
    last_analyzed_at = now(),
    provider = coalesce(p_provider::public.repository_provider, public.projects.provider),
    repository_url = coalesce(p_repository_url, public.projects.repository_url),
    local_path = coalesce(p_local_path, public.projects.local_path),
    access_token_id = coalesce(p_access_token_id, public.projects.access_token_id),
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
  uuid, text, jsonb, jsonb, text, text, text, text, uuid, text, text, text, text, timestamptz, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_analysis(
  uuid, text, jsonb, jsonb, text, text, text, text, uuid, text, text, text, text, timestamptz, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_analysis(
  uuid, text, jsonb, jsonb, text, text, text, text, uuid, text, text, text, text, timestamptz, text, text
) TO authenticated;
