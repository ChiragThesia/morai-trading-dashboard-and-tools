---
paths:
  - "**/*"
---

# Working in This Repo

## Requirements

### Docs Before Code

- Architecture changes MUST update docs FIRST. New tooling, swapped tech, new bounded
  context, new table, new job → update the relevant `docs/architecture/*.md` and the
  decision table in `docs/architecture/stack-decisions.md` before implementation.
- The doc set in `docs/architecture/` is the source of truth. Code that contradicts it
  is a bug in one of them — reconcile before proceeding.

### Planning

- Tasks with 3+ steps or an architectural decision MUST start in plan mode. Plans
  include verification steps, not just build steps.
- Pre-mortem significant plans (murphyjitsu) — incorporate failure modes before execution.
- If something goes sideways mid-task: STOP, re-plan. Don't push through.

### Verification Before Done

- Never claim complete without running the proof: tests pass (show output), typecheck
  clean, lint clean. "Should work" is not done.
- Bug fixes: failing regression test first (see [tdd.md](tdd.md)), then fix, then green.
- Behavior changes: diff before/after behavior where relevant.

### Change Hygiene

- **Minimal impact** — touch only what the task needs. No drive-by refactors mixed into
  feature/fix work; refactors are their own commits with green tests on both sides.
- **Root causes only** — no temporary hacks, no `setTimeout` band-aids. If a hack is
  unavoidable, it gets a tracking issue + comment with removal criteria.
- Commits at green only. Conventional, small, single-purpose.

### Data Discipline

- `knowledge-base/` is read-only reference material — never edited by code tasks.
- Journal data is rebuilt from broker fills — never hand-edit trade history.
- Schwab credentials/tokens: never in code, logs, commits, or test fixtures.

## Order of Authority

1. Direct user instruction in conversation
2. `.claude/rules/*` (these files)
3. `docs/architecture/*`
4. General defaults

Conflicts → surface, don't silently pick.

## Where to Look

- [docs/architecture/overview.md](../../docs/architecture/overview.md) - System overview, hard rules summary
- [docs/TOPIC-MAP.md](../../docs/TOPIC-MAP.md) - Complete documentation index
- [docs/docs-on-docs/](../../docs/docs-on-docs/) - How to write and maintain docs
