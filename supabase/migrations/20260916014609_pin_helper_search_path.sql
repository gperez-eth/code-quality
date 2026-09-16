-- A function with a mutable search_path resolves its names against whatever
-- the caller has set, which is how an unqualified reference gets hijacked.
-- Empty path plus fully-qualified names leaves nothing to resolve.
--
-- The two SECURITY DEFINER functions in `public` — import_analysis and
-- project_credentials — already pin theirs in their own definitions.
ALTER FUNCTION private.rating_from_worst_severity(int, int, int, int) SET search_path = '';
ALTER FUNCTION private.rating_from_debt_ratio(numeric) SET search_path = '';
ALTER FUNCTION private.reported_issues(jsonb) SET search_path = '';
ALTER FUNCTION private.user_organization_ids() SET search_path = '';
