-- Leases, retry with backoff, and per-organisation fairness for the queue.
--
-- Closes four defects that were all the same shape: the queue trusted the
-- worker to be alive, to succeed, and to be the only tenant.
--
--   #7 a job whose worker died stayed RUNNING for ever
--   #8 attempts was incremented on every claim and never read
--   #9 claiming was global FIFO, so one tenant could starve the rest
--   #11 nothing bounded a single job
--
-- No new enum value. A dead-lettered job is FAILED with attempts >= the cap,
-- which is derivable and avoids ALTER TYPE inside a migration transaction.

ALTER TABLE public.analysis_jobs
  -- When the current holder claim expires. NULL whenever the job is not
  -- RUNNING, so a stranded row is visible as RUNNING with a lease in the past.
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  -- Diagnostics only. Hostname and pid of whoever claimed it; never identity,
  -- because a worker that lies about this changes nothing about what it may do.
  ADD COLUMN IF NOT EXISTS locked_by text,
  -- The backoff gate. A job is invisible to claiming until this passes, which
  -- is how a failed job waits before its retry.
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.analysis_jobs.locked_until IS
  'Lease expiry. A RUNNING row past this has lost its worker and is reclaimable.';
COMMENT ON COLUMN public.analysis_jobs.next_attempt_at IS
  'Claiming ignores the row until this passes. Set into the future on each retry.';

-- Claiming filters on these two and orders by the third.
CREATE INDEX IF NOT EXISTS analysis_jobs_claimable_idx
  ON public.analysis_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS analysis_jobs_org_started_idx
  ON public.analysis_jobs (organization_id, started_at DESC);

-- The signature changes, and in Postgres that would create an overload rather
-- than replace anything: the old zero-argument version would stay callable,
-- with none of the fairness or the lease. It has to go first.
DROP FUNCTION IF EXISTS public.claim_analysis_job();

CREATE FUNCTION public.claim_analysis_job(
  p_worker_id text DEFAULT NULL,
  p_lease_seconds int DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.analysis_jobs%ROWTYPE;
  v_token text;
  v_token_id uuid;
  v_lease int := greatest(30, coalesce(p_lease_seconds, 300));
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a worker may claim jobs' USING ERRCODE = '42501';
  END IF;

  -- Fairness before age. Ordering by created_at alone lets one organisation
  -- that queues fifty repositories hold the queue against everyone behind it;
  -- ordering by "whose turn has it been longest" makes the wait proportional to
  -- tenants rather than to the biggest tenant. Within an organisation it is
  -- still first-come.
  --
  -- An organisation that has never had a job sorts to -infinity, so a new
  -- tenant is served before a busy one rather than behind its backlog.
  SELECT * INTO v_job
  FROM public.analysis_jobs j
  WHERE j.status = 'QUEUED'
    AND j.next_attempt_at <= now()
  ORDER BY
    coalesce(
      (SELECT max(j2.started_at) FROM public.analysis_jobs j2
       WHERE j2.organization_id = j.organization_id),
      '-infinity'::timestamptz
    ),
    j.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.analysis_jobs
  SET status = 'RUNNING',
      started_at = now(),
      attempts = attempts + 1,
      locked_until = now() + make_interval(secs => v_lease),
      locked_by = left(coalesce(p_worker_id, 'unknown'), 200)
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
    'accessToken', v_token,
    'leaseSeconds', v_lease
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_analysis_job(text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_analysis_job(text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_analysis_job(text, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_job(text, int) TO service_role;

-- Extends the lease while the work is still going. Returns false when the job
-- is no longer the caller's to extend — another worker has already reclaimed
-- it — which is the worker's signal to abandon the job rather than finish it
-- and overwrite whatever the new holder is doing.
CREATE OR REPLACE FUNCTION public.heartbeat_analysis_job(
  p_job_id uuid,
  p_lease_seconds int DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease int := greatest(30, coalesce(p_lease_seconds, 300));
  v_rows int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a worker may heartbeat jobs' USING ERRCODE = '42501';
  END IF;

  UPDATE public.analysis_jobs
  SET locked_until = now() + make_interval(secs => v_lease)
  WHERE id = p_job_id AND status = 'RUNNING';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat_analysis_job(uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.heartbeat_analysis_job(uuid, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.heartbeat_analysis_job(uuid, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_analysis_job(uuid, int) TO service_role;

-- Jobs whose worker stopped heartbeating. Re-queued with backoff while they
-- have attempts left, dead-lettered when they do not.
--
-- There is no scheduler in this project, so the worker calls this on its own
-- poll. That is deliberate rather than a stopgap: a sweeper that only runs
-- while a worker is alive is exactly as available as the thing it is repairing,
-- and it costs one indexed query every few seconds.
CREATE OR REPLACE FUNCTION public.reclaim_stranded_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_attempts CONSTANT int := 3;
  v_rows int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a worker may reclaim jobs' USING ERRCODE = '42501';
  END IF;

  WITH stranded AS (
    UPDATE public.analysis_jobs
    SET status = CASE WHEN attempts >= c_max_attempts THEN 'FAILED'::public.analysis_job_status
                      ELSE 'QUEUED'::public.analysis_job_status END,
        -- Exponential, from the attempt already spent: 1, 2, then 4 minutes. A
        -- worker that died on a repository will probably die on it again, and
        -- retrying immediately just burns the remaining attempts in a second.
        next_attempt_at = now() + make_interval(mins => power(2, greatest(0, attempts - 1))::int),
        locked_until = NULL,
        locked_by = NULL,
        error = CASE
          WHEN attempts >= c_max_attempts
            THEN left('Abandoned after ' || attempts || ' attempts: the worker stopped responding each time.', 2000)
          ELSE error END,
        finished_at = CASE WHEN attempts >= c_max_attempts THEN now() ELSE NULL END
    WHERE status = 'RUNNING'
      AND locked_until IS NOT NULL
      AND locked_until < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM stranded;

  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reclaim_stranded_jobs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reclaim_stranded_jobs() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reclaim_stranded_jobs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stranded_jobs() TO service_role;

-- Same signature as before, so the worker call site does not change and the
-- existing grants survive. What changed is that a failure is no longer always
-- terminal: while the job has attempts left it goes back to QUEUED behind a
-- backoff, and only the last one is recorded as FAILED.
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
DECLARE
  c_max_attempts CONSTANT int := 3;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a worker may finish jobs' USING ERRCODE = '42501';
  END IF;

  UPDATE public.analysis_jobs
  SET status = CASE
        WHEN p_error IS NULL THEN 'SUCCEEDED'::public.analysis_job_status
        WHEN attempts < c_max_attempts THEN 'QUEUED'::public.analysis_job_status
        ELSE 'FAILED'::public.analysis_job_status END,
      -- Truncated: a stack trace from a failed clone can be enormous, and the
      -- UI shows this to whoever asked for the analysis. Kept on a retry too,
      -- so a job waiting to run again still says why it is waiting.
      error = left(p_error, 2000),
      analysis_id = p_analysis_id,
      next_attempt_at = CASE
        WHEN p_error IS NULL THEN next_attempt_at
        ELSE now() + make_interval(mins => power(2, greatest(0, attempts - 1))::int) END,
      -- The lease is released either way: the work is over, whoever picks the
      -- retry up starts a new one.
      locked_until = NULL,
      locked_by = NULL,
      -- A job going back in the queue has not finished, and saying it did
      -- would make it look resolved in every view that reads this column.
      finished_at = CASE
        WHEN p_error IS NOT NULL AND attempts < c_max_attempts THEN NULL
        ELSE now() END
  WHERE id = p_job_id;
END;
$$;
