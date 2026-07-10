---
phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
verified: 2026-07-10T15:49:59Z
status: human_needed
score: 26/26 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Paste the user's actual 7500P TOS calendar order on morai.wtf (live prod, not localhost) and view the Analyzer Risk Profile chart"
    expected: "The payoff tent's left tail and left breakeven (~7150) are fully visible, no clipping at the chart's left edge; right tail/apex also unclipped."
    why_human: "Visual chart rendering against live prod data (real spot, real GEX walls) — computePayoffDomain's math is unit/property-tested, but pixel-level rendering fidelity on the deployed app is not observable via grep/test execution. Phase 30 is not yet deployed (deploy happens after this verification)."
  - test: "With the same pasted 7500P order, confirm the scorecard renders factor bars (slope/fwdEdge/gexFit/eventAdjustment), a θ GATE chip, a WHY THIS CALENDAR panel, and an ENTRY/EXIT PLAN panel — the 'Pasted calendar — not engine-scored.' placeholder must not appear."
    expected: "Full engine-scored UI renders identically to an engine-surfaced candidate; CandidateCard shows a real score + theta/vega subline while keeping the PASTED provenance badge."
    why_human: "End-to-end live-prod flow (paste → POST /api/picker/analyze → real DB-backed picker snapshot → render) — the client/server halves are each unit/integration-tested in isolation (all green), but the full round-trip against the live deployed server + real market data has not been exercised."
  - test: "With a Phase-29 rule override active, paste a PUT calendar and confirm the pasted score reflects the override (matches an equivalent engine-surfaced candidate's score under the same override)."
    expected: "Pasted score changes consistently with the active override, same as engine candidates."
    why_human: "Requires a live override configured in prod settings and a live scoring context; not observable via static analysis or the isolated unit/integration suites."
---

# Phase 30: Analyzer Pasted-Calendar Fix / Payoff Graph X-Domain Verification Report

**Phase Goal:** (D-01) Analyzer/Overview payoff graph x-domain fits the full tent (both tails
+ BEs, incl. the user's 7500P repro) via one `computePayoffDomain` threaded into
`scenario-engine` grid + all `PayoffChart` consumers, no Overview regression; (D-02) pasted
PUT calendars get real engine scoring + gates + exit plan via
`makeAnalyzeAdHocCalendarUseCase` + `POST /api/picker/analyze` + `analyze_ad_hoc_calendar` MCP
tool, with 200 `{scored:false}` degradation, byte-parity to engine scoring, snapshot
gate/sizing reused verbatim, fresh rule overrides.

**Verified:** 2026-07-10T15:49:59Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `computePayoffDomain` returns a domain containing every leg strike, both real BEs, and spot, with padding | ✓ VERIFIED | `apps/web/src/lib/payoff-domain.ts:35-74`; property test (200 fast-check runs) at `payoff-domain.test.ts:103-130` asserts spot/strikes ∈ [min,max] for every generated case — run green |
| 2 | 7500P repro (strike 7500, spot ~7381, left BE ~7150): domain min ≤ 7150, max ≥ 7500 | ✓ VERIFIED | `payoff-domain.test.ts:55-66` literal repro test — run green (`bunx vitest run apps/web/src/lib/payoff-domain.test.ts`) |
| 3 | `repriceScenario` computes curves over the passed domain, not a fixed 6900–7900 grid | ✓ VERIFIED | `scenario-engine.ts:442-460` `repriceScenario(positions, params, domain = {SPOT_GRID_MIN, SPOT_GRID_MAX})`; `buildSpotGrid(domain)` interpolates over `domain.min..domain.max` |
| 4 | `PayoffChart` xScale, ticks, GEX wall pinning, crosshair all derive from the domain prop — no module-constant 6900/7900 left | ✓ VERIFIED | `rg -n "X_MIN\|X_MAX" PayoffChart.tsx` = 0 matches; `buildXScale(innerWidth, domain)` (:147), `pinMarker(..., domain)` (:167-173), `buildXTicks(domain.min, domain.max)` (:388), `handlePointerMove` uses `xScale.invert(innerX)` (:362) |
| 5 | Analyzer payoff chart fits the selected/combined book's full tent for pasted or engine calendars | ✓ VERIFIED | `Analyzer.tsx:635-636` `payoffDomain = useMemo(computePayoffDomain(...))`, threaded to `repriceScenario` (:641) and `<PayoffChart domain={payoffDomain}>` (:821) |
| 6 | Overview combined-book payoff chart still renders correctly for a multi-strike live book — no regression | ✓ VERIFIED | `Overview.tsx:922-942,1159` same wiring; `Overview.test.tsx:677-683` "D-01: combined book at widely-different strikes (7000/7600)" asserts domain brackets both — run green |
| 7 | Both screens compute ONE domain via `computePayoffDomain` and pass it to BOTH `repriceScenario` and `<PayoffChart domain=>` | ✓ VERIFIED | Same `payoffDomain` memo instance flows to both call sites in each screen (grep evidence above) |
| 8 | `analyzeAdHocCalendarRequest` rejects non-finite/non-positive leg numbers, non-put calendars, `backDte ≤ frontDte` | ✓ VERIFIED | `packages/contracts/src/picker.ts:340-359`; `picker.test.ts:342` asserts `putCall:"C"` throws; reject cases run green |
| 9 | Request schema does NOT accept a client-supplied spot | ✓ VERIFIED | `.strict()` object with no `spot` field (`picker.ts:340-354`) |
| 10 | `analyzeAdHocCalendarResponse` carries `{scored, candidate, reason}` | ✓ VERIFIED | `picker.ts:369-375` |
| 11 | `resolveEventExit` is one exported pure function reused by both `selectCandidates` and the ad-hoc use-case | ✓ VERIFIED | `candidate-selection.ts` exports it; `analyzeAdHocCalendar.ts:27,144` imports and calls it; `selectCandidates` uses the same function (extraction, not duplication) |
| 12 | `selectCandidates` behavior unchanged after the extraction (regression neutrality) | ✓ VERIFIED | `bunx vitest run packages/core/src/picker/domain/candidate-selection.test.ts` — green, unchanged assertions |
| 13 | `makeAnalyzeAdHocCalendarUseCase` scores with byte-parity to `scoreOne`/`scoreCalendarCandidates` | ✓ VERIFIED | `analyzeAdHocCalendar.test.ts:152` fast-check parity property — run green |
| 14 | Gate penalty/gate/sizing come verbatim from the latest snapshot; `resolveEntryGate` NEVER called, no macro/open-calendar/recent-closed/chain reads | ✓ VERIFIED | `analyzeAdHocCalendar.ts` deps type (`AnalyzeAdHocCalendarDeps`, lines 55-73) structurally excludes those reads; `rg` finds `resolveEntryGate` only in a doc comment, never called; `analyzeAdHocCalendar.test.ts:339` "port hygiene" test — run green |
| 15 | Effective rule config resolved FRESH via `readRuleOverrides` | ✓ VERIFIED | `analyzeAdHocCalendar.ts:89-92` reads overrides fresh, calls `resolvePickerRuleConfig` per invocation |
| 16 | No snapshot yet → `{scored:false, reason:'no-snapshot'}`; never throws, never persists | ✓ VERIFIED | `analyzeAdHocCalendar.ts:81-84`; no persist port in deps; test suite covers this case, green |
| 17 | Zero new driven ports introduced | ✓ VERIFIED | `AnalyzeAdHocCalendarDeps` reuses `ForReadingPickerSnapshot`/`ForReadingGexContext`/`ForReadingEconomicEvents`/`ForReadingDailySpotCloses`/`ForReadingPickerSlopeHistory`/`ForReadingRuleOverrides` — all pre-existing ports |
| 18 | `POST /api/picker/analyze` Zod-validates, calls use-case, returns 200 `{scored, candidate, reason}` — `scored:false` is 200, never a hard error | ✓ VERIFIED | `picker.routes.ts:64-80`; `picker.routes.test.ts` 200-scored/200-unscored/400/500 cases — run green |
| 19 | Route mounts inside the authenticated `apiRouter` (same Bearer group as `/api/picker/candidates`) | ✓ VERIFIED | `main.ts:517` `pickerRoutes(getPicker, analyzeAdHocCalendar)` mounted on `apiRouter`, wrapped by `authReadGroup` JWT middleware (`main.ts:544-546`) |
| 20 | MCP `analyze_ad_hoc_calendar` tool uses the SAME `analyzeAdHocCalendarRequest` schema | ✓ VERIFIED | `tools.ts:630-684` `registerAnalyzeAdHocCalendarTool`; imports the same contract schema (MCP-02) |
| 21 | Server never trusts a client spot; derives it via the use-case's snapshot read | ✓ VERIFIED | `analyzeAdHocCalendar.ts:115` `spot = snapshot.spot`; request schema has no spot field (dup of #9, confirmed at both boundaries) |
| 22 | `StorageError` maps to flat `{error:'internal'}` 500 | ✓ VERIFIED | `picker.routes.ts:68-71` |
| 23 | Pasting a PUT calendar fires `POST /api/picker/analyze`; scored response renders real factor bars, θ GATE chip, WHY THIS CALENDAR, ENTRY/EXIT PLAN — placeholder disappears | ✓ VERIFIED | `Analyzer.tsx:536-591` `handlePasteAnalyze` calls `analyzeCalendar.mutateAsync`; render gates at `:306,409-423` key off `breakdown.length===0` — a scored candidate (`breakdown.length>0`) renders the real panels, never the placeholder |
| 24 | `scored:false` (or a pasted CALL) falls back to the existing unscored display with the existing note — never a hard error | ✓ VERIFIED | `Analyzer.tsx:560-564` (CALL never sent to endpoint), `:579-590` (`scored:false` or network error → fallback / paste-error copy, never a crash) |
| 25 | Scored-vs-unscored branches key off `candidate.breakdown.length`, not the pasted id or a pasted boolean | ✓ VERIFIED | `rg -n "isPastedId(candidate.id)"` on the three render gates = 0 matches; all three now read `breakdown.length === 0` |
| 26 | `CandidateCard` shows a scored pasted card's real score/theta/vega while keeping the PASTED provenance badge | ✓ VERIFIED | `CandidateCard.tsx:162-169,197-226` — PASTED badge renders unconditionally on `pasted`; score/subline gate on `breakdown.length > 0` |

**Score:** 26/26 truths verified (0 present, behavior-unverified)

### Hard Must-Have: Phase 27 Backtest Replay Suites Unmodified

`git log --since="2026-07-09" -- packages/core/src/backtest/application/runBacktest.ts packages/core/src/backtest/application/runBacktest.test.ts apps/worker/src/backtest.ts apps/worker/src/backtest.test.ts` — **0 commits** touch these files during Phase 30 (verified against the full `be5b33f^..HEAD` phase-30 commit range: `git log --oneline be5b33f^..HEAD --stat | grep backtest` — no output). `bunx vitest run packages/core/src/backtest/application/runBacktest.test.ts apps/worker/src/backtest.test.ts` — **2 files, 12 tests, all green**, run directly by this verifier (not sourced from SUMMARY.md claims).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/lib/payoff-domain.ts` | `computePayoffDomain(positions, spot, params)` | ✓ VERIFIED | Exists, substantive (74 lines, real two-pass tent-fitting math), wired (imported by Analyzer.tsx, Overview.tsx) |
| `apps/web/src/lib/scenario-engine.ts` | domain-aware `repriceScenario`/`buildSpotGrid`; exported `findZeroCrossings`/`extractStrike`/`includedForT0` | ✓ VERIFIED | All exports confirmed present and consumed |
| `apps/web/src/components/charts/PayoffChart.tsx` | required `domain` prop threaded to all 4 consumers | ✓ VERIFIED | No `X_MIN`/`X_MAX` constants remain; domain in useMemo deps |
| `apps/web/src/screens/Analyzer.tsx` | domain memo threaded to `repriceScenario` + `PayoffChart`; `useAnalyzeCalendar` wired into paste flow | ✓ VERIFIED | Both concerns present |
| `apps/web/src/screens/Overview.tsx` | domain memo threaded to `repriceScenario` + `PayoffChart` | ✓ VERIFIED | Present |
| `packages/contracts/src/picker.ts` | `analyzeAdHocCalendarRequest`/`Response` (additive) | ✓ VERIFIED | Present, exported, with CR-01's `isoDate` regex fix |
| `packages/core/src/picker/domain/candidate-selection.ts` | exported `resolveEventExit`, `daysBetween` | ✓ VERIFIED | Both exported and consumed |
| `packages/core/src/picker/application/analyzeAdHocCalendar.ts` | `makeAnalyzeAdHocCalendarUseCase` | ✓ VERIFIED | Present, matches plan's flow spec exactly including the post-review dte/expiry consistency guard |
| `apps/server/src/adapters/http/picker.routes.ts` | `POST /picker/analyze` handler | ✓ VERIFIED | Present, thin adapter, zero business logic |
| `apps/server/src/adapters/mcp/tools.ts` | `registerAnalyzeAdHocCalendarTool` | ✓ VERIFIED | Present |
| `apps/server/src/main.ts` | composition-root wiring (route + MCP + repos) | ✓ VERIFIED | `analyzeAdHocCalendar` composed and passed to both adapters, mounted inside authenticated group |
| `apps/web/src/lib/tos-parser.ts` | `ParsedCalendar.frontExpiry`/`.backExpiry` | ✓ VERIFIED | Present, ISO date, from existing `frontMs`/`backMs` |
| `apps/web/src/hooks/useAnalyzeCalendar.ts` | mutation hook | ✓ VERIFIED | Present, matches plan spec (scored:false is non-error, network failure throws) |
| `apps/web/src/components/picker/CandidateCard.tsx` | score/subline branch on `breakdown.length>0` | ✓ VERIFIED | Present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `payoff-domain.ts` wide-pass reprice | `findZeroCrossings` → real BEs → tight domain | function call | ✓ WIRED | `payoff-domain.ts:62-66` |
| one `{min,max}` object | both `buildSpotGrid` (data grid) and `buildXScale` (chart scale) | shared memo | ✓ WIRED | Same `payoffDomain` variable passed to `repriceScenario` and `<PayoffChart domain=>` in both screens |
| `combinedPositions`/`calendarPositions` + spot | `computePayoffDomain` → `repriceScenario(domain)` + `<PayoffChart domain=>` | useMemo chain | ✓ WIRED | Confirmed in both Analyzer.tsx and Overview.tsx |
| one Zod request schema | HTTP route + MCP tool | shared import | ✓ WIRED | Both `picker.routes.ts` and `tools.ts` import `analyzeAdHocCalendarRequest` from `@morai/contracts` |
| `resolveEventExit` | `selectCandidates` (existing) + `analyzeAdHocCalendar` (new) | function reuse | ✓ WIRED | Both call sites confirmed |
| `readPickerSnapshot` | gate/sizing/spot/asOf (reused, never recomputed) | direct field access | ✓ WIRED | `analyzeAdHocCalendar.ts:81-116` |
| `analyzeAdHocCalendarRequest` → `zValidator` (HTTP) + `inputSchema` (MCP) | one schema | shared contract import | ✓ WIRED | Confirmed at both adapter sites |
| `parseTosOrder` → `{legs + frontExpiry/backExpiry}` → `useAnalyzeCalendar` → scored candidate → shared candidate→position→PayoffChart path | client paste flow | function chain | ✓ WIRED | `Analyzer.tsx:536-591` traces the whole chain |
| `scored:false`/call → `parsedCalendarToPickerCandidate` fallback | client degradation | conditional branch | ✓ WIRED | `Analyzer.tsx:560-564,579-584` |

### Behavioral Spot-Checks (tests actually run by this verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| D-01 primitives + screens (web) | `bunx vitest run apps/web/src/lib/payoff-domain.test.ts apps/web/src/lib/scenario-engine.test.ts apps/web/src/components/charts/PayoffChart.test.tsx apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/Overview.test.tsx apps/web/src/components/picker/CandidateCard.test.tsx apps/web/src/hooks/useAnalyzeCalendar.test.ts apps/web/src/lib/tos-parser.test.ts` | 8 files, 236 tests, all green | ✓ PASS |
| D-02 contracts/core/server | `bunx vitest run packages/contracts/src/picker.test.ts packages/core/src/picker/domain/candidate-selection.test.ts packages/core/src/picker/application/analyzeAdHocCalendar.test.ts apps/server/src/adapters/http/picker.routes.test.ts apps/server/src/adapters/mcp/tools.test.ts` | 5 files, 139 tests, all green (postgres testcontainer up/down clean) | ✓ PASS |
| Phase 27 backtest replay non-regression | `bunx vitest run packages/core/src/backtest/application/runBacktest.test.ts apps/worker/src/backtest.test.ts` | 2 files, 12 tests, all green | ✓ PASS |
| CR-01 fix: malformed date 400s, not throws | `rg` + read `picker.ts:338`, `picker.routes.test.ts` malformed-frontExpiry case | Confirmed present in code + test suite (included in the above green run) | ✓ PASS |
| WR-01 fix: zero-width domain guard | Read `payoff-domain.ts:47-53` (`contributing.length===0` early return) | Confirmed present, tests included in payoff-domain.test.ts green run | ✓ PASS |
| No debt markers in phase files | `grep -n -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across 15 phase-touched files | 0 matches | ✓ PASS |

Full workspace suite was not re-run (per verification notes: orchestrator already ran it green, 280 files/3,017 tests, moments before this verification — no code changed since).

### Requirements Coverage

No REQUIREMENTS.md IDs are mapped to Phase 30 (confirmed: `grep -n "D-01\|D-02\|D-03" .planning/REQUIREMENTS.md` finds no phase-30 rows). Per the task's own instruction, verification instead targets the 8 binding decisions cited across the 6 plans (bindings #1, #2, #3, #4, #6, #7, #8 explicitly cited; binding #5 not cited in any plan file — not a gap, simply unreferenced in this phase's plans) plus 30-CONTEXT.md's USER LOCKED decisions. All are covered by the Observable Truths table above:

- Binding #1 (gate-blocked still scores) → Truth #14, confirmed by `analyzeAdHocCalendar.test.ts` gate-BLOCKED-still-scores case (green).
- Binding #2 (scored:false / errors are 200, never hard error) → Truths #16, #18, #24.
- Binding #3 (calls never sent to endpoint) → Truth #24, confirmed `Analyzer.tsx:560-564`.
- Binding #4 (gate/sizing verbatim + fresh overrides) → Truths #14, #15.
- Binding #6 (parsing stays client-side) → confirmed `tos-parser.ts` unchanged parse location; only parsed legs POSTed.
- Binding #7 (breakdown.length gate, not pasted id) → Truth #25.
- Binding #8 / T-19-17 (no recompute/persist) → Truth #16, #17.
- USER LOCKED D-01 (full-tent domain, no fixed 6900-7900) → Truths #1-7.
- USER LOCKED D-02 (real engine scoring, gates, exit plan; placeholder disappears) → Truths #13, #23, #26.

### Anti-Patterns Found

None. Scanned all 15 phase-touched core/screen/contract/route files for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not implemented|coming soon` — 0 matches. No leftover `ponytail:` placeholder comments (the 30-01 literal `{min:6900,max:7900}` interim placeholder at the two `<PayoffChart>` call sites was correctly replaced by real `computePayoffDomain` wiring in 30-02 — confirmed no `ponytail:` markers remain in Analyzer.tsx/Overview.tsx).

### Code Review Findings — Verified Fixed

The phase's own review (30-REVIEW.md) found 1 BLOCKER (CR-01) + 2 WARNINGs (WR-01, WR-02); 30-REVIEW-FIX.md claims all 3 fixed. This verifier independently confirmed each fix in the current codebase (not from the fix report's narrative):

- **CR-01** (unvalidated date strings reaching `assertDefined` throw + silent dte/expiry desync): confirmed `isoDate` regex at `packages/contracts/src/picker.ts:338`, and the `daysBetween(asOfIso, fe) !== tf` cross-field guard at `analyzeAdHocCalendar.ts:130-132` returning `{scored:false, reason:"dte-expiry-mismatch"}` rather than throwing.
- **WR-01** (zero-width domain collapse): confirmed `contributing.length === 0` early-return guard at `payoff-domain.ts:47-53`.
- **WR-02** (assertDefined misuse as input validation): same root-cause fix as CR-01 — `isoDayNumber` is now only ever reached with Zod-validated strings, restoring it to a true invariant. Confirmed by tracing the call chain: Zod boundary → `daysBetween` cross-check → only then `resolveEventExit`/`isoDayNumber`.

IN-01 (Info, out of fix scope) remains open by design — `frontDte`/`backDte` are still trusted client input rather than server-derived, though now cross-validated against the expiry. This is a documented, accepted simplification, not a gap against this phase's must-haves.

### Human Verification Required

3 items — all live-prod visual/end-to-end checks that cannot be exercised before deployment (Phase 30 code is verified but not yet deployed, per verification notes). See frontmatter `human_verification` for full detail:

1. **Live 7500P repro visual check** — paste the user's actual TOS order on morai.wtf, confirm the left tail/BE are visible (not clipped).
2. **Live scored-paste UI check** — confirm factor bars/θ GATE/WHY/ENTRY-EXIT render and the "not engine-scored" placeholder disappears for a real scored paste.
3. **Live rule-override parity check** — confirm a pasted calendar's score reflects an active Phase-29 override.

### Gaps Summary

No gaps found. All 26 must-have truths across the 6 plans are verified against the actual codebase (not SUMMARY.md narrative) via direct code reads and by independently running every relevant test suite (all green). The 3 code-review findings (1 blocker, 2 warnings) from 30-REVIEW.md are confirmed fixed in the current code, not merely claimed fixed. Phase 27's backtest replay suites are confirmed untouched (git log) and green (test run). The only open items are 3 human-verification checks that require the live deployed app — deployment is explicitly the next step after this verification, per the phase's own plan-level "Manual (UAT, deferred to /gsd-verify-work)" notes.

---

_Verified: 2026-07-10T15:49:59Z_
_Verifier: Claude (gsd-verifier)_
