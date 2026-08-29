---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "!node_modules/**"
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

Applies to: domain and numerical code, adapter logic, and UI component logic (hooks, data
transforms).
Exempt: pure wiring in composition roots, static config, docs, styling-only UI tweaks.

There is no code in this repo today, so this rule is dormant. It wakes with the first `.ts` file
of the rebuild.

## Where to Look

- [docs/learnings/process-and-verification.md](../../docs/learnings/process-and-verification.md) - 39 entries on how verification actually failed here, including the green-suite family
- [salvage/invariants.md](../../salvage/invariants.md) - 130 invariants recovered from 59 property-test files, stated independently of any framework
- [salvage/oracle-fixtures.md](../../salvage/oracle-fixtures.md) - the 13 ground-truth calendars any fill-pairing implementation must pass before it touches money

Two cautions carried from v1, both earned: a property test can generate the adversarial input and
then assert on the wrong output, and a property test's own expected-value reconstruction can encode
the same bug as the implementation. A green suite is evidence, not proof — this project shipped
production bugs past green suites at least ten times.
