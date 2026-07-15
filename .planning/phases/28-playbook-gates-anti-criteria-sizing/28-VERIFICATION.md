---
phase: 28-playbook-gates-anti-criteria-sizing
verified: 2026-07-09T13:10:00Z
status: passed
score: 5/5 truths verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run the app (server + web, or morai.wtf) and confirm the RegimeBoard's entry-gate tile shows current VIX, VIX/VIX3M ratio, asOf, and state; force/observe GATE BLIND and confirm it reads visibly louder than a plain BLOCKED tile."
    expected: "Gate tile renders live values; GATE BLIND uses the filled bg-downd/ring-down alarm treatment, distinct from BLOCKED's plain text-down."
    why_human: "Visual/perceptual judgment (is the treatment actually 'louder') on a live or near-live surface — a unit test can assert the CSS class exists, not that a human perceives it as an alarm."
  - test: "On the Analyzer, confirm the entry plan's 'Recommended sizing' row shows a tier + contract count matching the current cohort VIX (e.g. VIX ~18 -> Normal -> 2 contracts)."
    expected: "Sizing row reflects live snapshot data, not a placeholder."
    why_human: "Requires a live/near-live snapshot to eyeball; component tests already prove the render logic, not the live value."
  - test: "Confirm or correct the [ASSUMED] gate-band edges (VIX penalty 20-25/block >=25, disarm <19/<24; ratio penalty 0.90-0.95/block >=0.95, disarm <0.89/<0.93) and the [ASSUMED] sizing counts (Low 2 / Normal 2 / Elevated 1 / Crisis 0) against TOS-tested priors."
    expected: "User types 'approved' or supplies corrected values (editable named constants in entry-gate.ts / sizing.ts)."
    why_human: "28-CONTEXT.md explicitly requires user confirmation of these product-taste values at UAT — this is 28-06's Task 3 checkpoint:human-verify (gate=\"blocking\"), which the plan itself marks as orchestrator-owned and NOT executed during plan execution (see 28-06-SUMMARY.md's own 'PENDING-USER-UAT' section)."
---

# Phase 28: Playbook Gates, Anti-Criteria & Sizing Verification Report

**Phase Goal:** The picker inherits the rest of the user's playbook — it computes nothing new to
enter when the market itself says don't, brakes on the user's own risk rules, and sizes and
buckets trades the way he already does by hand.
**Verified:** 2026-07-09
**Status:** passed — human items resolved via 28-UAT.md (user-confirmed 2026-07-10)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Picker computes nothing new to enter at VIX ≥25 or ratio ≥0.95, banded with hysteresis; board reflects gate state | ✓ VERIFIED | `resolveEntryGate` (`packages/core/src/picker/domain/entry-gate.ts:245-313`) — `VIX_BLOCK_ARM=25/DISARM=24`, `RATIO_BLOCK_ARM=0.95/DISARM=0.93`, penalty floors 20/0.90, linear 1.0→0.3 band, worst-first rung walk with self-read hysteresis via `reasons` tags. Wired once-per-cohort in `computePickerSnapshot.ts` Step 3c/3d/6 (`candidates: []` on blocked/blind, `gate` object persisted). `RegimeBoard.tsx`'s `GateChip` renders state/vix/ratio/asOf/brakes from `PickerSnapshotResponse.gate`, with GATE BLIND given the `bg-downd`/`ring-down` filled alarm treatment. 75+150 targeted tests + full 2761-test suite green; typecheck/lint clean. |
| 2 | Brakes: max-open 6, cooldown ≥25%→2bd; trend filter is a documented deferred row | ✓ VERIFIED | `brakes.ts`: `MAX_OPEN_CALENDARS=6` (`maxOpenTripped` true at 6, false at 5), `LOSS_COOLDOWN_PCT=-0.25`/`COOLDOWN_BIZDAYS=2` (`cooldownActive` guards 0-debit/null-pnl). `ForReadingRecentClosedCalendars` — single Postgres JOIN + in-memory twin, contract-tested for parity. Both brakes route through `resolveEntryGate`'s `maxOpenBrake`/`cooldownBrake` params. `docs/architecture/playbook-gates.md` §122 "Deferred: sustained-trend brake" documents the full rationale (crisis gates cover vol danger, deltaNeutral+GAMMA/STOP cover directional blowthrough, n=13 no calibration basis). |
| 3 | Discrete user-set contract counts per VIX tier, never derived | ✓ VERIFIED | `sizing.ts`'s `SIZING_TIERS` — named-constant registry (`DEFAULT_TIER_CONTRACTS`: low 2, normal 2, elevated 1, crisis 0) importing `VIX_LADDER` from `entry-gate.ts` (one shared ladder, asserted by test). `resolveSizingTier` is a pure lookup, `[ASSUMED]`-flagged. Wired onto `PickerSnapshot.sizing` from the same cohort `gate.vix`; rendered read-only on `EntryExitPlan.tsx`'s "Recommended sizing" row. |
| 4 | Short-gap (3-10d) event calendars scored via separate event-appropriate rule set | ✓ VERIFIED | `selectEventCandidates` — thin `[3,10]`d-gap wrapper over `selectCandidates`, post-filtered to `backEvents.length > 0`; omitting gap params reproduces the primary universe byte-identically (tested). `EVENT_RULE_SET_METADATA` — separate registry, `backEventBonus` promoted to weight 10, other 9 weights scaled ×0.9, own sum-100 + refuted-criteria-guard tests green; primary `RULE_SET_METADATA` and its sum-100 test untouched (both suites pass). Event candidates carry `bucket: "event-calendar"` and route through the SAME gate/brake suppression (T-28-15). `CandidateCard.tsx` renders a distinct amber "Event-calendar bucket" label. |
| 5 | autoTuneTargetDelta additive, only after gate infra live | ✓ VERIFIED | Shipped (not deferred) as a universe-membership tilt: `autoTuneTargetDelta(vix)` nudges the band-scan's deep delta edge toward `DELTA_BAND_MAX` as VIX rises through `VIX_LADDER`'s 15-25 range, fast-check-proven to never leave `[DELTA_BAND_MIN, DELTA_BAND_MAX]`; wired via optional `effectiveDeltaMin` on `selectCandidates`, called from `computePickerSnapshot.ts` using `gate.vix` (the gate infra from Plan 03, sequenced after by wave order: Plan 04 `depends_on: ["28-01","28-03"]`). Never a `RULE_SET_METADATA` weight. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/picker/domain/entry-gate.ts` | resolveEntryGate, VIX_LADDER, hysteresis, GATE BLIND | ✓ VERIFIED | Matches plan spec verbatim (arm/disarm constants, noon-UTC `businessDaysSince` fix, brake passthrough) |
| `packages/core/src/picker/domain/brakes.ts` | maxOpenTripped/cooldownActive/cooldownCutoff | ✓ VERIFIED | 6 / -25% / 2bd constants confirmed in source |
| `packages/adapters/src/postgres/repos/calendar-events.ts` + memory twin | ForReadingRecentClosedCalendars, single JOIN | ✓ VERIFIED | Contract-tested for row parity (14 tests) |
| `packages/core/src/picker/application/computePickerSnapshot.ts` | Steps 3c/3d/4b/6 gate wiring | ✓ VERIFIED | Gate computed once per cohort; fail-closed on any of 3 new reads erroring (`GATE_READ_ERROR` synthetic, never propagated `err()`); `entriesAllowed` gates `candidates: []` while termStructure/gex/events stay populated |
| `packages/core/src/picker/domain/sizing.ts` | SIZING_TIERS, resolveSizingTier | ✓ VERIFIED | Imports VIX_LADDER; half-open [min,max) lookup; null-honest on non-finite vix |
| `packages/core/src/picker/domain/rules.ts` (EVENT_RULE_SET_METADATA) | Separate sum-100 registry | ✓ VERIFIED | `event-rules.test.ts` + `rules.test.ts` both green; primary weights untouched |
| `apps/web/src/components/RegimeBoard.tsx` | Gate chip, loud GATE BLIND | ✓ VERIFIED | `GateChip` component reads `usePicker().gate`; blind uses `bg-downd`/`ring-down` |
| `apps/web/src/components/picker/EntryExitPlan.tsx` | Sizing row | ✓ VERIFIED | "Recommended sizing" row, `formatSizing`, null-honest "No recommendation" |
| `apps/web/src/components/picker/CandidateCard.tsx` | Event-bucket label | ✓ VERIFIED | `bucket-label-{id}` testid, amber "Event-calendar bucket" text |
| `apps/server/src/adapters/mcp/tools.ts` | get_picker_candidates description | ✓ VERIFIED | Description text names gate/sizing/bucket fields (grep-confirmed, line 585) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| entry-gate.ts VIX_LADDER | sizing.ts SIZING_TIERS | `import { VIX_LADDER } from "./entry-gate.ts"` | WIRED | One shared ladder, asserted by test |
| brakes.ts booleans | resolveEntryGate | `maxOpenBrake`/`cooldownBrake` params | WIRED | Passthrough unconditional; brake named in `reasons` |
| resolveEntryGate previousState | Postgres `picker_snapshot.gate.reasons` | `toEntryGateState`/`toPickerGate` round-trip | WIRED | Genuine round-trip test (`hysteresis: a held-blocked previous state stays blocked`) — persisted `reasons` array feeds `previousLabelFor`'s self-read, not just an in-process object reference |
| computePickerSnapshot gate.vix | sizing + autoTuneTargetDelta | shared cohort read | WIRED | One macro read per cycle; both consumers null-propagate identically on GATE BLIND/cold-start |
| selectEventCandidates | resolveEntryGate/brake suppression | same Step 6 override | WIRED | `computePickerSnapshot.test.ts` — event-calendar bucket suppressed on blocked/blind/braked cohort |
| PickerSnapshotResponse.gate/sizing/candidate.bucket | UI components | plain props, no recomputation | WIRED | Grep-confirmed: RegimeBoard/EntryExitPlan/CandidateCard read only contract fields |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Targeted phase-28 unit/property suites | `bun run vitest run entry-gate.test.ts brakes.test.ts sizing.test.ts event-rules.test.ts` | 4 files, 75 tests passed | ✓ PASS |
| Wiring + contract + UI suites | `bun run vitest run computePickerSnapshot.test.ts picker.test.ts candidate-selection.test.ts RegimeBoard.test.tsx EntryExitPlan.test.tsx CandidateCard.test.tsx` | 6 files, 150 tests passed | ✓ PASS |
| Full workspace suite (run once) | `bun run test` | 265 files, 2761 tests passed (exceeds SUMMARY's claimed 2747+) | ✓ PASS |
| Typecheck | `bun run typecheck` | clean | ✓ PASS |
| Lint | `bun run lint` | clean (only pre-existing boundary-selector-syntax warning, no errors) | ✓ PASS |
| Commit hashes referenced across all 6 SUMMARYs | `git cat-file -e <hash>` × 15 | all present | ✓ PASS |

### Scrutinized Items (per verification_rules)

1. **28-03 deviation 1 — reasons field for hysteresis persistence.** Confirmed genuine, not
   cosmetic: `pickerGate.reasons` is Zod-validated on both write and read at the Postgres
   picker-snapshot repo boundary (parse-don't-cast), so a field omitted from the schema would be
   silently stripped and hysteresis would reset every cycle. `computePickerSnapshot.test.ts`'s
   "hysteresis: a held-blocked previous state stays blocked" test constructs a `PickerGate` with
   `reasons: ["vixBlocked", "ratioBlocked"]`, feeds it through `previousSnapshotWithGate` (the
   `readPickerSnapshot` fake), and asserts the NEXT cycle (VIX 24.5, below fresh-arm 25 but above
   disarm 24) stays `blocked` — this only passes if `toEntryGateState` actually reconstructs
   `reasons` from the persisted row and `previousLabelFor` reads it. Verified by direct code read
   (`computePickerSnapshot.ts:202-213`) and by the passing test — round-trip is real, not asserted
   only via same-object reference.
2. **28-06 deviation 3 — Overview.test.tsx usePicker mock.** Confirmed as a legitimate regression
   fix, not a stub-out: `RegimeBoard` now calls `usePicker()` for the gate tile; `Overview.test.tsx`
   already mocks every hook `Overview`'s children use to avoid needing a `QueryClientProvider`.
   The added mock (`{ data: undefined, isPending: false, isError: false }`) mirrors the existing
   `useRegimeBoard` mock exactly and does not fabricate gate data — it renders the board with no
   snapshot (gate tile correctly omitted), consistent with the "never a fabricated chip" (T-24-09)
   convention already governing the rest of the board.
3. **Noon-UTC bizday fix (28-01).** Confirmed as a real correctness fix, not busywork:
   `businessDaysSince` probes each candidate day at noon UTC before calling `isNyseHoliday`
   (which formats in `America/New_York`) — a UTC-midnight probe would resolve to the PREVIOUS ET
   calendar day for 4-5 hours (DST-dependent), silently missing holidays like New Year's Day.
   Verified in source (`entry-gate.ts:112-126`) and covered by dedicated Labor Day/Thanksgiving
   business-day tests in `entry-gate.test.ts` (part of the 75 passing targeted tests above).

### Anti-Patterns Found

None in the phase-28 files reviewed. No `TBD`/`FIXME`/`XXX` markers in any of the created/modified
files across the 6 plans. `[ASSUMED]` markers on the gate-band penalty floors, hysteresis disarm
widths, sizing tier edges, and sizing contract counts are intentional and match 28-CONTEXT.md's
explicit "Claude's Discretion... user confirms at UAT" scope — these are documented product-taste
defaults awaiting the Task 3 checkpoint below, not undocumented debt.

### Flagged, Not Failed

- **Root `tsconfig.json` missing `apps/web` from its `references` array** — pre-existing (not
  introduced by this phase), documented in
  `.planning/phases/28-playbook-gates-anti-criteria-sizing/deferred-items.md` with a before/after
  error-count diff proving this phase's own changed files introduce zero new `apps/web` typecheck
  errors. Per the verification_rules instruction, this is flagged but does not fail the phase.
- **STATE.md / REQUIREMENTS.md PLAY-01..05 checkboxes still show "Pending"** — process bookkeeping
  only (the known "GSD state milestone drift" pattern noted in project memory: STATE.md/
  REQUIREMENTS.md are hand-fixed at phase close by the orchestrator, not by the executor). Does
  not reflect the actual code state, which is fully wired and tested as documented above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| PLAY-01 | 28-01, 28-03, 28-06 | Market-level crisis gates | ✓ SATISFIED | resolveEntryGate + Step 3c/3d/6 wiring + RegimeBoard gate tile |
| PLAY-02 | 28-02, 28-03 | Anti-criteria brakes | ✓ SATISFIED | brakes.ts + ForReadingRecentClosedCalendars + gate passthrough |
| PLAY-03 | 28-04, 28-06 | VIX-tiered discrete sizing | ✓ SATISFIED | sizing.ts + snapshot field + EntryExitPlan row |
| PLAY-04 | 28-05, 28-06 | Event-calendar bucket | ✓ SATISFIED | selectEventCandidates + EVENT_RULE_SET_METADATA + CandidateCard label |
| PLAY-05 | 28-04 | autoTuneTargetDelta | ✓ SATISFIED | Universe-membership tilt, fast-check clamped, shipped not deferred |

No orphaned requirements — all 5 PLAY-01..05 rows are claimed by at least one plan.

### Human Verification Required

The code-level implementation of all 5 phase-goal truths is complete, tested, and wired. What
remains outstanding is 28-06's own **Task 3 checkpoint:human-verify (`gate="blocking"`)**, which
28-06-SUMMARY.md explicitly documents as NOT executed during plan execution — its own
"PENDING-USER-UAT" section states this is "a human UAT pass the orchestrator owns — not executed
here." Per the phase's own design, the [ASSUMED] gate-band edges and sizing counts require
explicit user sign-off before the phase can be considered fully closed, not just code-complete.

See the frontmatter `human_verification` list for the 3 concrete items (regime board gate tile,
Analyzer sizing row, and the [ASSUMED] boundary confirmation).

### Gaps Summary

No code gaps. All 5 phase-goal truths are implemented, wired, and tested against the actual
codebase (not SUMMARY.md claims alone) — verified independently via direct source reads, targeted
test runs, a full-suite run (2761 tests green, exceeding the claimed 2747+), typecheck, and lint.

The phase is blocked only on its own designed human checkpoint (28-06 Task 3), which was
deliberately deferred to the orchestrator/user and never resolved. This is not a code defect —
it is the phase's intended UAT gate, still open.

---

*Verified: 2026-07-09*
*Verifier: Claude (gsd-verifier)*
