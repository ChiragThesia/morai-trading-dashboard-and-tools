# Testing & TDD

**TDD red→green is mandatory in this repo.** Binding rules in `.claude/rules/tdd.md`;
this doc covers strategy and stack.

## The Loop

1. **RED** — write the smallest failing test expressing the next behavior. Run it. **Watch it fail**
   for the right reason (assertion failure, not import error).
2. **GREEN** — write the minimum code to pass. Run it. Watch it pass.
3. **REFACTOR** — clean up with tests green. Run the suite again.
4. Commit at green. Never commit red.

No production code without a failing test that demands it. No test written after the code it tests.

## Test Pyramid

| Level | Scope | Adapters used | Speed | Where |
|---|---|---|---|---|
| Unit | domain functions (greeks math, attribution, OCC parse) | none — pure | ms | colocated `*.test.ts` |
| Use-case | application handlers | `adapters/memory` in-memory ports | ms | colocated |
| Acceptance | whole bounded context wired with memory adapters | memory | ms | `<context>.acceptance.test.ts` at context root |
| Adapter/integration | postgres repos, schwab client | **testcontainers** (real PG), **msw** (HTTP mocks) | s | in `packages/adapters` |
| E2E | browser against running stack | real | min | Playwright — deferred (D10) |

The hexagon makes the fast layers possible: function-type ports mean a test double is a plain
function (`async () => ok(fixture)`) — no mocking framework, ever.

## Stack

- **Vitest** — runner everywhere; one root `vitest.config.ts` with `test.projects`.
- **fast-check** — property-based tests REQUIRED for numerical code: BSM pricing, IV inversion
  (round-trip: price→IV→price), OCC symbol parse/format round-trips, P&L attribution
  (components sum to total minus residual).
- **testcontainers** — real Postgres for repo tests. We do not mock SQL.
- **msw** — Schwab/CBOE/FRED mocked at network layer for adapter tests (retry/backoff paths,
  429 Retry-After parsing, token-refresh-on-401).

## Calibration Gates (lesson from old dashboard — keep)

Numerical correctness pinned to external ground truth, failing CI on drift:

- **TOS fixture gate**: BSM IV inversion vs ThinkorSwim Analyze fixture —
  IV tight (<0.5% relative), greeks loose (<5%), net greeks loose (<5%).
  Tight IV because it's the direct inversion output; greeks inherit IV error.
- New fixture captured per underlying/regime when math changes.
- SPX dividend yield 1.0% calibration constant — covered by the gate.

## Coverage & CI Discipline

- CI: `typecheck → lint (boundaries included) → test → build`. All green or no merge.
- No coverage-percentage worship; instead: every bug fix starts with a failing regression test
  reproducing it (systematic-debugging rule).
- Flaky test = P0 — fix or delete same day; a flaky suite kills TDD.
