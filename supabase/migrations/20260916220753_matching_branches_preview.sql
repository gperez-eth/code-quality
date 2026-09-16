-- Which branches a set of patterns would catch, right now.
--
-- The automation dialog previews the effect of patterns the user is still
-- typing, so it cannot read the saved ones — it has to ask about arbitrary
-- input. Doing it here rather than in TypeScript keeps one definition of glob
-- matching: `public.branch_matches` decides for the preview and for the webhook
-- that actually queues the work, so the preview cannot lie.
--
-- SECURITY INVOKER on purpose, which is the default and is why it is not
-- spelled: the RLS policy on project_branches already limits this to projects
-- the caller's organisation owns, and a SECURITY DEFINER here would hand
-- anyone the branch names of any project by guessing a uuid.
CREATE OR REPLACE FUNCTION public.matching_branches(p_project_id uuid, p_patterns text[])
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(b.name ORDER BY b.name), ARRAY[]::text[])
  FROM public.project_branches b
  WHERE b.project_id = p_project_id
    AND public.branch_matches(b.name, p_patterns);
$$;

REVOKE EXECUTE ON FUNCTION public.matching_branches(uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.matching_branches(uuid, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.matching_branches(uuid, text[]) TO authenticated, service_role;
