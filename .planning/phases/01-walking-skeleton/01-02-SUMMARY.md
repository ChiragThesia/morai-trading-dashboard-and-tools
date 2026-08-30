---
phase: 01-walking-skeleton
plan: 02
subsystem: infra
tags: [github-actions, ci, postgres, basedpyright, mypy, ruff, pytest, alembic]

requires:
  - phase: 01-01
    provides: "pyproject.toml gate config, tools/gate.sh, src/morai/settings.py, alembic/env.py, docker-compose.yml (postgres:18-alpine)"
provides:
  - ".github/workflows/ci.yml — four separately named jobs (typecheck-basedpyright, typecheck-mypy, lint-ruff, test-pytest), each running the exact tools/gate.sh command for that tool"
  - "test-pytest job's Postgres 18 service container — the only place a @pytest.mark.db test can run on this machine, since Docker's local daemon is broken and Railway's Postgres is private-network-only"
  - "Observed proof, on a real pushed commit, that all four jobs report and that the workflow can fail for a type violation and a failing test"
affects: [01-10]

actuals:
  tokens: 1040
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns:
    - "CI jobs never reimplement gate commands inline — each job's `run:` step is the identical command tools/gate.sh runs for that tool, so CI and local cannot drift apart"
    - "Negative-control proof (a deliberately-violating commit on a throwaway branch, observed red, branch deleted) as the standing pattern for proving any gate has teeth, not just asserting its config exists"

key-files:
  created:
    - .github/workflows/ci.yml
  modified: []

key-decisions:
  - "Workflow triggers on push with no branch filter (not just main) — Task 2 requires observing a red run on a throwaway branch pushed directly, without a PR; pull_request stays restricted to main, the repo's only merge path"
  - "postgres:18-alpine in the service container, matching docker-compose.yml and the live Railway Postgres major (ghcr.io/railwayapp-templates/postgres-ssl:18) — supersedes 01-RESEARCH.md's illustrative postgres:17 example, which predates that measurement"
  - "Pinned astral-sh/setup-uv@v10.0.1 (exact, no moving major tag exists for this action) and actions/checkout@v7 (moving major tag), both resolved live via `gh api .../releases/latest` this session rather than copied from the research doc's [ASSUMED] placeholder"
  - "Task 2's throwaway branch was cut from this plan's own commit (the tip of worktree-agent-a42461d6398c16d6e), not from local `main` as the plan's literal wording says — this repo is mid-wave-execution and local `main` does not yet contain the CI workflow being tested, so branching from it would produce a push with no workflow to run. Branched from the code that will become main after this wave merges instead; same proof, same throwaway/delete lifecycle"
  - "permissions: contents: read declared at the workflow level — no job needs a secret or write scope (T-01-08)"

patterns-established:
  - "Every CI job step is traceable 1:1 to a tools/gate.sh line — a reviewer diffing the two files can spot drift by eye"

requirements-completed: [OPS-01, OPS-02, OPS-03]

coverage:
  - id: D1
    description: "Four separately-named CI jobs (typecheck-basedpyright, typecheck-mypy, lint-ruff, test-pytest) exist and all four were observed reporting on a real pushed commit"
    requirement: OPS-01
    verification:
      - kind: integration
        ref: "gh run view 33339258259 --json jobs (all four conclusion: success on commit 890529e, branch worktree-agent-a42461d6398c16d6e)"
        status: pass
    human_judgment: false
  - id: D2
    description: "test-pytest job runs alembic upgrade head against a real Postgres 18 service container before pytest, proving the migration path and DB connection on every push"
    requirement: OPS-03
    verification:
      - kind: integration
        ref: "run 33339258259 log: 'postgres service is healthy' -> 'Context impl PostgresqlImpl' (alembic upgrade head, no-op chain) -> '7 passed'"
        status: pass
    human_judgment: false
  - id: D3
    description: "The workflow goes red for a banned-construct violation (basedpyright reportExplicitAny, ruff TID251) and for a failing test, with the rule codes visible in the log"
    requirement: OPS-02
    verification:
      - kind: integration
        ref: "run 33339378463 (branch ci-negative-control, deleted after capture): typecheck-basedpyright and lint-ruff conclusion: failure naming reportExplicitAny / TID251; test-pytest conclusion: failure, '1 failed, 6 passed'; typecheck-mypy conclusion: success (expected — mypy's disallow_any_explicit is deliberately not enabled, per pyproject.toml's own D-05 comment; basedpyright owns Any-detection)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-30
status: complete
---

# Phase 1 Plan 02: CI Gate Summary

**Four separately-named GitHub Actions jobs (typecheck-basedpyright, typecheck-mypy, lint-ruff, test-pytest) with a Postgres 18 service container, observed green on a real push and red on a deliberate throwaway violation.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-30T22:28:00Z (approx, first tool call)
- **Completed:** 2026-08-30T22:33:00Z
- **Tasks:** 2
- **Files modified:** 1 (`.github/workflows/ci.yml`; two more files touched transiently on the deleted `ci-negative-control` branch, never present on this branch)

## Accomplishments

- `.github/workflows/ci.yml` — four jobs named exactly `typecheck-basedpyright`, `typecheck-mypy`, `lint-ruff`, `test-pytest`, each running the identical command `tools/gate.sh` runs for that tool
- `test-pytest`'s `services: postgres` container pinned to `postgres:18-alpine`, matching `docker-compose.yml` and the live Railway Postgres major
- Pushed a real commit and observed all four jobs report `success` — run [33339258259](https://github.com/ChiragThesia/morai-trading-dashboard-and-tools/actions/runs/33339258259), SHA `890529ee8cf378a3da7ec0b81abccee98cf8dfb6`
- Proved the workflow can fail: a throwaway `ci-negative-control` branch carrying a `typing.Any`-annotated parameter and one inverted test assertion produced a red run — [33339378463](https://github.com/ChiragThesia/morai-trading-dashboard-and-tools/actions/runs/33339378463), SHA `8f09c2784a5c76df021ae74996865b5b72e1a70c` — then the branch was deleted, remote and local

## Task Commits

1. **Task 1: Four named jobs, a Postgres service container, and proof all four report** - `890529e` (feat)
   - Adds `.github/workflows/ci.yml`. Verified locally first (`ruff check`, `ruff format --check`, `basedpyright`, `mypy src tests` — all clean; `actionlint .github/workflows/ci.yml` — clean), then pushed and observed on GitHub.
2. **Task 2: Prove the workflow goes red for both reasons it must** - `8f09c27` on the now-deleted `ci-negative-control` branch (test), reverted by branch deletion — no commit remains on this branch or on `main`
   - Nothing to commit here on `worktree-agent-a42461d6398c16d6e`: the violating commit lived only on the throwaway branch, by design, and was deleted after its red run was captured.

**Plan metadata:** (this commit)

_Note: Task 2 intentionally leaves no lasting commit on this branch — the violation and the proof it produced are the artifact, and both are captured above rather than merged._

## Files Created/Modified

- `.github/workflows/ci.yml` — the CI gate: four named jobs, the `test-pytest` Postgres 18 service container, `alembic upgrade head` before `pytest`

## Decisions Made

- **Push trigger has no branch filter.** Task 2 requires a red run on a branch pushed directly (no PR), so `on: push` covers all branches; `on: pull_request` stays restricted to `main`, matching the repo's only merge path.
- **`postgres:18-alpine`**, not the `01-RESEARCH.md` illustrative example's `postgres:17` — the researcher's yaml snippet predates the orchestrator's later measurement that Railway's live Postgres runs major 18 (`ghcr.io/railwayapp-templates/postgres-ssl:18`), which `docker-compose.yml` already reflects. The workflow follows the measured value, not the stale example.
- **Action versions resolved live**, not copied from the research doc's `[ASSUMED]`-flagged pin: `astral-sh/setup-uv@v10.0.1` (exact — no moving major tag exists for this action, confirmed via `gh api .../git/refs/tags`) and `actions/checkout@v7` (moving major tag exists, used).
- **Task 2's throwaway branch was cut from this plan's own branch tip, not from local `main`.** The plan's literal wording says "branch from main," which presumes a world where the CI workflow already lives on main. This repo is mid-wave execution: local `main` does not yet contain `.github/workflows/ci.yml` (it lands there when this wave merges), so a branch cut from local `main` would push with no workflow to trigger. Cut `ci-negative-control` from `worktree-agent-a42461d6398c16d6e`'s tip instead — the code that becomes `main` after this wave — which preserves the proof's substance (a real branch, a real red run, deleted after) without a no-op push.
- **`permissions: contents: read`** declared at the workflow level, satisfying T-01-08 — no job needs a secret or a write scope.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs or missing critical functionality found; the workflow worked as designed on both the green and red runs.

**1. [Rule 4-adjacent, but not architectural — a scoping correction, documented rather than silently applied] Negative-control branch base**

Not a Rule 1-3 auto-fix and not a Rule 4 architectural change — it's a factual constraint (local `main` doesn't yet have this workflow) that made the plan's literal "branch from main" instruction inapplicable as written. Resolved by branching from the equivalent, correct base (this plan's own commit) and documenting the substitution above rather than silently complying with wording that would have produced no observable run. Recorded here per `.claude/rules/workflow.md`'s "if something goes sideways mid-task: stop and re-plan," applied at the single-decision scale rather than escalating a two-line branch-base substitution to a full checkpoint.

---

**Total deviations:** 1 (scoping correction, not a code defect)
**Impact on plan:** None on substance — both success criteria in `<verify>` were met with real evidence; only the throwaway branch's starting point differed from the plan's literal wording, for a reason specific to this wave-based execution model.

## Issues Encountered

None — local gate was green before pushing (`ruff check`, `ruff format --check`, `basedpyright`, `mypy src tests`, `actionlint` all clean), both GitHub Actions runs completed within about a minute each, and cleanup (branch delete, checkout back to the agent branch) left the working tree in the same state it was in before Task 2 started (`git status --short` empty, confirmed).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The four exact job-name strings (`typecheck-basedpyright`, `typecheck-mypy`, `lint-ruff`, `test-pytest`) are confirmed correct and observed reporting — plan 01-10's branch ruleset can reference them verbatim with no risk of the silent-forever-pending failure mode the plan's objective warned about.
- `test-pytest`'s Postgres 18 service container is the project's first working database-backed test environment; later phases' `@pytest.mark.db` tests route through it.
- Plan 01-10 still needs the actual ruleset created (`gh api .../rulesets -X POST`) and the branch-strategy flip in `.planning/config.json` (D-16) — this plan only proves the workflow the ruleset will reference; it does not create the ruleset itself.
- No blockers.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-08-30*

## Self-Check: PASSED

- FOUND: `.github/workflows/ci.yml`
- FOUND: `.planning/phases/01-walking-skeleton/01-02-SUMMARY.md`
- FOUND: commit `890529e` in `git log --all`
- Commit `8f09c27` (Task 2's negative control) is intentionally absent — its branch was deleted
  by design after its red run was captured on GitHub; the run itself (33339378463) remains the
  durable evidence, cited above by run ID and SHA.
