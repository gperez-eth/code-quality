-- The webhook receiver, in the database.
--
-- The edge function that GitHub calls is a pipe: it forwards the raw body, the
-- signature header and the event name, and returns whatever comes back. All of
-- the deciding happens here, for one reason — `private.github_webhook_secret()`
-- lives in a schema PostgREST does not expose, and the alternative was putting
-- a function that hands out the app secret on the REST surface. The body comes
-- to the secret instead of the secret going to the body.

CREATE OR REPLACE FUNCTION public.handle_github_event(
  p_event text,
  p_signature text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
  v_expected text;
  v_payload jsonb;
  v_installation bigint;
  v_action text;
  v_ref text;
  v_branch text;
  v_job_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the webhook receiver may deliver events' USING ERRCODE = '42501';
  END IF;

  v_secret := private.github_webhook_secret();

  -- No secret configured is a refusal, never a pass. An unsigned webhook
  -- endpoint that queues work is an open door to anyone who learns the URL.
  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RAISE EXCEPTION 'No webhook secret is configured; refusing to trust this delivery'
      USING ERRCODE = '42501';
  END IF;

  v_expected := 'sha256=' || encode(extensions.hmac(p_body, v_secret, 'sha256'), 'hex');

  -- Compared as digests rather than as strings. `=` on text short-circuits at
  -- the first differing byte, which leaks how much of a forged signature was
  -- right; hashing both sides first makes every comparison the same length and
  -- the same work.
  IF extensions.digest(v_expected, 'sha256') <> extensions.digest(coalesce(p_signature, ''), 'sha256') THEN
    RAISE EXCEPTION 'Signature does not match' USING ERRCODE = '42501';
  END IF;

  -- Only now is the body worth reading.
  v_payload := p_body::jsonb;
  v_installation := (v_payload->'installation'->>'id')::bigint;

  IF p_event = 'ping' THEN
    RETURN jsonb_build_object('handled', 'ping');
  END IF;

  IF p_event = 'installation' THEN
    v_action := v_payload->>'action';

    -- `created` is not handled here on purpose. Nothing in the payload says
    -- which of *our* organisations the installation belongs to — only the
    -- person who clicked Install knows that, and they arrive at the setup
    -- redirect in a browser carrying a session. That is where the row is
    -- written. See #12.
    IF v_action = 'deleted' THEN
      DELETE FROM public.github_installations WHERE id = v_installation;
    ELSIF v_action = 'suspend' THEN
      UPDATE public.github_installations SET suspended_at = now() WHERE id = v_installation;
    ELSIF v_action = 'unsuspend' THEN
      UPDATE public.github_installations SET suspended_at = NULL WHERE id = v_installation;
    END IF;

    RETURN jsonb_build_object('handled', 'installation', 'action', v_action);
  END IF;

  IF p_event = 'push' THEN
    v_ref := v_payload->>'ref';

    -- Tags and branch deletions are not pushes of code to analyse.
    IF v_ref IS NULL OR v_ref NOT LIKE 'refs/heads/%' OR coalesce((v_payload->>'deleted')::boolean, false) THEN
      RETURN jsonb_build_object('handled', 'push', 'queued', false, 'reason', 'not a branch update');
    END IF;

    v_branch := substring(v_ref FROM length('refs/heads/') + 1);

    v_job_id := public.queue_push_analysis(
      v_installation,
      v_payload->'repository'->>'full_name',
      v_branch,
      v_payload->>'after'
    );

    RETURN jsonb_build_object(
      'handled', 'push',
      'queued', v_job_id IS NOT NULL,
      'jobId', v_job_id,
      'branch', v_branch
    );
  END IF;

  -- Everything else is acknowledged rather than rejected: GitHub retries a
  -- non-2xx, and retrying an event nobody wanted is noise on both sides.
  RETURN jsonb_build_object('handled', 'ignored', 'event', p_event);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_github_event(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_github_event(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_github_event(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_github_event(text, text, text) TO service_role;

-- Links an installation to the organisation whose member just installed it.
-- Called from the setup redirect, where there is a session to read.
CREATE OR REPLACE FUNCTION public.link_github_installation(
  p_installation_id bigint,
  p_organization_id uuid,
  p_account_login text,
  p_account_type text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Not a member of organisation %', p_organization_id USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.github_installations (id, organization_id, account_login, account_type)
  VALUES (p_installation_id, p_organization_id, p_account_login, p_account_type)
  ON CONFLICT (id) DO UPDATE SET
    -- Re-installing onto a different organisation moves it rather than failing:
    -- the person clicking Install is the authority on where it belongs.
    organization_id = excluded.organization_id,
    account_login = excluded.account_login,
    account_type = coalesce(excluded.account_type, public.github_installations.account_type),
    suspended_at = NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_github_installation(bigint, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_github_installation(bigint, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_github_installation(bigint, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_github_installation(bigint, uuid, text, text) TO service_role;
