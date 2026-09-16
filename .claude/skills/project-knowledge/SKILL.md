---
name: project-knowledge
description: Read from and write to the code-quality Obsidian vault (id `code_analysis`), which is this project's knowledge base. Use whenever a task needs project context — architecture, data model, database, auth/tenancy, roadmap, conventions, or why something was done a certain way — and whenever something worth keeping is learned. Also use when asked to document, record or write up a decision.
---

# Project knowledge

Project knowledge for code-quality lives in the Obsidian vault **`code_analysis`**,
not in `README.md` and not in `CLAUDE.md`. Rationale:
`Decisions/ADR-0001 Project knowledge lives in the vault`.

## Reading

Before answering or changing anything that depends on project context:

1. `obsidian_read_note` on **`Code Quality.md`** — the map. It says which note
   answers which question, so one read is usually enough to pick the second.
2. Read the one or two notes the map points at. Do not read the whole vault.
3. Follow `[[links]]` at the end of a note when the thread continues.
4. If the map does not cover it, `obsidian_search_vault` with `mode: content`
   (or `mode: tag` for `cq/architecture`, `cq/ops`, `cq/product`, `cq/decision`,
   `cq/database`, `cq/security`, `cq/meta`).

Layout: `Product/`, `Architecture/`, `Operations/`, `Decisions/`, `Meta/`.

**Precedence.** The code is authoritative on what the code *does*. The vault is
authoritative on *why*, on what is intended, and on what is deliberately not
what it looks like. `README.md` is authoritative on nothing: it is written for whoever
clones the repo, and it goes stale without anyone noticing.
If the vault and a code comment disagree, say so rather than silently picking one.

## Writing

Write when something is learned that (a) still matters next week and (b) cannot
be recovered by reading the code: decisions and their reasons, constraints,
traps, intentions, corrections to a note that turned out wrong.

Do **not** write: what the code says plainly, a summary of work just done
(git covers that), or session-local chatter.

Mechanics:

- Prefer `obsidian_edit_note` on the note that already owns the topic over a new
  note. Read first, pass the returned `etag` as `if_match`, and bump `updated`.
- A genuinely new topic gets a new note — and a row in the table in
  `Code Quality.md`, or it is unreachable.
- A decision gets `Decisions/ADR-NNNN <title>.md`. ADRs are append-only:
  supersede with a new one that links back, never rewrite an accepted one.
- Frontmatter on every note: `title`, `description` (one sentence, written as an
  answer — it is what a search hit shows), `tags`, `updated` (absolute date).
- Unique basenames across folders; `[[Data model]]` resolves by basename.
- Cite files by path: `packages/worker/src/index.ts`, not "the worker module".

Full conventions: `Meta/How to use this vault`.

## What stays out of the vault

`CLAUDE.md` keeps only invariants that must be known *without knowing to ask* —
nothing connecting to Postgres directly, RLS carrying tenancy,
`security_invoker` on every view, the worker being required for any analysis to
happen, the analyzer/database seam. If a new fact is of that kind, it belongs in `CLAUDE.md`
**and** in a note; anything else belongs in the vault alone.
