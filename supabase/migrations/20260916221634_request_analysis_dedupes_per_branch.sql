-- "Analyse again" is now per branch, so its de-duplication has to be too.
--
-- The Branches screen offers an Analyse button on every row. With the old
-- check — one in flight per project — pressing it on `develop` while `master`
-- was still running returned master's job id, and the dashboard would sit and
-- watch the wrong analysis finish. Nothing errored; it just quietly did not do
-- what the button said.
--
-- The check also had to move. It ran before the branch was resolved, so it
-- could only compare against p_branch, which is NULL for "whatever the project
-- tracks" while the stored row holds the resolved name. Comparing those two
-- never matched, so after this change it also de-duplicates correctly for the
-- default branch instead of only appearing to.
--
-- Everything else is byte-identical to
-- 20260916115459_request_analysis_inherits_project_source.sql. Verify with a
-- diff before trusting.
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
  v_provider text;
  v_repository_url text;
  v_local_path text;
  v_branch text;
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

  IF p_project_key IS NOT NULL THEN
    -- Where the re-analysis gets its source. Scoped to the organisation, so a
    -- key belonging to another tenant resolves to nothing rather than to their
    -- repository.
    SELECT p.provider::text, p.repository_url, p.local_path, p.main_branch
      INTO v_provider, v_repository_url, v_local_path, v_branch
    FROM public.projects p
    WHERE p.organization_id = p_organization_id AND p.key = p_project_key;
  END IF;

  -- What the caller said wins; the project fills the gaps.
  v_provider       := coalesce(p_provider, v_provider, 'GITHUB');
  v_repository_url := coalesce(p_repository_url, v_repository_url);
  v_local_path     := coalesce(p_local_path, v_local_path);
  v_branch         := coalesce(p_branch, v_branch);

  -- Fail here, where whoever clicked is still watching, rather than three
  -- seconds later inside a worker whose log they cannot see.
  IF v_repository_url IS NULL AND v_local_path IS NULL THEN
    RAISE EXCEPTION 'Nothing to analyse for project %: it has no repository URL or local path', p_project_key
      USING ERRCODE = '22023';
  END IF;

  -- One at a time per project *and branch*: a second request while one is in
  -- flight returns the job already running, which is what double-clicking
  -- should do — but analysing develop while master runs is different work.
  -- Before the vault write below, so a duplicate request never mints a secret
  -- that nothing will ever read.
  IF p_project_key IS NOT NULL THEN
    SELECT id INTO v_job_id
    FROM public.analysis_jobs
    WHERE organization_id = p_organization_id
      AND project_key = p_project_key
      AND branch IS NOT DISTINCT FROM v_branch
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
      'Repository access token for ' || coalesce(p_project_key, v_repository_url, 'a new project')
    );
  END IF;

  INSERT INTO public.analysis_jobs (
    organization_id, project_key, project_name, provider, repository_url, local_path,
    branch, requested_by, trigger, access_token_id
  )
  VALUES (
    p_organization_id, p_project_key, p_project_name,
    v_provider::public.repository_provider, v_repository_url, v_local_path,
    v_branch, auth.uid(), coalesce(p_trigger, 'MANUAL')::public.analysis_trigger, v_secret_id
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;
