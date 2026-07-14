---
phase: 39
slug: market-regime-rail-all-rows-as-gauges-teaching-tooltips-rate
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-13
---

# Phase 39 — Validation Strategy

No RESEARCH.md exists for this phase — `39-UI-SPEC.md` (rev 2, APPROVED) is the spec. This file
formalizes the Nyquist test map so the plan-checker gate is satisfied (the gap that blocked
phases 37 and 38 at their checkers). Requirement IDs are the GAUGE-01..05 set minted at planning;
every plan's `<verify>` provides the automated command referenced below.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace: contracts/server/web) + Testing Library (`@testing-library/react`, `user-event`) + fast-check (gauge clamp property) |
| **Quick run** | `bun run test -- --run <file>.test.tsx` |
| **Full suite** | `bun run test` (whole Vitest workspace) |
| **Workspace typecheck** | `bun run typecheck` (contracts/core/adapters/server) |
| **App typecheck** | `cd apps/web && bunx tsc --noEmit` — apps/web carries 8 PRE-EXISTING standing errors (38-07-SUMMARY); the gate expects NO NEW error referencing a Phase-39 file, count ≤ 8 |
| **Lint** | `bun run lint` (no `any`/`as`/`!`, no floating promises) |
| **Note** | jsdom honesty (catch #20): COT tests use the existing mixed-sign fixture (netDealer −756K short, netAssetManager +993K long) — a genuine data point, not a doctored one; tooltip assertions use distinctive VERBATIM substrings from the UI-SPEC so a paraphrase fails. |

## Sampling Rate

- **Per task commit:** the touched component's quick-run command.
- **Per wave merge:** full `bun run test`.
- **Phase gate (39-04):** full suite + `bun run typecheck` + `cd apps/web && bunx tsc --noEmit`
  (no new errors) + `bun run lint`, then the cross-cutting law greps; the acceptance bar is the
  desktop human UAT on morai.wtf (all rows as gauges, tooltips teach, no verdict color on any
  neutral track).

## Per-Requirement Verification Map

| Requirement | Behavior validated | Test file / command | Test Type |
|-------------|--------------------|---------------------|-----------|
| GAUGE-01 | BulletGauge renders a role=meter track; banded = [warn, crisis, marker] children at clamped positions; neutral = marker only (no band segments); separate testId/markerTestId; marker `left` ∈ [0,100] for any value/min/max | `bun run test -- --run apps/web/src/components/system/BulletGauge.test.tsx` (39-01 T2) | Vitest + Testing Library + fast-check |
| GAUGE-01 | The 4 regime rows render through BulletGauge with IDENTICAL DOM/testids/aria/marker-color/band-segment positions — the existing suite passes UNMODIFIED (zero-visual-change regression guard); `git diff --quiet` on the test file | `bun run test -- --run apps/web/src/components/RegimeBoard.test.tsx` (39-01 T3) | Vitest regression guard |
| GAUGE-02 | Fed Funds/SOFR/1M/3M render neutral `bg-dim` markers with NO band-segment children and NEVER a verdict color; 10Y−2Y/10Y−3M render banded from RATE_BANDS at the documented thresholds (calm >0 / warning ≤0 / crisis ≤−0.50) at boundary values; printed rate values unchanged | `bun run test -- --run apps/web/src/components/RegimeBoard.test.tsx` (39-02 T1) | Vitest + Testing Library |
| GAUGE-03 | The 5 COT rows render neutral gauges with a sign-tinted marker (bg-up net≥0 / bg-down net<0, never bg-amber), no band segments, per-class axis; WoW arrows + signed values unchanged; net/WoW at 11px | `bun run test -- --run apps/web/src/components/CotCard.test.tsx` (39-03 T1) | Vitest + Testing Library |
| GAUGE-04 | Regime + rate ⓘ tooltips render the 4-part WHAT/WHY/BANDS/SOURCE verbatim (regime rows keep server source/rationale as SOURCE); rate neutral BANDS reads "position only", banded reads thresholds | `bun run test -- --run apps/web/src/components/RegimeBoard.test.tsx` (39-02 T2) | Vitest + user-event |
| GAUGE-04 | COT ⓘ tooltips render the 4-part structure with verbatim UI-SPEC copy + "position only" BANDS; footnote at 10px | `bun run test -- --run apps/web/src/components/CotCard.test.tsx` (39-03 T2) | Vitest + user-event |
| GAUGE-05 | t10y2y/t10y3m inversion bands documented in the evidence table (cited rationale + [ASSUMED] crisis tier) BEFORE any component encodes them | `grep -Eiq 't10y2y' docs/architecture/regime-board.md && grep -Eiq 't10y3m' … && grep -Eiq '\[ASSUMED\]' …` (39-01 T1) | Doc-presence grep |
| GAUGE-05 | RATE_BANDS is a client-visual-only display band — the picker gate/regime resolution take ZERO new inputs (display constants confined to the two display components) | `grep -rEn 'RATE_BANDS\|RATE_GAUGE_SCALE\|COT_GAUGE_SCALE' apps/web/src apps/server/src packages` matches ONLY RegimeBoard.tsx + CotCard.tsx (39-04 gate) | Negative grep |
| GAUGE-01..05 | Integration gate: full suite + workspace typecheck + apps/web tsc (no new errors) + lint + cross-cutting greps; deploy; desktop UAT on morai.wtf | 39-04 gate commands + `checkpoint:human-verify` | full suite + human-verify |

## Cross-Cutting Negative Assertions (every layer)

- **Neutral never verdict-colored:** a neutral rate marker is `bg-dim` for ALL values and a COT
  marker is only `bg-up`/`bg-down` (never `bg-amber`, never `bg-txt`) — asserted in RegimeBoard.test
  and CotCard.test. The evidence law: no verdict color without documented research.
- **Gate blind:** `RATE_BANDS`/`RATE_GAUGE_SCALE`/`COT_GAUGE_SCALE` appear ONLY in the two display
  components — never in a gate/regime-resolution/hook/server/core file (39-04 grep). The picker gate
  gains no new inputs.
- **Docs before code:** the t10y2y/t10y3m evidence-table rows + [ASSUMED] disclosure exist in
  `docs/architecture/regime-board.md` (written in 39-01 Task 1, before any band is encoded in 39-02).
- **Tooltip copy verbatim:** distinctive locked substrings from the UI-SPEC payload are asserted
  present per row-type (regime/rate/COT) — a paraphrase or invented financial claim fails.
- **Zero visual change on extraction:** `git diff --quiet apps/web/src/components/RegimeBoard.test.tsx`
  after 39-01 (the existing gauge/aria/marker/segment assertions gate the refactor).
- **Display-live / gate-EOD untouched (Phase 38 law):** the RegimeBoard live-display path
  (liveValue/liveBand, GateChip, hy-oas FRED-only) is unchanged — the existing Phase-38 live tests
  stay green in the RegimeBoard suite.
- **No new dependency:** no `shadcn add`, no npm/bun install anywhere in the phase.

## Wave 0 Requirements

- [ ] `apps/web/src/components/system/BulletGauge.test.tsx` — NEW (39-01 T2, RED-first unit +
  fast-check suite for the extracted presentational track). Every other test file already exists
  and is EXTENDED: `RegimeBoard.test.tsx` (kept UNMODIFIED by 39-01; extended by 39-02),
  `CotCard.test.tsx` (extended by 39-03).
- [ ] Framework install: none — Vitest / Testing Library / user-event / fast-check are all
  configured already (used across the existing web suites).

## Known Weaker Gate (accepted)

The gauge tint and one-rhythm typography a human reads on the desktop rail cannot be fully proven
in jsdom (className assertions verify the tokens, not the rendered pixels). The constructible proxy
is the per-row className/aria assertions in the unit suites; the true confirmation is the 39-04
blocking human-verify UAT on morai.wtf (all rows as gauges, neutral tracks visibly distinct from
banded, no verdict color on any neutral row).
