# Code Quality

Hosted, **multi-tenant SaaS** for static code analysis (SonarQube-shaped).

## Project knowledge lives in Obsidian, not here

Vault id **`code_analysis`**. Entry point: read **`Code Quality.md`** — it maps
questions to notes. Consult it before answering anything about architecture,
the data model, the database, the roadmap or past decisions.

This file stays small on purpose: it is re-sent on every request, so it holds
only what must be known *without knowing to ask*. Everything else is a note.
See `Decisions/ADR-0001 Project knowledge lives in the vault` in the vault.

Anything learned that will still matter next week goes into the vault, not into
this file and not into `README.md`. Conventions: `Meta/How to use this vault`.

## Invariants

- **Nothing connects to Postgres directly.** No ORM, no driver, no connection
  string, no database password — they were removed on 2026-09-16. Reads go
  through PostgREST, writes through database functions. Do not reintroduce one.
  Vault note: `ADR-0002 Everything goes through the Supabase API`.
- **Tenant scoping is RLS, not application code.** Policies read the JWT, so
  queries deliberately do *not* filter by organisation — a second copy of the
  rule would drift from the first. Writes go through `SECURITY DEFINER`
  functions that check membership themselves. Vault note: `Auth and tenancy`.
- **Any new view must be `WITH (security_invoker = on)`.** A view runs as its
  owner by default, and the owner bypasses RLS — one added without this serves
  every tenant's rows to anyone who asks. Vault note: `Data model`.
- **Nothing is analysed unless the worker is running.** The dashboard only
  inserts an `analysis_jobs` row. `npm run worker`. This is the first thing to
  check when an analysis never arrives. Vault note:
  `ADR-0003 Analysis runs in a worker behind a queue`.
- **The analyzer never imports the database.** It emits a `ScanReport`; the
  worker and the CLI publisher consume one. Keep that seam.
