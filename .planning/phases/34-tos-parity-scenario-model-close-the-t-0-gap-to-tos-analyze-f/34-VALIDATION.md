---
phase: 34
slug: tos-parity-scenario-model
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-11
---

# Phase 34 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace `test.projects`) + fast-check (numerical property tests, per `.claude/rules/tdd.md`) + testcontainers (Postgres repo changes) |
| **Config** | `apps/web/vitest.config.ts` (jsdom); `packages/*/vitest.config.ts` (node) — existing, unchanged |
| **Quick run command** | `cd apps/web && bunx vitest run src/lib/scenario-engine.test.ts src/lib/pair-calendars.test.ts` (client); `cd packages/core && bunx vitest run src/analytics/domain/implied-carry.test.ts` (server) |
| **Full suite command** | `bun run test` (root workspace) |
| **Note** | Money-path phase: every math change requires a hand-computed oracle FIRST (settlement offset table, hand-solved parity example, fractional-T BSM values) — never a value compared to itself |

## Sampling Rate

- **Per task commit:** the touched file's quick-run command (above).
- **Per wave:** `bun run test` (full workspace).
- **Phase gate:** full suite + typecheck + lint green before verify; the phase's
  acceptance bar is the RTH UAT measurement (live marks, BE-today vs TOS Analyze on
  the same book) recorded in the UAT doc per CONTEXT.md — orchestrator/user-driven,
  not an executor task.

## Per-Task Verification Map

REQ IDs assigned at planning: TOSP-01 (fractional settlement-aware DTE),
TOSP-02 (parity-implied per-expiry carry), TOSP-03 (smile-IV researched decision
recorded), TOSP-04 (RTH parity measurement gate).

| Requirement | Concern | Test file / command | Test Type |
|-------------|---------|---------------------|-----------|
| TOSP-01 | Settlement-timestamp helper: AM-settled 3rd-Friday SPX → 09:30 ET anchor (A1, one flagged constant); PM/SPXW/other → 16:00 ET; DST-safe across an EST/EDT boundary | `vitest run packages/shared/src/settlement-timestamp.test.ts` (34-01) | unit: hand-computed offset table + fast-check round-trip |
| TOSP-01 | `pair-calendars.ts` `dteExact()`: whole-day `dte()` unchanged; exact variant matches the settlement helper; degrades to `dte()` on unparseable OCC | `vitest run apps/web/src/lib/pair-calendars.test.ts` (34-02) | unit |
| TOSP-01 | Kernel parity: `repriceScenario` with `frontDteExact/backDteExact` equals direct `bsmPrice`/`bsmGreeks` at the same independently-computed fractional T; `/365 → /365.25` divisors | `vitest run apps/web/src/lib/scenario-engine.test.ts` (34-02) | unit oracle (extends existing kernel-parity block) |
| TOSP-02 | Parity solver round-trip: synthetic C/P priced with a KNOWN q via `bsmPrice` → `impliedDivYield` recovers it within tolerance; `rhs <= 0`/non-finite guards return `null`, never NaN | `vitest run packages/core/src/analytics/domain/implied-carry.test.ts` (34-03) | unit oracle + fast-check property |
| TOSP-02 | `readLegObsForGex` widened with `mark`: Postgres SELECT + in-memory twin agree (rule 8) | contract test extension under `packages/adapters` (34-03; exact file pinned by executor grep for `readLegObsForGex`) | integration (testcontainers) |
| TOSP-02 | `impliedCarry` additive nullable contract field: old fixtures (field absent) still parse; migration 0023 matches the 0008–0022 pattern; compute in `computeGexSnapshot` (FRED r + parity q) degrades to null; HTTP GEX route + get_gex MCP both carry it (rule 9) | `vitest run packages/contracts/src/gex.test.ts` + core/server suites (34-04) | unit + route tests |
| TOSP-02 | `resolve-carry.ts`: pure lookup; degrades to `DEFAULT_RATE`/`DEFAULT_DIV` when gex data is undefined/stale or the expiry has no entry | `vitest run apps/web/src/lib/resolve-carry.test.ts` (34-05) | unit |
| TOSP-03 | Smile-IV DO-NOT-BUILD decision recorded with the TOS Individual-IV rationale | phase docs (34-05) | docs check |
| TOSP-04 | Full gate + UAT hook: suite/typecheck/lint green; before/after BE-gap table scaffolded for the RTH measurement | `bun run test` + `bun run typecheck` + `bun run lint` (34-05) | full suite + gate |

## Wave 0 Requirements

New infrastructure delivered by the plans before dependents run:

| Wave 0 item | Closed by |
|-------------|-----------|
| `packages/shared/src/settlement-timestamp.ts` + `.test.ts` (new pure module) | 34-01 |
| `packages/core/src/analytics/domain/implied-carry.ts` + `.test.ts` (new pure module; fast-check already a workspace dep) | 34-03 |
| Contract-test fixture extension for the widened GEX leg-obs read (`mark` column) — concrete repo file = `packages/adapters/src/postgres/gex-snapshot.repo.ts` (checker-confirmed; NOT `leg-observations.ts`) | 34-03 |
| `apps/web/src/lib/resolve-carry.ts` + `.test.ts` (new pure lookup) | 34-05 |

## Security Domain

Minimal new attack surface: no new user-input parsing, no new auth surface; the one
new field is server-computed from already-ingested, Zod-validated chain data. The one
threat pattern that applies: degenerate chain data (mark ≤ 0 / non-finite) must never
propagate NaN into `bsmPrice` — explicit guards return `null` and the client falls
back to `DEFAULT_DIV` (covered by the TOSP-02 solver tests above).

## Manual-Only Verifications

| Behavior | Why Manual | Instructions |
|----------|------------|--------------|
| BE-today gap vs TOS Analyze within a few points | Requires live RTH marks + the user's TOS session on the same book | During RTH, compare BE today pills on morai.wtf vs TOS Analyze breakevens; record before (7421/7673 vs 7413.21/7690.62) and after in the UAT table (34-05 hook) |
| A1 anchor sanity (AM-settle T=0 = Friday market open) | Reasoned-not-cited assumption | If measured AM-settled legs still drift, flip the single flagged constant in settlement-timestamp.ts and re-measure |
