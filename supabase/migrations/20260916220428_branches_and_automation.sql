-- Branches as a first-class thing, and configurable automatic analysis.
--
-- Two gaps this closes. The dashboard had no idea which branches a repository
-- has — only which one the last analysis happened to run on — so there was
-- nothing to switch between. And `analyze_on_push` was a bare boolean whose
-- only rule was "the branch equals projects.main_branch", which cannot express
-- "master and develop", "every release branch", or "any branch somebody just
-- created".
--
-- Nothing here writes to `analyses`. The per-branch verdict comes from a view
-- over the analyses that already exist, so `import_analysis` is untouched.

-- Branches we have seen in the repository.
--
-- Refreshed by the worker on every clone, because it already has the checkout
-- and `git for-each-ref` is free at that point. This is deliberately a cache of
-- what the remote had, not a source of truth: the repository is.
CREATE TABLE IF NOT EXISTS public.project_branches (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- The repository's own default branch, as origin/HEAD reports it.
  is_default boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, name)
);

COMMENT ON TABLE public.project_branches IS
  'Branches seen in the repository, refreshed by the worker on every clone. A cache of the remote, not a source of truth.';

CREATE INDEX IF NOT EXISTS project_branches_project_idx
  ON public.project_branches (project_id, last_seen_at DESC);

ALTER TABLE public.project_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches are readable by their organisation"
  ON public.project_branches FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      WHERE p.organization_id IN (SELECT private.user_organization_ids())
    )
  );

REVOKE ALL ON public.project_branches FROM anon;
GRANT SELECT ON public.project_branches TO authenticated;

-- When to analyse, per project.
ALTER TABLE public.projects
  -- Glob patterns. A push to a branch matching any of these is analysed.
  -- "A merge into develop" is a push to develop, so this covers merges too.
  ADD COLUMN IF NOT EXISTS analyze_branch_patterns text[] NOT NULL DEFAULT ARRAY['master', 'main', 'develop'],
  -- The push that creates a branch gets one analysis, so a new feature branch
  -- has a baseline from its first commit instead of from whenever someone
  -- remembers to press the button.
  ADD COLUMN IF NOT EXISTS analyze_on_new_branch boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.projects.analyze_branch_patterns IS
  'Glob patterns; * matches anything. A push to a matching branch is analysed when analyze_on_push is true.';
COMMENT ON COLUMN public.projects.analyze_on_new_branch IS
  'Analyse the push that creates a branch, whether or not the branch matches analyze_branch_patterns.';

-- Glob matching, defined once.
--
-- The UI wants to preview which branches a pattern set matches, and the webhook
-- has to decide the same question for real. Two implementations of "does this
-- glob match" would drift, and the one that drifts silently is the one that
-- decides whether a customer's push gets analysed — so this is the definition
-- and the dashboard calls it rather than reimplementing it in TypeScript.
--
-- `^` is the LIKE escape character because git refuses it in a ref name, so it
-- can never appear in a branch and needs no special case. That also avoids
-- writing a backslash into a SQL string, which this repository has been bitten
-- by more than once.
CREATE OR REPLACE FUNCTION public.branch_matches(p_branch text, p_patterns text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_pattern text;
  v_like text;
BEGIN
  IF p_branch IS NULL OR p_patterns IS NULL THEN
    RETURN false;
  END IF;

  FOREACH v_pattern IN ARRAY p_patterns LOOP
    -- Escape the escape first, then LIKE's own wildcards, and only then turn
    -- the glob star into one. Any other order escapes the wildcard we just
    -- introduced and the pattern matches nothing.
    v_like := replace(v_pattern, '^', '^^');
    v_like := replace(v_like, '%', '^%');
    v_like := replace(v_like, '_', '^_');
    v_like := replace(v_like, '*', '%');

    IF p_branch LIKE v_like ESCAPE '^' THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.branch_matches(text, text[]) TO authenticated, service_role;

-- The newest analysis of each branch of each project.
--
-- Same shape as project_latest_analysis, one level finer. It is what the
-- Branches table reads: a row per branch with the gate it last got.
CREATE OR REPLACE VIEW public.project_branch_latest_analysis
WITH (security_invoker = on) AS
SELECT DISTINCT ON (a.project_id, a.branch)
  a.project_id,
  a.branch,
  a.id AS analysis_id,
  a.status,
  a.gate_status,
  a.started_at,
  a.finished_at,
  a.commit_sha,
  a.commit_message
FROM public.analyses a
ORDER BY a.project_id, a.branch, a.started_at DESC;

COMMENT ON VIEW public.project_branch_latest_analysis IS
  'The newest analysis per branch per project, whatever state it ended in.';

GRANT SELECT ON public.project_branch_latest_analysis TO authenticated;

-- What the worker reports after a clone.
--
-- Replaces the whole set rather than merging: a branch deleted on the remote
-- should disappear here too, and the clone is the authority on what exists.
-- Rows that survive keep their first_seen_at, which is what makes "new branch"
-- meaningful in the UI.
CREATE OR REPLACE FUNCTION public.record_project_branches(
  p_project_id uuid,
  p_branches text[],
  p_default_branch text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a worker may record branches' USING ERRCODE = '42501';
  END IF;

  IF p_branches IS NULL OR array_length(p_branches, 1) IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.project_branches (project_id, name, is_default)
  SELECT p_project_id, b, b IS NOT DISTINCT FROM p_default_branch
  FROM unnest(p_branches) AS b
  ON CONFLICT (project_id, name) DO UPDATE SET
    last_seen_at = now(),
    is_default = excluded.is_default;

  DELETE FROM public.project_branches
  WHERE project_id = p_project_id AND name <> ALL (p_branches);

  SELECT count(*) INTO v_count FROM public.project_branches WHERE project_id = p_project_id;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_project_branches(uuid, text[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_project_branches(uuid, text[], text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_project_branches(uuid, text[], text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_project_branches(uuid, text[], text) TO service_role;

-- Saving the automation settings from the dashboard.
CREATE OR REPLACE FUNCTION public.set_analysis_automation(
  p_project_id uuid,
  p_analyze_on_push boolean,
  p_branch_patterns text[],
  p_analyze_on_new_branch boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_clean text[];
BEGIN
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No such project' USING ERRCODE = '42704';
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' AND NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = v_org AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of that organisation' USING ERRCODE = '42501';
  END IF;

  -- Trim, drop blanks, de-duplicate. A pattern list with an empty string in it
  -- matches nothing and looks like a bug in the matcher rather than a typo in
  -- the form.
  SELECT coalesce(array_agg(DISTINCT trimmed), ARRAY[]::text[]) INTO v_clean
  FROM (SELECT btrim(unnest(coalesce(p_branch_patterns, ARRAY[]::text[]))) AS trimmed) s
  WHERE trimmed <> '';

  UPDATE public.projects
  SET analyze_on_push = coalesce(p_analyze_on_push, analyze_on_push),
      analyze_branch_patterns = v_clean,
      analyze_on_new_branch = coalesce(p_analyze_on_new_branch, analyze_on_new_branch)
  WHERE id = p_project_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_analysis_automation(uuid, boolean, text[], boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_analysis_automation(uuid, boolean, text[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_analysis_automation(uuid, boolean, text[], boolean) TO authenticated, service_role;

-- queue_push_analysis, now pattern-driven and branch-aware.
--
-- Three changes from 20260916172940_github_app_installations.sql:
--   * the branch test is branch_matches against analyze_branch_patterns
--     instead of equality with main_branch;
--   * a push that created the branch is analysed when analyze_on_new_branch is
--     set, whether or not it matches a pattern;
--   * de-duplication is per branch rather than per project, because a push to
--     develop should not be swallowed because master is still analysing.
CREATE OR REPLACE FUNCTION public.queue_push_analysis(
  p_installation_id bigint,
  p_repository_full_name text,
  p_branch text,
  p_commit_sha text DEFAULT NULL,
  p_branch_created boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_project public.projects%ROWTYPE;
  v_job_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the webhook receiver may queue push analyses' USING ERRCODE = '42501';
  END IF;

  -- A suspended installation is still an installation. It must not clone.
  SELECT organization_id INTO v_org_id
  FROM public.github_installations
  WHERE id = p_installation_id AND suspended_at IS NULL;

  IF v_org_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Projects store the remote as a full URL; the payload carries owner/repo.
  -- Matching on the tail rather than parsing every URL shape keeps SSH, HTTPS
  -- and a trailing .git all working without a second opinion about URLs, which
  -- @code-quality/git already owns.
  SELECT * INTO v_project
  FROM public.projects p
  WHERE p.organization_id = v_org_id
    AND p.repository_url IS NOT NULL
    AND (
      p.repository_url ILIKE '%/' || p_repository_full_name
      OR p.repository_url ILIKE '%/' || p_repository_full_name || '.git'
      OR p.repository_url ILIKE '%:' || p_repository_full_name
      OR p.repository_url ILIKE '%:' || p_repository_full_name || '.git'
    )
  ORDER BY p.created_at
  LIMIT 1;

  IF v_project.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Remember the branch even when we are not going to analyse it: the switcher
  -- should list what the repository has, not only what we happen to have run.
  INSERT INTO public.project_branches (project_id, name)
  VALUES (v_project.id, p_branch)
  ON CONFLICT (project_id, name) DO UPDATE SET last_seen_at = now();

  IF NOT v_project.analyze_on_push THEN
    RETURN NULL;
  END IF;

  IF NOT (
    (coalesce(p_branch_created, false) AND v_project.analyze_on_new_branch)
    OR public.branch_matches(p_branch, v_project.analyze_branch_patterns)
  ) THEN
    RETURN NULL;
  END IF;

  -- One in flight per branch. A branch pushed three times in a minute should
  -- not queue three clones of itself, but master and develop are separate work.
  SELECT id INTO v_job_id
  FROM public.analysis_jobs
  WHERE organization_id = v_org_id
    AND project_key = v_project.key
    AND branch IS NOT DISTINCT FROM p_branch
    AND status IN ('QUEUED', 'RUNNING')
  ORDER BY created_at
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    RETURN v_job_id;
  END IF;

  INSERT INTO public.analysis_jobs (
    organization_id, project_key, project_name, provider, repository_url,
    branch, trigger
  )
  VALUES (
    v_org_id, v_project.key, v_project.name, v_project.provider,
    v_project.repository_url, p_branch, 'PUSH'
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_push_analysis(bigint, text, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.queue_push_analysis(bigint, text, text, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.queue_push_analysis(bigint, text, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.queue_push_analysis(bigint, text, text, text, boolean) TO service_role;

-- The old four-argument signature would otherwise linger and keep being chosen
-- by the webhook, which passes four arguments today.
DROP FUNCTION IF EXISTS public.queue_push_analysis(bigint, text, text, text);

-- handle_github_event has to start passing the `created` flag, or
-- analyze_on_new_branch can never fire: a push that creates a branch is an
-- ordinary push payload with `created: true`, and nothing else distinguishes it.
--
-- One call site changes, so this edits the live definition rather than
-- restating two hundred lines that a copy could get subtly wrong. It raises if
-- the text it expects is not there, so a silent no-op is impossible.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_old_call text;
  v_new_call text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'handle_github_event';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.handle_github_event does not exist';
  END IF;

  v_old_call := 'v_branch,' || chr(10) || '      v_payload->>''after''' || chr(10) || '    );';
  v_new_call := 'v_branch,' || chr(10) || '      v_payload->>''after'',' || chr(10)
             || '      coalesce((v_payload->>''created'')::boolean, false)' || chr(10) || '    );';

  v_new := replace(v_def, v_old_call, v_new_call);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'handle_github_event does not contain the queue_push_analysis call this migration expects';
  END IF;

  EXECUTE v_new;
END
$patch$;
