-- Written by hand, not generated: drizzle-kit does not model policies here.
--
-- Until now RLS was on with no policies, which denies everything — correct
-- while the only reader was the server, connecting as a role that bypasses
-- RLS. Reading from the browser through PostgREST changes that: these policies
-- stop being defence in depth and become the access rules themselves.

-- A schema PostgREST does not expose, so this helper cannot be called as an
-- RPC. It is SECURITY DEFINER on purpose: a policy on organization_members
-- that queried organization_members would recurse forever.
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.user_organization_ids()
RETURNS setof uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION private.user_organization_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.user_organization_ids() FROM anon;
-- A policy runs as the querying role, so that role needs EXECUTE.
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_organization_ids() TO authenticated;

-- Read-only, and only for signed-in accounts. Writes stay on the server, which
-- connects as a role that bypasses RLS: the analyser reconciles issues in one
-- transaction, which is not something a REST client should be driving.
CREATE POLICY "members read their organisations" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT private.user_organization_ids()));

CREATE POLICY "members read their own membership rows" ON public.organization_members
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

CREATE POLICY "members read their projects" ON public.projects
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

CREATE POLICY "members read their quality gates" ON public.quality_gates
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));

CREATE POLICY "members read their gate conditions" ON public.quality_gate_conditions
  FOR SELECT TO authenticated
  USING (
    gate_id IN (
      SELECT id FROM public.quality_gates WHERE organization_id IN (SELECT private.user_organization_ids())
    )
  );

CREATE POLICY "members read their analyses" ON public.analyses
  FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE organization_id IN (SELECT private.user_organization_ids())
    )
  );

CREATE POLICY "members read their issues" ON public.issues
  FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE organization_id IN (SELECT private.user_organization_ids())
    )
  );

CREATE POLICY "members read their measures" ON public.measures
  FOR SELECT TO authenticated
  USING (
    analysis_id IN (
      SELECT a.id FROM public.analyses a
      JOIN public.projects p ON p.id = a.project_id
      WHERE p.organization_id IN (SELECT private.user_organization_ids())
    )
  );

CREATE POLICY "members read their file measures" ON public.file_measures
  FOR SELECT TO authenticated
  USING (
    analysis_id IN (
      SELECT a.id FROM public.analyses a
      JOIN public.projects p ON p.id = a.project_id
      WHERE p.organization_id IN (SELECT private.user_organization_ids())
    )
  );

-- The rule catalogue is the analyser's own, identical for everyone and not
-- anybody's data: an issue is unreadable without the rule that raised it.
CREATE POLICY "signed-in accounts read the rule catalogue" ON public.rules
  FOR SELECT TO authenticated
  USING (true);
