-- The analysis queue.
--
-- Connecting a repository used to clone it and run tree-sitter over it inside a
-- server action, while the browser waited. That is fine for your own laptop and
-- indefensible hosted: it runs a stranger's code on the app server, holds a
-- request open for as long as the scan takes, and has no way to say "one at a
-- time". So the request and the work are separated. Asking for an analysis is
-- an insert; doing it is a worker's problem.
--
-- A job describes work for a project that may not exist yet — connecting a new
-- repository is the common case — which is why this is its own table rather
-- than a row in `analyses`. The analysis row is created by `import_analysis`
-- when the work succeeds, and the job points at it afterwards.

CREATE TYPE public.analysis_job_status AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE public.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- What to analyse. `project_key` is null when it should be derived from the
  -- remote, which is what happens on a first connection.
  project_key text,
  project_name text,
  provider public.repository_provider NOT NULL DEFAULT 'GITHUB',
  repository_url text,
  local_path text,
  branch text,

  -- Who asked, and why.
  requested_by uuid,
  trigger public.analysis_trigger NOT NULL DEFAULT 'MANUAL',

  -- Lifecycle.
  status public.analysis_job_status NOT NULL DEFAULT 'QUEUED',
  attempts int NOT NULL DEFAULT 0,
  error text,
  analysis_id uuid REFERENCES public.analyses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
) ;

ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

-- The worker claims the oldest waiting job; this is the index that makes that
-- cheap once the table has history in it.
CREATE INDEX analysis_jobs_queue_idx ON public.analysis_jobs (status, created_at)
  WHERE status = 'QUEUED';
CREATE INDEX analysis_jobs_org_created_idx ON public.analysis_jobs (organization_id, created_at DESC);

-- Members watch their own jobs — that is how the UI knows an analysis finished.
-- Nobody writes through the API: every transition goes through a function below.
CREATE POLICY "members read their analysis jobs" ON public.analysis_jobs
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

REVOKE INSERT, UPDATE, DELETE ON public.analysis_jobs FROM authenticated;
REVOKE ALL ON public.analysis_jobs FROM anon;

-- Asking for an analysis. This is all the browser does; it returns immediately.
CREATE OR REPLACE FUNCTION public.request_analysis(
  p_organization_id uuid,
  p_provider text DEFAULT 'GITHUB',
  p_repository_url text DEFAULT NULL,
  p_local_path text DEFAULT NULL,
  p_project_key text DEFAULT NULL,
  p_project_name text DEFAULT NULL,
  p_branch text DEFAULT NULL,
  p_trigger text DEFAULT 'MANUAL'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
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

  -- One at a time per project. A second request while one is in flight returns
  -- the job already running rather than queueing a duplicate scan of the same
  -- commit, which is what double-clicking "Analyse again" would otherwise do.
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

  INSERT INTO public.analysis_jobs (
    organization_id, project_key, project_name, provider, repository_url, local_path,
    branch, requested_by, trigger
  )
  VALUES (
    p_organization_id, p_project_key, p_project_name,
    coalesce(p_provider, 'GITHUB')::public.repository_provider, p_repository_url, p_local_path,
    p_branch, auth.uid(), coalesce(p_trigger, 'MANUAL')::public.analysis_trigger
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_analysis(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_analysis(uuid, text, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_analysis(uuid, text, text, text, text, text, text, text) TO authenticated;

-- Claiming work.
--
-- FOR UPDATE SKIP LOCKED is what makes more than one worker safe: each
-- transaction takes a row nobody else has locked and steps over the rest,
-- rather than queueing behind them. Two workers never get the same job.
CREATE OR REPLACE FUNCTION public.claim_analysis_job()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.analysis_jobs%ROWTYPE;
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
    'attempts', v_job.attempts + 1
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_analysis_job() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_analysis_job() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_analysis_job() FROM authenticated;

CREATE OR REPLACE FUNCTION public.finish_analysis_job(
  p_job_id uuid,
  p_analysis_id uuid DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a worker may finish jobs' USING ERRCODE = '42501';
  END IF;

  UPDATE public.analysis_jobs
  SET status = CASE WHEN p_error IS NULL THEN 'SUCCEEDED'::public.analysis_job_status
                    ELSE 'FAILED'::public.analysis_job_status END,
      -- Truncated: a stack trace from a failed clone can be enormous, and the
      -- UI shows this to whoever asked for the analysis.
      error = left(p_error, 2000),
      analysis_id = p_analysis_id,
      finished_at = now()
  WHERE id = p_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_analysis_job(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finish_analysis_job(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finish_analysis_job(uuid, uuid, text) FROM authenticated;

GRANT SELECT ON public.analysis_jobs TO authenticated;
