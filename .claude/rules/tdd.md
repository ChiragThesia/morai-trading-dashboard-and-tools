---
paths:
  - "packages/**/*.ts"
  - "apps/**/*.ts"
  - "apps/**/*.tsx"
  - "**/*.test.ts"
---

# TDD Red→Green

**No production code without a failing test that demands it.**

## Requirements

Every change MUST follow the loop:

1. **RED** — write the smallest failing test for the next behavior. RUN IT. Confirm it
   fails for the RIGHT reason (assertion, not import/syntax error). Show the failure output.
2. **GREEN** — minimum code to pass. RUN IT. Show the pass.
3. **REFACTOR** — only with the suite green. Re-run after.
4. Commit only at green. Never commit with a failing suite.

MUST NOT:

- Write implementation first, tests after. "Test-after" is not TDD — it is forbidden here.
- Claim a test "would fail" without running it.
- Skip the red step because a change is "trivial". Trivial changes have trivial tests.
- Disable or skip a failing test to get green. Fix it or revert the change that broke it.
- Mark work complete without showing the passing test run output.

## Required Test Kinds

- **Bug fix** → starts with a failing regression test reproducing the bug. Always.
- **Numerical code** (greeks, IV inversion, attribution, parsing) → fast-check property
  tests (round-trips, invariants) in addition to example tests.
- **New port** → in-memory implementation + use-case test using it, same PR.
- **Postgres repos** → testcontainers against real Postgres. SQL is never mocked.
- **External HTTP adapters** → msw at the network layer (retry, 429, 401-refresh paths).

## Scope

Applies to: `packages/*`, server/worker adapter logic, UI component logic (hooks, data
transforms).
Exempt: pure wiring in composition roots, static config, docs, styling-only UI tweaks.

## Where to Look

- [docs/architecture/testing-tdd.md](../../docs/architecture/testing-tdd.md) - Test pyramid, stack (Vitest, fast-check, testcontainers, msw), calibration gates
- [docs/architecture/hexagonal-ddd.md](../../docs/architecture/hexagonal-ddd.md) - Why function-type ports make test doubles plain functions
- `.claude/templates/` - Test templates (created with scaffolding)
