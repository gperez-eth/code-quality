-- "Analyse again" sends only the project key — the button has nothing else to
-- send — and this function never resolved the rest, so the job reached the
-- worker with no repository URL and died there with "A remote job needs a
-- repository URL". Every re-analysis of a remote project failed this way.
--
-- Two changes: inherit the source from the project when the caller did not
-- give one, and refuse at the door instead of queueing work that cannot run.
-- Credentials need no handling here: claim_analysis_job already falls back to
-- the project's access_token_id when the job has none.
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
