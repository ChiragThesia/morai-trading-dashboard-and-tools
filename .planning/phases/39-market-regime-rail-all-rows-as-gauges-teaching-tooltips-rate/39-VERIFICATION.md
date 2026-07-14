---
phase: 39-market-regime-rail-all-rows-as-gauges-teaching-tooltips-rate
verified: 2026-07-14T01:10:00Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  # No — initial verification (no prior 39-VERIFICATION.md existed)
---

# Phase 39: Market Regime rail — all rows as gauges + teaching tooltips Verification Report

**Phase Goal:** Every row on the desktop Market Regime rail reads as a bullet gauge with a teaching ⓘ tooltip. The rates block (Fed Funds/SOFR/1M/3M render neutral position-only tracks with no verdict color; 10Y−2Y/10Y−3M render evidence-banded inversion tracks) and the COT rows (neutral, marker green/red by long/short net) join the four existing regime gauges on one shared BulletGauge, at one visual density. Every ⓘ teaches WHAT the dial measures, WHY it matters for SPX calendar trading, what the BANDS mean (or "position only"), and a quiet SOURCE line — with copy verbatim from the UI-SPEC. The yield-curve bands are client-visual-only (documented in the regime-board evidence doc first); the picker gate stays blind.
**Verified:** 2026-07-14T01:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Shared `BulletGauge` renders a `role="meter"` track with banded + neutral variants, marker clamped to the axis; the 4 regime rows render through it with the existing suite green UNMODIFIED (GAUGE-01) | ✓ VERIFIED | `BulletGauge.tsx`: `role="meter"`, banded (warn+crisis segments via fragment + marker), neutral (marker-only), `clampedAxisPct` on marker AND band segments (CR-01), separate `testId`/`markerTestId`, no `any`/`as`/`!` (throw-branch narrowing), exported from `system/index.tsx`. `RegimeBoard.tsx` `Row` renders `<BulletGauge variant="banded">`. Suite asserts crisis-segment `left` ≈58.333, clamp fast-check, marker colors — 30 regime tests green within the 54-test run. |
| 2 | Fed Funds/SOFR/1M/3M render NEUTRAL gauges — `bg-dim` marker on a plain `bg-line2` track, NO band segments, NO verdict color ever (GAUGE-02) | ✓ VERIFIED | `RATES` marks all 4 money rates `variant:"neutral"`; `RateGaugeRow` neutral branch → `markerColorClass="bg-dim"` always, no band props → `BulletGauge` renders zero segments; aria `"…% — position"`. Test (RegimeBoard.test.tsx:620-643): marker `bg-dim`, NOT amber/down/txt, `:scope > div` length 1. A row with no macro point omits the gauge (catch #26). |
| 3 | 10Y−2Y/10Y−3M render BANDED gauges from client-side `RATE_BANDS` (calm >0 / warning ≤0 / crisis ≤−0.50) — display-only (GAUGE-02/05) | ✓ VERIFIED | `RATES`: T10Y2Y/T10Y3M `variant:"banded"`; `RATE_BANDS = {warn:0.0, crisis:-0.5}` matches documented thresholds; `rateBand()` classifies crisis-before-warn; `RATE_GAUGE_SCALE` axes match UI-SPEC. Test (RegimeBoard.test.tsx:652): banded = 3 children; boundary tests (−0.60 crisis / −0.20 warning / +0.50 calm) green. |
| 4 | 5 COT rows render NEUTRAL direction-tinted gauges — marker `bg-up` net≥0 / `bg-down` net<0, never amber, no band segments; WoW ▲/▼ + signed values kept; net/WoW at 11px (GAUGE-03) | ✓ VERIFIED | `CotCard.tsx`: 5 classes each `<BulletGauge variant="neutral">`, `markerColorClass = isLong ? "bg-up" : "bg-down"`; WoW arrow + `fmtSigned` kept; per-class widened axes; label 10px, net/WoW 11px, footnote 10px. Test (CotCard.test.tsx:90-109): markers bg-up/bg-down, `.not.toContain("bg-amber")` across all 5, `:scope > div` length 1. |
| 5 | Every ⓘ tooltip teaches (rev-3: WHAT / WHY / META with bands+source folded) verbatim from the UI-SPEC; regime rows keep server source/rationale (GAUGE-04) | ✓ VERIFIED | Shared `InfoTooltip` (RegimeBoard) + inline COT tooltip render the rev-3 3-line stack (WHAT `text-txt` 11px / WHY `text-dim` 11px / META `text-dim/70` 10px; regime rows append server `source`+`rationale` below META). `TOOLTIP_COPY` (10 regime+rate entries, 5 COT entries) matches UI-SPEC rev 3 byte-for-byte. Tests assert verbatim strings (hy-oas WHAT+source+rationale, T10Y2Y WHAT+META, DFF WHAT+META, netLeveraged WHAT) — green. See note on the user-directed rev-3 condensation below. |
| 6 | `docs/architecture/regime-board.md` documents t10y2y/t10y3m inversion bands BEFORE any component encodes them (docs-before-code); [ASSUMED] crisis tier; cited rationale (GAUGE-05) | ✓ VERIFIED | Both evidence rows present with `[ASSUMED]` −0.50 crisis tier, `macro_rates.md` citation, and the CLIENT-VISUAL-ONLY / picker-BLIND note. Commit order proves docs-first: `21dbaee docs(39-01): add t10y2y/t10y3m evidence rows` precedes `6b1c03f feat…BulletGauge` and `5b2100b feat…rates block`. |
| 7 | Gate-blind: `RATE_BANDS`/`RATE_GAUGE_SCALE`/`COT_GAUGE_SCALE` confined to the two display components; picker/regime gate take zero new inputs (GAUGE-05) | ✓ VERIFIED | Whole-tree grep across `apps/web/src apps/server/src packages`: 9 matches, all in `RegimeBoard.tsx` + `CotCard.tsx`, none in any gate/hook/server/core file. `usePicker()`/`useRegimeBoard()` called with no args. |
| 8 | Integration gate green + deployed to morai.wtf; all three blocks read at one visual density (goal + 39-04) | ✓ VERIFIED | Ran the 3 phase-39 suites: 54/54 pass. 39-04-SUMMARY records full workspace 3510 tests + `bun run typecheck` + `bun run lint` + apps/web tsc at the 8-error baseline (no Phase-39 file). HEAD = origin/main = `7197d70` (pushed); deployed to morai.wtf 2026-07-13 and re-deployed after the rev-3 tooltip condensation. One-density is structural (shared BulletGauge + one row shape + unified 10/11px type) and was exercised by the user's live desktop review. |

**Score:** 8/8 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/components/system/BulletGauge.tsx` | Shared banded/neutral meter track, clamp math, role=meter | ✓ VERIFIED | 115 lines; `role="meter"`, both variants, clamped marker+segments, exported from barrel |
| `apps/web/src/components/system/BulletGauge.test.tsx` | Unit + fast-check clamp contract | ✓ VERIFIED | Passes within the 54-test run (banded [warn,crisis,marker], neutral marker-only, clamp property) |
| `apps/web/src/components/RegimeBoard.tsx` | RATE_BANDS/RATE_GAUGE_SCALE, RateGaugeRow (4 neutral + 2 banded), InfoTooltip 3-part copy | ✓ VERIFIED | All present, wired, gate-blind; rev-3 verbatim copy |
| `apps/web/src/components/CotCard.tsx` | COT_GAUGE_SCALE, 5 neutral direction-tinted rows, 3-part ⓘ tooltip, typography fix | ✓ VERIFIED | All present, wired; widened axes match tooltip META |
| `docs/architecture/regime-board.md` | t10y2y/t10y3m evidence rows + [ASSUMED] + cite + gate-blind note | ✓ VERIFIED | Both rows present, committed before code |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `RegimeBoard.tsx` Row | `BulletGauge.tsx` | `<BulletGauge variant="banded">` for regime track | ✓ WIRED |
| `RegimeBoard.tsx` RateGaugeRow | `BulletGauge.tsx` | `variant="neutral"` (money rates) / `"banded"` (curves) | ✓ WIRED |
| `CotCard.tsx` row | `BulletGauge.tsx` | `variant="neutral"` with sign-derived markerColorClass | ✓ WIRED |
| `RegimeBoard.tsx` RATE_BANDS | `docs/architecture/regime-board.md` | thresholds cite the 39-01 evidence rows | ✓ WIRED |
| `RegimeBoard.tsx` / `CotCard.tsx` | picker/regime gate | (must NOT wire) — grep confirms no leak | ✓ CONFIRMED BLIND |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| RateGaugeRow | `latestValue(data, id)` | `useMacro()` → macro_observations (FRED) | Yes — null when no point (gauge omitted, not fabricated 0) | ✓ FLOWING |
| CotCard rows | `latest[c.key]` | `useCot()` → cot_observations (CFTC) | Yes — empty state when no report | ✓ FLOWING |
| RegimeBoard rows | `indicator.value` / live overlay | `useRegimeBoard()` + Phase-38 live indices | Yes — unchanged Phase-38 path | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase-39 suites (BulletGauge + RegimeBoard + CotCard) | `bun run test -- --run <3 files>` | 3 files, 54/54 tests passed (4.33s) | ✓ PASS |
| Neutral-never-verdict (rates + COT) | asserted in-suite | rate marker bg-dim not amber/down/txt; COT marker bg-up/bg-down not amber | ✓ PASS |
| Verbatim rev-3 tooltip copy | asserted in-suite (findByText) | DFF/T10Y2Y/hy-oas/netLeveraged verbatim strings render | ✓ PASS |
| Gate-blind constants | `rg RATE_BANDS\|RATE_GAUGE_SCALE\|COT_GAUGE_SCALE apps/web/src apps/server/src packages` | 9 matches, all in the 2 display components | ✓ PASS |
| Deploy identity | `git rev-parse HEAD` vs `origin/main` | both `7197d70` (pushed) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GAUGE-01 | 39-01, 39-04 | BulletGauge extraction + regime rows zero-visual-change | ✓ SATISFIED | Truth 1 |
| GAUGE-02 | 39-02, 39-04 | 6 rates rows as gauges (4 neutral + 2 banded) | ✓ SATISFIED | Truths 2, 3 |
| GAUGE-03 | 39-03, 39-04 | 5 COT rows neutral direction-tinted | ✓ SATISFIED | Truth 4 |
| GAUGE-04 | 39-02, 39-03, 39-04 | Teaching ⓘ tooltips, verbatim UI-SPEC copy | ✓ SATISFIED | Truth 5 |
| GAUGE-05 | 39-01, 39-02, 39-04 | Yield-curve bands docs-before-code + gate-blind | ✓ SATISFIED | Truths 6, 7 |

No orphaned requirements: REQUIREMENTS.md maps exactly GAUGE-01..05 to Phase 39; all five are claimed across the plan frontmatter and satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER/TODO in any modified file | — | Clean |
| (none) | — | No `any`/`as`/`!` type-safety violations (2 grep hits are prose in comments) | — | Clean |

### Notes (informational — not gaps)

1. **User-directed rev-3 tooltip condensation.** The phase goal names a "four parts — WHAT / WHY / BANDS / SOURCE" tooltip. After the 39-04 deploy, the user reviewed the live rail and asked for the tooltips to be smaller ("too large … should be quick and easy to read"). The UI-SPEC was updated to rev 3 (commits `930def2`/`7197d70`), condensing to a 3-line WHAT / WHY / META scan where bands+source fold into META (regime rows still append server source/rationale below META). This is a compression of the same facts, not new claims. All four semantic teaching parts remain present. Code, tests, and UI-SPEC are all consistent at rev 3; verbatim-copy checks were run against rev 3 as the current approved source.
2. **Stale sub-table in UI-SPEC.** The UI-SPEC "Gauge scale" table still lists the pre-checker-correction COT axes (±150K/±600K/±400K) while the COT block tooltip META and `COT_GAUGE_SCALE` in code use the widened axes (±1.15M/±1.5M/±800K/±25K/±200K). The code is correct (widening was the binding 39-03 checker correction, documented in the SUMMARY and inline comments); the spec's scale sub-table was simply not updated to match its own tooltip section.
3. **Stale test title.** `RegimeBoard.test.tsx:733` names the DFF case "…the neutral 'position only' META wording" (rev-2 phrasing), but its assertions check the verbatim rev-3 strings and pass. Cosmetic only.
4. **ROADMAP checkbox.** ROADMAP shows 39-04 unchecked ("3/4 plans executed"); its gate ran green and the change is deployed (the deploy/UAT half was orchestrator-owned). Bookkeeping lag, not a goal gap — the orchestrator flips it at phase.complete.

### Human Verification Required

None blocking. The one jsdom-unprovable item — that the neutral tracks render visibly distinct from banded and no verdict color appears on any neutral row, at one visual density — was exercised by the user's live desktop review on morai.wtf (2026-07-13), which produced the rev-3 copy-density feedback that was then applied and re-deployed. Per the escalation guidance, a subjective visual check already exercised by the user's live review leans passed rather than human_needed.

### Gaps Summary

No gaps. All five requirements (GAUGE-01..05) are satisfied in the codebase: a shared `BulletGauge` backs all three blocks; the four money-rate rows are neutral `bg-dim` position-only tracks with no possible verdict color; the two yield-curve spreads are banded from gate-blind `RATE_BANDS` at the documented thresholds; the five COT rows are neutral direction-tinted (bg-up/bg-down, never amber); every ⓘ teaches with verbatim rev-3 copy; the yield-curve evidence rows were documented before any band was encoded; and the display constants never reach a gate. The phase-39 suites pass 54/54, the tree is clean of debt markers and type-safety violations, and the change is committed and pushed (deployed to morai.wtf).

---

_Verified: 2026-07-14T01:10:00Z_
_Verifier: Claude (gsd-verifier)_
