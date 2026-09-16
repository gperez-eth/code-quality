-- Written by hand, not generated: a trigger on auth.users is not expressible
-- in schema.ts, and auth is Supabase's schema.
--
-- A new account needs somewhere to work, so signing up creates a personal
-- organisation and makes the account its owner. In a trigger rather than in the
-- app because it is then atomic with the signup and covers every way in — OAuth
-- today, email or an accepted invite later — with no path that leaves an
-- account with nowhere to put a project.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug text;
  candidate text;
  suffix integer := 0;
  new_org uuid;
BEGIN
  -- GitHub hands us a username; otherwise fall back to the local part of the
  -- email address, and to a constant if that leaves nothing usable.
  base_slug := coalesce(
    nullif(regexp_replace(lower(new.raw_user_meta_data->>'user_name'), '[^a-z0-9-]+', '-', 'g'), ''),
    nullif(regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9-]+', '-', 'g'), ''),
    'org'
  );
  base_slug := trim(both '-' from base_slug);
  IF base_slug = '' THEN base_slug := 'org'; END IF;

  -- Let the unique index arbitrate rather than checking first: two people
  -- signing up at once with the same GitHub handle is rare but not impossible.
  candidate := base_slug;
  LOOP
    BEGIN
      INSERT INTO public.organizations (slug, name)
      VALUES (candidate, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), candidate))
      RETURNING id INTO new_org;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      suffix := suffix + 1;
      IF suffix > 50 THEN RAISE; END IF;
      candidate := base_slug || '-' || suffix;
    END;
  END LOOP;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org, new.id, 'OWNER');

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- A trigger function has no business being reachable as an RPC: PostgREST
-- exposes anything in `public` on /rest/v1/rpc/ by default, and this one runs
-- as its owner.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
