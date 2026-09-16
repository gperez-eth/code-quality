-- Give the per-branch view the same columns as the per-project one.
--
-- `toAnalysisSummary` in apps/web reads commit_author, version and
-- baseline_analysis_id, and without them the branch switcher would need a
-- second, subtly different mapper. Same shape means the Overview can select
-- from whichever view the caller asked for and nothing downstream cares.
--
-- CREATE OR REPLACE VIEW may only append columns, which is why they land at
-- the end rather than beside their relatives.
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
  a.commit_message,
  a.commit_author,
  a.version,
  a.baseline_analysis_id,
  a.error
FROM public.analyses a
ORDER BY a.project_id, a.branch, a.started_at DESC;

GRANT SELECT ON public.project_branch_latest_analysis TO authenticated;
