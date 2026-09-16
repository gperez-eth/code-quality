# CI

Two lanes run an analysis. **Your CI is the primary one.** It already has the
code checked out, it runs on your compute instead of ours, and it is the only
lane that can ever produce test coverage — that means executing your test
suite, which our hosted worker has no business doing to a stranger's code.
The hosted worker (connect a repository in the dashboard) exists for a fast
first look, with limits: default branch only, capped size, a timeout. Full
reasoning: ADR-0005 in the project's knowledge base.

Workflows:

- `.github/workflows/code-quality.yml` — this repository scanning itself.
- `.github/workflows/templates/code-quality-consumer.yml` — copy this into
  your own repository. It's under `templates/` so GitHub doesn't run it from
  here; nothing under a subdirectory of `.github/workflows/` executes as a
  workflow.

## Adding the publish secret

Publishing needs a service role key, which bypasses RLS entirely and must
never reach a browser — it belongs in CI secrets only. In your repository:
**Settings -> Secrets and variables -> Actions -> New repository secret**,
named `SUPABASE_SERVICE_ROLE_KEY`. The value is in your Supabase project
under **Settings -> API -> service_role**. Add `SUPABASE_URL` (your project's
`https://<ref>.supabase.co`) the same way.

Without the secret, the scan still runs and still fails the build on a broken
quality gate — only the publish step is skipped, so a fork or a repository
that hasn't configured publishing yet gets gate enforcement, not a red build
about a missing credential.

## Exit codes

`code-quality-scan`:

- `0` — quality gate passed (or `--no-fail` was given, or `--rules`/`--help`
  was used)
- `1` — quality gate failed
- `2` — the scan itself errored (bad path, parser failure, …), not the gate

`code-quality-import`:

- `0` — the report was published
- `1` — it wasn't: a malformed report, a missing env var, an unknown `--org`
  slug, or the import itself failing

CI only needs to act on the scan's exit code. It already fails the job; there
is nothing to re-check.

## The one caveat

Coverage can only ever come from the CI lane, and that isn't a gap today's
tooling will close later — it's structural. Coverage means running your test
suite, and the hosted worker only clones and parses a repository; running a
stranger's tests on our compute is a different, much riskier thing to build,
and not one this product does. Whatever coverage ingestion ends up looking
like (not built yet — see the roadmap), it arrives through this lane or not
at all.
