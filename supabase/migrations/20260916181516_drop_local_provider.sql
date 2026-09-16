-- LOCAL is gone from repository_provider.
--
-- ADR-0006 in the vault: we clone, analyse and display, so "a path on this
-- machine" has no meaning in the product -- and on a hosted server it means a
-- path on the worker's box, which is reachable and wrong. There were zero
-- LOCAL rows in projects and in analysis_jobs when this ran, so no data is
-- migrated; the value is simply removed from the type.
--
-- Two defaults were still minting LOCAL rows and both are fixed here:
--   * projects.provider DEFAULT 'LOCAL'
--   * import_analysis's coalesce(p_provider, 'LOCAL'), which is the path the
--     CLI publisher takes -- @code-quality/publish sends no provider at all.
-- OTHER is the honest value for a report published from a CLI: we do not know
-- the forge, and guessing GITHUB would be a lie in the column that says where
-- the code came from.
--
-- projects.local_path stays as a dead, always-NULL column. Dropping it would
-- change the signatures of import_analysis and request_analysis, which is a
-- separate change with its own blast radius.

ALTER TYPE public.repository_provider RENAME TO repository_provider__old;

CREATE TYPE public.repository_provider AS ENUM ('GITHUB', 'GITLAB', 'OTHER');

ALTER TABLE public.projects      ALTER COLUMN provider DROP DEFAULT;
ALTER TABLE public.analysis_jobs ALTER COLUMN provider DROP DEFAULT;

ALTER TABLE public.projects
  ALTER COLUMN provider TYPE public.repository_provider
  USING provider::text::public.repository_provider;

ALTER TABLE public.analysis_jobs
  ALTER COLUMN provider TYPE public.repository_provider
  USING provider::text::public.repository_provider;

ALTER TABLE public.projects      ALTER COLUMN provider SET DEFAULT 'OTHER';
ALTER TABLE public.analysis_jobs ALTER COLUMN provider SET DEFAULT 'GITHUB';

DROP TYPE public.repository_provider__old;

-- import_analysis is 400 lines and exactly one token of it changes, so this
-- edits the live definition instead of restating the whole function: a copy
-- can drift from the original, a textual replacement cannot. It raises rather
-- than silently doing nothing if the text it expects is not there.
DO $rewrite$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'import_analysis';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.import_analysis does not exist';
  END IF;

  v_new := replace(v_def, 'coalesce(p_provider, ''LOCAL'')', 'coalesce(p_provider, ''OTHER'')');

  IF v_new = v_def THEN
    RAISE EXCEPTION 'import_analysis does not contain the LOCAL default this migration expects';
  END IF;

  EXECUTE v_new;
END
$rewrite$;
