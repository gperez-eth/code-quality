![Code Quality](https://img.shields.io/badge/status-in%20development-yellow.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Design](https://img.shields.io/badge/design-Stitch-4285F4.svg)

Hey! 👋 **Code Quality** is a hosted code quality dashboard, in the spirit of
SonarQube: it scans a codebase, tracks quality gates over time, and surfaces
the stuff that actually slows teams down — smells, duplication, complexity,
coverage gaps — in one place.

> **Status: in development.** Sign in with GitHub, connect a repository, and
> the tool clones it, analyses it and scores it against the quality gate. The
> Repositories, Overview and Issues screens are built; the rest of the designed
> screens are still mockups.

Code Quality aims to offer:

- 📊 A project-level dashboard with quality gates (pass/fail thresholds you define)
- 🧹 Code smell, duplication and complexity detection across common languages
- 🧪 Coverage tracking, pulled in from your existing test reports
- 📈 Historical trends so regressions show up before they pile up
- 🔌 CI integration — fail a pipeline on a broken quality gate
- 🧩 Pluggable analyzers, so new languages/rules don't require a rewrite

## Run it

Needs Node 20.9+ and a Supabase project. The parser is a native module, so
`npm install` builds it on first run.

```bash
npm install
cp apps/web/.env.example apps/web/.env   # dashboard: project URL + publishable key
cp .env.example .env                     # worker: service role key. Both from Settings -> API
npx supabase link --project-ref <ref>   # once; asks for your database password
npx supabase db push                    # apply supabase/migrations
npm run dev                   # dashboard on http://localhost:3000
npm run worker                # in another terminal: what actually runs the analyses
```

The worker is not optional. The dashboard never analyses anything itself: it
writes a row to `analysis_jobs` and returns, and the worker claims it, clones
the repository and publishes the result. Cloning a stranger's repository and
parsing it is minutes of CPU on code you did not write, which is not something
to do inside a web request.

There is no database password anywhere in that list, and that is the point:
**nothing connects to Postgres directly.** Every read and write goes through
the Supabase API, under Row Level Security. The publishable key in
`apps/web/.env` is
not a secret — it is the policies, not the key, that decide what anyone sees.

Sign-in is GitHub OAuth, enabled in the Supabase dashboard under Authentication
→ Providers. Signing in for the first time creates your organisation; every
project, analysis and issue belongs to exactly one, and nothing is visible
across the boundary.

Then connect a repository: paste a GitHub or GitLab URL. It is cloned into the
workspace, analysed, and opened on its overview. "Analyse again" re-runs it
against the current tip of the branch.

Private repositories need an access token, and there is nothing to configure
for it: the token travels once, over TLS, to a function that hands it straight
to **Supabase Vault**. The database holds the ciphertext and the key; the row
keeps an id. Nothing in the app has a secret to lose, no member can read it
back through the API, and the only thing that ever sees the plaintext again is
the worker, when it clones.

Until the project is configured the dashboard shows the setup steps instead of a
repository list, so a fresh clone explains itself.

### Scanning on its own

The analyzer needs no database at all:

```bash
npm run scan -- ../my-app --top 30     # human-readable report
npm run scan -- --rules                # what the 25 built-in rules look for
npm test                               # the analyzer's own suite
npm run design                         # browse the Stitch screens on :4321
```

Publishing a report from CI is a separate step, and a separate credential:

```bash
npm run scan -- . --json report.json
npm run publish -- report.json --org <slug>   # needs SUPABASE_SERVICE_ROLE_KEY
```

The scan exits `1` when the quality gate fails, which is all a CI job needs.
There is no baseline on a first analysis, so the whole codebase counts as new
code — the same thing SonarQube does on day one. From the second analysis on,
the leak period holds only the findings that appeared since.

## Layout

| Package | What lives there |
| --- | --- |
| `packages/core` | The vocabulary: issues, severities, metrics, ratings, quality gate evaluation, and the scan report contract. No I/O. |
| `packages/analyzer` | Parses with tree-sitter, runs the rules, measures size/complexity/duplication, evaluates the gate. Ships the `code-quality-scan` CLI. |
| `packages/git` | Talks to git: parses GitHub/GitLab/SSH URLs, clones and fetches, reads commits and branches, opens local working copies. |
| `packages/worker` | Claims queued jobs, clones, analyses and publishes. Runs as the service role; takes input only from the queue. |
| `packages/publish` | The CI publisher: reads a scan report and calls the import function. Ships `code-quality-import`. |
| `apps/web` | The dashboard: Next.js App Router, RTK Query over the Supabase API, Tailwind v4. |
| `supabase/migrations` | The schema, the RLS policies, the read-model views and the import function. |
| `design/` | Stitch exports — screens, screenshots and the design system. |

Rules are plain objects (`key`, `type`, `severity`, `effortMinutes`, a `check`
that walks the syntax tree), so adding one is a file in
`packages/analyzer/src/rules` and a line in its index.

The analyzer never touches the database: it writes a `ScanReport`, and the
importer reads one. A CI job can scan on one machine and publish from another.

### How the data moves

Reads go through RTK Query against PostgREST, and RLS decides what comes back —
the endpoints deliberately do not filter by organisation, because that rule
already lives in the policies and a second copy would drift from the first.
PostgREST serves rows and does not compute, so anything aggregated (the latest
analysis per project, lines by language, the faceted issue counts) is a view or
a function in `supabase/migrations`. Views are `security_invoker`, without
which they would run as their owner and hand every tenant's rows to anyone.

Writes are two steps, deliberately. The browser calls `request_analysis`,
which checks membership, vaults any token and inserts a job — that is the whole
mutation, and it returns a job id. The worker then claims the job
(`FOR UPDATE SKIP LOCKED`, so several workers never collide) and calls
`import_analysis`, which publishes the analysis. That second function touches
eight tables and has to land together — a half-imported analysis shows up in
the dashboard as a real one — and REST has no multi-statement transaction, so
the transaction lives in the database.

Asking twice for the same project while one job is in flight returns the job
already running, so a double click costs nothing.

## Status & roadmap

| Milestone | State |
| --- | --- |
| UI/UX design (Stitch) | ✅ Done |
| Project scaffold | ✅ Done |
| Analysis engine | 🟡 TS/JS rules, metrics, duplication and gates run; coverage ingestion pending |
| Repository connection | 🟡 GitHub, GitLab and local repositories connect and analyse; per-commit triggers pending |
| Dashboard (web) | 🟡 Repositories, Overview and Issues; Measures, Code, Quality Gates and Rules pending |
| CI integration | 🟡 `code-quality-import` publishes a report; pipeline templates pending |

## Contributing

This project is just getting started — issues and ideas are welcome, but
expect things to move fast and break while the core shape settles.

## License

[MIT](LICENSE) © Guillermo Pérez ([gperez-eth](https://github.com/gperez-eth))

Thanks for reading this far — more coming soon! 💙
