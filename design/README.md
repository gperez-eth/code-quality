# Design source

The UI for Code Quality comes from a [Stitch](https://stitch.withgoogle.com)
project. Everything in this folder is **exported output** — treat Stitch as the
source of truth for visual decisions and re-export rather than hand-editing
these files.

## Stitch project

| | |
| --- | --- |
| Title | Code Quality Analysis Dashboard |
| Resource | `projects/2566086563026806547` |
| Design system | Static Analysis Engine (light, Inter + JetBrains Mono, `#2563eb` primary) |
| Device target | Desktop, 1280px reference width (exports render at 2560px @2x) |
| Exported | Screens 01-08 on 2026-09-15; 09-11 and 14 on 2026-09-16; 12-13 on 2026-09-17 |

## Contents

- `stitch/design-system.md` — the design system verbatim: color tokens,
  type scale, spacing, elevation rules and component specs.
- `stitch/screens/*.html` — per-screen exports. Self-contained Tailwind (CDN)
  markup with the theme inlined into `tailwind.config`, Material Symbols for
  icons. Static mockups: no state, no data, no interactivity.
- `stitch/screenshots/*.png` — rendered reference images for each screen.

## Screens

| # | Screen | What it establishes |
| --- | --- | --- |
| 01 | Project Overview | Quality gate banner (Failed + failing condition), metric scorecards split Overall / New Code ("Leak Period"), rating badges A–E, language breakdown |
| 02 | Issues | Facet sidebar (type, resolution, severity, status, tag), issue list, bulk change, My Issues / All toggle, display mode Issues vs Effort |
| 03 | Code & Issue Detail | Split pane: file tree + code viewer with line gutter, inline issue callout, execution-flow step markers, issue N/725 pager, keyboard nav for locations |
| 04 | Measures — Security Overview | Measures domain nav (Reliability, Security, …), On-new-code vs Overall columns, remediation effort, severity buckets |
| 05 | Measures — Remediation Effort by File | Same shell as 04 in file-list mode, sorted by effort |
| 06 | Quality Gates | Gate list with condition/project counts, built-in "Sonar way" gate, conditions table (metric, operator, threshold, sample impact), add-condition flow |
| 07 | Rules Configuration | Rule browser: language / type / severity / activation / security-standard facets, rule list with counts |
| 08 | Repositories | The entry point: connected git repositories with branch, last commit, gate status and issue count, plus the "Connect repository" dialog (GitHub / GitLab / local path, access token, branch, project key, when to analyse) |
| 09 | Duplications | Cluster list with NEW badges against the baseline, side-by-side diff with synchronised gutters and a token count, scorecards split Overall / New Code, and a Reuse Trend band setting copy/paste against moved (refactored) code |
| 10 | Maintainability | Composite slop score 0-100 with its four dimensions as meters, the six reuse signals with deltas, findings grouped by slop pattern, worst files, and a grouped bar chart against the baseline analysis |
| 11 | Unused Code | Counts for unused files / exports / dependencies / unlisted / unresolved imports, a confidence filter and three-segment confidence meter, an import-graph reachability panel with the AST reference chain, static import evidence, and the caution that dynamic imports and path aliases can make a reachable file look unused |
| 12 | Branches | The branch list with per-branch gate and Analyse action, and the branch switcher popover open in the sub-header: filter box, gate dot per branch, the default pinned and a link through to Analysis automation |
| 13 | Analysis automation | The per-project dialog: a master toggle, on-push and on-new-branch rules, pull-request analysis disabled behind a "Needs branch analysis" pill, glob pattern chips with a live "3 of 5 branches match right now" preview, and the warning that none of it fires without the GitHub App |
| 14 | CI Integration & Pipeline Runs | The customer's own CI runs shown beside our analyses — point 4 of ADR-0006. Generated 2026-09-16, not built |

Notes:

- The mockups are populated with SonarQube's own demo data (project "CxPHP",
  Checkmarx findings, 725 vulnerabilities, Oct 2017 timestamps). That is
  placeholder content, not a spec for our data model.
- Stitch also held a duplicate export of Project Overview under a second screen
  id (`1d1f27ff…`, titled "SonarQube Code Quality & Security Dashboard"); it is
  byte-identical to `01-project-overview.html` and was not kept twice.
- Screens 01-07 predate the repository model and still show SonarQube's demo
  project. Screen 08 is the first one designed around what the tool actually
  does: connect a git repository and analyse its commits.
> [!warning] `list_screens` lags badly; `get_screen` by id is the truth.
> A screen created and confirmed `COMPLETE` was still missing from
> `list_screens` ten minutes later, and screen 14 was written off as "never
> generated" on 2026-09-16 on exactly that evidence — it had existed all along,
> and so had screen 13, whose generation call had timed out. **A generation
> that times out has usually still succeeded.** Keep the id the generate call
> returns and fetch it directly; only conclude something is missing after a
> much longer wait, and never regenerate on a timeout alone — that is how the
> duplicate of screen 08 below happened.

- Screen 08 exists twice in Stitch (`ccb3776b…` and `701904e7…`, the second
  titled "Code Quality — Repositories") because a generation that appeared to
  time out had in fact succeeded. They differ only in the header chip and some
  spacing; `ccb3776b…` is the one exported here.
- Screens 09-11 were designed on 2026-09-16 for the duplication, slop and
  unused-code work (issues #20-#24). They are the first screens drawn from
  research rather than from SonarQube's own UI — the six reuse signals on
  screen 10 come straight from the GitClear findings in the vault note
  `Duplication and slop detection`. They still carry the CxPHP demo data.
- **The time-out-that-succeeded bit again.** Three screens were requested, two
  reported failure, and relaunching them produced duplicate exports of
  Maintainability and Unused Code — the same behaviour the screen 08 note above
  already described. A generation that times out is still running. Wait and
  re-list before relaunching; match by title, because duplicates share one.
- **Screen 11 is missing a column the feature needs.** The discarded variant
  had a REASON column reading like prose — "only referenced by a barrel file
  that nothing imports". Explaining *why* something looks unused is what makes
  the finding trustworthy rather than a guess, so the implementation should
  carry it even though this export does not.
- The screens are desktop-only. No tablet or mobile breakpoints were designed.

## Re-exporting

The Stitch MCP server (`stitch`, user scope) exposes the project. To refresh:
list screens on project `2566086563026806547`, then download each
`htmlCode.downloadUrl` and `screenshot.downloadUrl`.
