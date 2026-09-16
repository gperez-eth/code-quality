-- GitHub App installations, and the push trigger they make possible.
--
-- Part of #12. Until now a private repository meant pasting a personal access
-- token into a form, and `projects.webhook_secret` / `projects.analyze_on_push`
-- existed with no route to feed them.
--
-- A GitHub App changes the shape of the secret: the webhook secret belongs to
-- the **app**, not to each project, so `projects.webhook_secret` is vestigial
-- on this path and is left alone rather than repurposed. The app's secret lives
-- in Vault like every other secret here.

CREATE TABLE IF NOT EXISTS public.github_installations (
  -- GitHub's own installation id, which is what every webhook payload carries.
  -- Not a surrogate key: there is exactly one row per installation and GitHub
  -- is the authority on its identity.
  id bigint PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The GitHub account that installed it, for showing "installed on acme" in
  -- the UI without another API call.
  account_login text NOT NULL,
  account_type text,
  installed_at timestamptz NOT NULL DEFAULT now(),
  -- GitHub keeps an installation that has been suspended, so it is a state
  -- rather than a deletion. A suspended installation must not be used to clone.
  suspended_at timestamptz
);

COMMENT ON TABLE public.github_installations IS
  'One row per GitHub App installation, keyed by GitHub''s installation id. Maps an installation to the organisation whose member installed it.';

CREATE INDEX IF NOT EXISTS github_installations_org_idx
  ON public.github_installations (organization_id);

ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;

-- Readable by the organisation it belongs to, and by nobody else. Writes go
-- through SECURITY DEFINER functions, as everywhere else in this schema.
CREATE POLICY "installations are readable by their organisation"
  ON public.github_installations FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

REVOKE ALL ON public.github_installations FROM anon;
GRANT SELECT ON public.github_installations TO authenticated;

-- The app's webhook secret, read by the webhook receiver and by nothing else.
-- Stored in Vault under a fixed name so there is one place to rotate it.
CREATE OR REPLACE FUNCTION private.github_webhook_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, vault
AS $$
DECLARE
  v_secret text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the webhook receiver may read the app secret' USING ERRCODE = '42501';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'github_app_webhook_secret';

  RETURN v_secret;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.github_webhook_secret() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.github_webhook_secret() TO service_role;

-- What a verified push event turns into.
--
-- The webhook receiver has already checked the signature; this decides whether
-- there is anything to analyse and queues it. Returning NULL rather than
-- raising is deliberate: a push to a repository nobody connected, or to a
-- branch the project does not track, is an ordinary event and not an error.
CREATE OR REPLACE FUNCTION public.queue_push_analysis(
  p_installation_id bigint,
  p_repository_full_name text,
  p_branch text,
  p_commit_sha text DEFAULT NULL
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
    AND p.analyze_on_push
    AND p.repository_url IS NOT NULL
    AND (
      p.repository_url ILIKE '%/' || p_repository_full_name
      OR p.repository_url ILIKE '%/' || p_repository_full_name || '.git'
      OR p.repository_url ILIKE '%:' || p_repository_full_name
      OR p.repository_url ILIKE '%:' || p_repository_full_name || '.git'
    )
    -- A push to a branch the project does not track is not this project's news.
    AND (p.main_branch IS NULL OR p.main_branch = p_branch)
  ORDER BY p.created_at
  LIMIT 1;

  IF v_project.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- One in flight at a time, the same rule request_analysis follows: a branch
  -- pushed three times in a minute should not queue three clones of it.
  SELECT id INTO v_job_id
  FROM public.analysis_jobs
  WHERE organization_id = v_org_id
    AND project_key = v_project.key
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

REVOKE EXECUTE ON FUNCTION public.queue_push_analysis(bigint, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.queue_push_analysis(bigint, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.queue_push_analysis(bigint, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.queue_push_analysis(bigint, text, text, text) TO service_role;
