-- Proving that the person claiming an installation is the person who made it.
--
-- Part of #12. The setup redirect GitHub sends the browser to carries an
-- installation_id in a query string and nothing else that ties it to us.
-- link_github_installation checked that the caller belongs to the organisation
-- they are claiming *into*, which is a different question from whether the
-- installation is theirs. Any signed-in user could post somebody else's
-- installation id and — because the upsert moved an existing row — take it.
-- From then on that customer's pushes would queue analyses inside the
-- attacker's organisation, cloned with a token we mint for them.
--
-- Three things close it, and the third is the one that actually proves
-- ownership:
--
--   1. A `state` nonce, minted before we send them to GitHub and recognised on
--      the way back. Binds the flow to one user and one organisation.
--   2. An installation already linked to another organisation is never moved
--      silently; it has to be uninstalled first, which GitHub tells us about.
--   3. The `installation.created` webhook — signed by GitHub, so not forgeable
--      — records *who* performed the install. The claim has to come from that
--      same GitHub account.
--
-- (3) means the app's webhook must be configured before anyone can link an
-- installation. That is deliberate. Without it there is no evidence at all,
-- and the honest answer to "prove this one is yours" is not "we assume so".

-- The nonce we handed out, and what it was for.
CREATE TABLE IF NOT EXISTS public.github_install_states (
  nonce text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

COMMENT ON TABLE public.github_install_states IS
  'One row per "Install app" click: the state parameter GitHub echoes back, bound to the user and organisation that started the flow.';

-- What GitHub told us about an installation before anyone claimed it.
--
-- Written only by the webhook, which means only by a delivery whose HMAC
-- verified. sender_login is the evidence: GitHub says who pressed Install, and
-- we believe GitHub rather than the query string.
CREATE TABLE IF NOT EXISTS public.github_pending_installations (
  id bigint PRIMARY KEY,
  account_login text NOT NULL,
  account_type text,
  sender_login text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.github_pending_installations IS
  'Installations GitHub has announced but nobody has linked to an organisation yet. sender_login is who performed the install, and is what a claim is checked against.';

ALTER TABLE public.github_install_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_pending_installations ENABLE ROW LEVEL SECURITY;

-- No policies on either, deliberately. Both are evidence rather than content:
-- nothing in the dashboard reads them, and a nonce that can be listed is not a
-- nonce. Everything goes through the two SECURITY DEFINER functions below.
REVOKE ALL ON public.github_install_states FROM anon, authenticated;
REVOKE ALL ON public.github_pending_installations FROM anon, authenticated;

-- Starts the flow. Returns the state to put in the install URL.
CREATE OR REPLACE FUNCTION public.begin_github_install(p_organization_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_nonce text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of organisation %', p_organization_id USING ERRCODE = '42501';
  END IF;

  -- Housekeeping on the way past: a state nobody came back with is litter.
  DELETE FROM public.github_install_states WHERE created_at < now() - interval '1 day';

  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.github_install_states (nonce, organization_id, user_id)
  VALUES (v_nonce, p_organization_id, auth.uid());

  RETURN v_nonce;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_github_install(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_github_install(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_github_install(uuid) TO authenticated;

-- Finishes the flow, if the evidence lines up.
--
-- Returns the organisation the installation now belongs to. Raises, with a
-- message the route can show, on every path that does not check out — an
-- installation claim is not somewhere to fail soft.
CREATE OR REPLACE FUNCTION public.claim_github_install(
  p_nonce text,
  p_installation_id bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_state public.github_install_states%ROWTYPE;
  v_pending public.github_pending_installations%ROWTYPE;
  v_claimant text;
  v_existing_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_state
  FROM public.github_install_states
  WHERE nonce = p_nonce
    AND user_id = auth.uid()
    AND used_at IS NULL
    AND created_at > now() - interval '1 hour'
  FOR UPDATE;

  IF v_state.nonce IS NULL THEN
    RAISE EXCEPTION 'That installation link has expired or was not started here. Try installing again.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pending
  FROM public.github_pending_installations
  WHERE id = p_installation_id;

  -- No webhook, no evidence. This is the common "it arrived a second later"
  -- case, so the message says to retry rather than implying something is
  -- broken -- but it is also the case where the app has no webhook configured
  -- at all, and refusing is the only safe answer to both.
  IF v_pending.id IS NULL THEN
    RAISE EXCEPTION 'GitHub has not confirmed that installation yet. Wait a moment and try again; if it keeps failing, check the app''s webhook.'
      USING ERRCODE = '42501';
  END IF;

  -- Supabase stores the GitHub login here for accounts that signed in with
  -- GitHub. Anyone who signed in another way cannot have installed anything.
  SELECT coalesce(u.raw_user_meta_data->>'user_name', u.raw_user_meta_data->>'preferred_username')
    INTO v_claimant
  FROM auth.users u
  WHERE u.id = auth.uid();

  IF v_claimant IS NULL OR lower(v_claimant) <> lower(v_pending.sender_login) THEN
    RAISE EXCEPTION 'That installation was created by a different GitHub account.'
      USING ERRCODE = '42501';
  END IF;

  -- Already linked somewhere else is a refusal, not a move. Taking an
  -- installation away from the organisation using it is exactly the thing this
  -- migration exists to stop, and re-installing is how someone legitimately
  -- moves one.
  SELECT organization_id INTO v_existing_org
  FROM public.github_installations WHERE id = p_installation_id;

  IF v_existing_org IS NOT NULL AND v_existing_org <> v_state.organization_id THEN
    RAISE EXCEPTION 'That installation already belongs to another organisation. Uninstall it on GitHub first.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.github_installations (id, organization_id, account_login, account_type)
  VALUES (p_installation_id, v_state.organization_id, v_pending.account_login, v_pending.account_type)
  ON CONFLICT (id) DO UPDATE SET
    account_login = excluded.account_login,
    account_type = coalesce(excluded.account_type, public.github_installations.account_type),
    suspended_at = NULL;

  UPDATE public.github_install_states SET used_at = now() WHERE nonce = p_nonce;
  DELETE FROM public.github_pending_installations WHERE id = p_installation_id;

  RETURN v_state.organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_github_install(text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_github_install(text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_github_install(text, bigint) TO authenticated;

-- link_github_installation is no longer something a browser may call. It moved
-- an installation between organisations on nothing but membership of the
-- destination, which is precisely the hole above. The service role keeps it for
-- back-office use; everyone else goes through claim_github_install.
REVOKE EXECUTE ON FUNCTION public.link_github_installation(bigint, uuid, text, text) FROM authenticated;

-- The webhook now records installation.created rather than ignoring it.
--
-- Only the `created` branch is new; every other line is byte-identical to
-- 20260916173048_github_webhook_handler.sql. Verify with a diff before trusting.
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

    -- `created` does not link anything: nothing in the payload says which of
    -- *our* organisations it belongs to, and only the person who clicked
    -- Install knows that. What it does carry is who clicked, signed by GitHub,
    -- and that is the evidence claim_github_install checks. The row waits here
    -- until they arrive at the setup redirect with a session and a state.
    IF v_action = 'created' THEN
      INSERT INTO public.github_pending_installations (id, account_login, account_type, sender_login)
      VALUES (
        v_installation,
        coalesce(v_payload->'installation'->'account'->>'login', ''),
        v_payload->'installation'->'account'->>'type',
        coalesce(v_payload->'sender'->>'login', '')
      )
      ON CONFLICT (id) DO UPDATE SET
        account_login = excluded.account_login,
        account_type = excluded.account_type,
        sender_login = excluded.sender_login,
        created_at = now();
    ELSIF v_action = 'deleted' THEN
      DELETE FROM public.github_installations WHERE id = v_installation;
      DELETE FROM public.github_pending_installations WHERE id = v_installation;
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
