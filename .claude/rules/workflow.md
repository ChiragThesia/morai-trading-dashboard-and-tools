---
paths:
  - "**/*"
---

# Working in This Repo

**The rebuild is underway.** v1 was deleted at `fd4f8d3`; this repo kept the knowledge and Phase 1
landed on 2026-08-31. There is a Python package under `src/morai/`, a test suite, CI, and a
deployment. See `CLAUDE.md` for what exists and how to run it.

This file sits **above** `CLAUDE.md` in the order of authority below, so a stale claim here
outranks a correct one there. It said "there is no application" until Phase 1 made that false.
Keep it current for the same reason.

## Requirements

### Check the record before deciding

This project's defining asset is `docs/learnings/` — 337 numbered entries, each with its mechanism,
its cost, and its source. Before making a decision, grep it. Most decisions worth making here have
been made once already, and a sixth of them were made wrong the first time and are recorded in
`refuted.md`.

- Cite entries by number (`L001`, `V091`, `D021`, `P002`, `R011`) rather than restating them.
- **IDs are append-only.** They are cross-referenced between files and from `REBUILD-BRIEF.md`.
  Renumbering breaks those citations silently. New entries continue the sequence.
- Adding a learning is a first-class contribution. If this session discovers something that cost
  real time, it belongs in `docs/learnings/`, not only in a commit message.

### Verification before done

- Never claim complete without running the proof and showing the output. "Should work" is not done.
- A green test suite is evidence, not proof. This project shipped production bugs past green suites
  at least ten times — see `process-and-verification.md`.
- Verify against the thing itself, not a description of it. `docs/architecture/` describes a system
  that no longer exists; a claim checked against it is unverified.
- Do not generalise a measurement across a boundary you did not measure. Two tables fed by two jobs
  can be in completely different health.
- When you cannot verify something, say so explicitly rather than softening the claim.

### Evidence discipline

- Never invent a number, a quote, a file path, or a citation. If the source does not contain it, it
  does not go in.
- `WebFetch` paraphrases. For any quote or figure that matters, fetch with `curl` and read the real
  bytes. See `V065`.
- Distinguish what a vendor says about itself, what users report, and what you measured. Tag which.
- Where two sources disagree on a number, record both rather than silently picking one.

### Planning

- Tasks with 3+ steps or a design decision start with a plan that includes its verification steps,
  not only its build steps.
- Pre-mortem anything significant — name the failure modes before executing.
- If something goes sideways mid-task: stop and re-plan. Do not push through.

### Change hygiene

- **Minimal impact.** Touch only what the task needs. No drive-by refactors mixed into other work.
- **Root causes only.** No temporary hacks. If one is unavoidable it carries a comment with its
  removal criteria.
- Commits small, single-purpose, conventional. The message explains *why*, and records the
  measurement behind a decision where one exists.
- Sequence destructive actions after the verification that depends on them, never before.

### Data discipline

- `knowledge-base/` is read-only reference material.
- `salvage/*.md` is a historical record of code that no longer exists. Correct an error in it, but
  do not "update" it — it documents what was, not what is.
- Secrets never enter code, logs, commits, or fixtures. `.env` holds Schwab developer app
  credentials that survived the teardown and are in no commit.

### The environment

This repo sits on an iCloud-synced Desktop, which silently duplicates files with a ` 2` suffix and
has already put one such file into git history. `V091` has the mechanism, the diagnostics, and the
real fix. A backup placed on the same synced volume is not a backup.

## Order of Authority

1. Direct user instruction in conversation
2. `.claude/rules/*` (these files)
3. `docs/learnings/` — the numbered record
4. `REBUILD-BRIEF.md`
5. General defaults

`docs/architecture/` is **history, not authority.** It documents the deleted system.

Conflicts → surface them, don't silently pick.

## Where to Look

- [CLAUDE.md](../../CLAUDE.md) - what this repo is now, and what in it is known-stale
- [docs/learnings/README.md](../../docs/learnings/README.md) - how the 337 entries are organised and cited
- [REBUILD-BRIEF.md](../../REBUILD-BRIEF.md) - scope, PORT/REWRITE/DROP, open questions
- [docs/docs-on-docs/hemingway-style.md](../../docs/docs-on-docs/hemingway-style.md) - prose style, enforced on all documentation
