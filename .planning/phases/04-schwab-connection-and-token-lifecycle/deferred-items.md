# Deferred Items -- Phase 4

Out-of-scope discoveries, logged per the executor's scope-boundary rule rather than
fixed quietly.

## 1. The "intermittent suite flake" was two agents sharing one database -- RESOLVED, not deferred

**Status:** Diagnosed and closed 2026-08-31. This entry originally recorded the flake as
"pre-existing" and unexplained. That conclusion was wrong. It is kept here, corrected,
because the wrong diagnosis is the useful part.

**What 04-02 saw:** running `bash tools/gate.sh` produced a scattered, run-to-run-varying
set of failures across `db`-marked tests in files 04-02 never touched --
`test_account_deletion.py`, `test_login_logout.py`, `test_setup_tokens.py`,
`test_nonce_uniqueness.py`, `test_tracer_encrypted_fill.py`, `test_isolation.py` and
others. Failure shapes were `NoResultFound` on a freshly-provisioned user's own DEK, and
a login route returning 401 for a request the test had just authenticated.

**What 04-02 concluded, and why it was wrong:** it re-ran with its own two new test files
excluded, saw the same class of failures, and concluded the flake was pre-existing and
probably `pytest-randomly` ordering. The control was sound as far as it went. It ruled out
04-02's own files. It did not rule out the other agent.

**The actual cause:** 04-02 and 04-03 ran as parallel worktree executors at the same time.
A git worktree isolates the filesystem. It does not isolate the database. Both agents ran
`uv run pytest` against the same literal local Postgres -- `postgresql://morai:morai@localhost:5432/morai`
-- so each was truncating and re-seeding shared tables underneath the other's transactions.
04-03 observed the same collision from the other side, as `UniqueViolationError` and
`DeadlockDetectedError` on shared tables, and traced it to the sibling worktree.

**The measurement that settles it:** after both worktrees merged and no agent was running,
the suite was run four times in a row on the merged tree -- once via `bash tools/gate.sh`
(exit 0, 267 passed, ruff/basedpyright/mypy clean) and three more times via
`uv run pytest -q`. All four were green. Zero failures, zero errors. The scattered
failures appear only under concurrent execution and never under serial execution.

**What this costs, and the rule it implies:** a locally green gate is still evidence, but
a gate run *while another agent is executing* is not evidence of anything. Parallel plans
in a wave are safe when they touch disjoint files -- which the orchestrator does check --
and unsafe the moment two of them run DB-backed tests, which it does not check. Either
give each worktree its own database (`DATABASE_URL` suffixed per worktree, created and
dropped around the run), or serialise the DB-backed portion of parallel waves. Until one
of those exists, treat a red suite observed during a parallel wave as unproven until it
is reproduced serially.

**Not deferred:** no code change is owed from Phase 4. The infrastructure change above is
owed by whichever future phase next touches test infrastructure or wave parallelism.
