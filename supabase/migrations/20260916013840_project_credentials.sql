-- Secrets out of reach of the REST API.
--
-- The read policy on public.projects grants the whole row, so any member could
-- ask PostgREST for `select=access_token` and get the (encrypted) repository
-- token back. The client DTO never asks for it, but a policy is not enforced by
-- what the client happens to select.
--
-- Note the shape of this: revoking the two columns on their own does nothing
-- while a table-wide SELECT grant is in place, because the table grant already
-- covers every column. The table grant has to go first, and the columns that
-- should stay readable are then granted back by name.
--
-- Consequence worth knowing: `select=*` on projects now fails for a normal
-- account, which is why every endpoint names its columns.
REVOKE SELECT ON public.projects FROM authenticated;
GRANT SELECT (
  id, organization_id, key, name, provider, repository_url, local_path,
  main_branch, analyze_on_push, quality_gate_id, created_at, last_analyzed_at
) ON public.projects TO authenticated;

-- anon has no policy on projects and so sees no rows anyway; it has no reason
-- to hold the grant either.
REVOKE SELECT ON public.projects FROM anon;

-- Re-analysing a private repository needs that token back, and the server is
-- the only thing that should ever hold it. One function, membership checked,
-- returning nothing else — rather than a service-role key that would hand the
-- holder every row in the database.
--
-- Still encrypted: decryption happens in the app, with a key the database does
-- not have.
CREATE OR REPLACE FUNCTION public.project_credentials(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_row public.projects%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = v_row.organization_id AND m.user_id = auth.uid()
  ) THEN
    -- Indistinguishable from "no such project", on purpose.
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'accessToken', v_row.access_token,
    'webhookSecret', v_row.webhook_secret
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.project_credentials(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.project_credentials(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.project_credentials(uuid) TO authenticated;
