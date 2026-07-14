---
phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
verified: 2026-07-14T00:00:00Z
status: human_needed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "On morai.wtf → ANALYZER tab (≥1280px and 390px), confirm the new desktop + mobile Analyzer: ranked table (no 17-card scroll wall), row click → instant detail swap, verdict hero + Edge/Risk/Fit groups (chips gone), trading-precision numbers, live badge, sticky bounded table."
    expected: "User gives visual thumbs-up. Operator walk already 13/13 PASS; screenshots delivered 2026-07-14."
    why_human: "Final aesthetic/UX approval on the live deploy is a human visual gate — the last acceptance criterion in 41-CONTEXT (\"user visually approves\"). Automated + operator checks all pass; only the user's sign-off remains."
---

# Phase 41: Analyzer Cleanup Verification Report

**Phase Goal:** The Analyzer reads as one selection-driven screen — a ranked compact table of suggested calendars where clicking a row loads full detail into stable center/right panels; a verdict hero (score + Θ headline, Edge/Risk/Fit factor groups) replaces the chip wall; every number renders at trading precision; paste flow and term-structure chart read clean; the same idioms have designed mobile treatments through the analyzer-mobile tree; and the tab's marks/spot flow live from the sidecar with honest stale states.
**Verified:** 2026-07-14
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (per requirement AUI-01..07)

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| AUI-01 | Ranked sortable table + row-click detail | ✓ VERIFIED | `CandidateRail` renders a `<table>`, one `<tr>` per candidate (`CandidateRow`), cols score/calendar/debit/Θ/event/⊕ (Analyzer.tsx:345-388). Row `onClick → onSelect → selectedId → detail panels` (Analyzer.tsx:167). `SortableHeader` + `cycleSort` desc↔asc with `aria-sort`, default score-desc (Analyzer.tsx:114-136, 630-634). Selected row violet tint + left accent bar (line 170). Pasted rows pinned above with PASTED pill, `—` placeholder (never $0), × remove; ⊕ Combine + detail-pane Combine + Copy TOS survive. Tests: one-row-per-candidate, click-updates-selection, sort-by-debit-aria-sort, ⊕ stopPropagation, compact-name-one-line — all pass. |
| AUI-02 | Verdict hero + Edge/Risk/Fit groups | ✓ VERIFIED | `VerdictHero` = verdict word + score + Θ over 3 EDGE/RISK/FIT columns (Analyzer.tsx:420-530). `verdictWord` derives from `scoreStatus(candidate.score)` — no fabricated confidence (useAnalyzerModel.ts:122-130). `GROUP_OF` locked mapping shared by both trees (useAnalyzerModel.ts:107-117). Calibrating/dropped-quotes/as-of collapse to a single quiet footer, omitted when empty (lines 450-465, 525). Not-scored pasted → note only, no verdict/groups (catch #23, lines 431-438). Zero `scoring-pills`/`scoring-checklist` testids — chips retired. Tests: headline+checklist, grouped EDGE/RISK/FIT, guard n/a — pass. |
| AUI-03 | Sticky bounded layout, no dead columns | ✓ VERIFIED | Rail Panel `max-h-[70vh] overflow-y-auto` with `sticky top-0` thead (Analyzer.tsx:298, 346). 3-col grid `[300px_minmax(0,1fr)_330px]` with center chart + right panels in own columns (line 746). No fixed page height — content-driven; the 3,274px dead-column layout is gone. |
| AUI-04 | Trading-precision numbers | ✓ VERIFIED | `Math.round` for dollars, `toFixed(1)` theta, `toFixed(2)` vega across Analyzer.tsx + MobileScorecard.tsx. `rg exactAbs` = 0 matches both files (local Math.round formatter, not position-format.ts's broker-exact helpers). Test: "rounds debit to whole dollars and vega to 2dp — no long-decimal render" passes. |
| AUI-05 | Paste polish + term-structure cleanup | ✓ VERIFIED | TermStructureChart `H=320` (taller; header notes prior ~230) + `aspect-[760/320]` (TermStructureChart.tsx:31, 157). Leg markers `r={7}` with prominent "short f"/"long b" labels fontSize 13 (lines 238-255). Event `ReferenceLine`s carry in-chart labels matching the below-chart legend chips (lines 186-200, 258-277). Desktop paste input enlarged (`px-3 py-2`) with clear Analyze button (Analyzer.tsx:310-322). TermStructureChart.test.tsx passes. |
| AUI-06 | Mobile parity via analyzer-mobile tree | ✓ VERIFIED | `MobileScorecard` restructured into EDGE/RISK/FIT single-column groups, same verdict-word headline, same shared `GROUP_OF` (MobileScorecard.tsx:78-193). `AnalyzerMobile` keeps paste-first order, CandidateCard tap-to-select list, scorecard, chart block, disclosures. `LiveStatusBadge` in `MobileAnalyzerChart` chrome (line 66). MobileScorecard.test.tsx passes. |
| AUI-07 | Live sidecar + honest stale; verdict hero never live | ✓ VERIFIED | `spot = liveStatus === "live" && liveSpot !== null ? liveSpot : (snapshot?.spot ?? 0)` — live only when stream live AND a tick arrived, else snapshot fallback (catch #26; useAnalyzerModel.ts:209). `candidate.score/breakdown/theta/vega/debit` come from `usePicker()` snapshot — zero live input into scoring; verdict hero renders snapshot-derived values only. `LiveStatusBadge` mounts in desktop Risk-profile header (Analyzer.tsx:759) + mobile chart chrome; `rg liveSpot\|liveStatus` = 0 in MobileScorecard.tsx and 0 in Analyzer.tsx (badge uses `liveBadgeProps`, MobileScorecard never receives it). Behavior-dependent fallback transition is exercised by passing tests: live branch, quiet→snapshot.spot, stalled-non-null-does-not-drive (catch #26), cold-start→0. |

**Score:** 7/7 requirements verified (0 present, behavior-unverified). The AUI-07 stalled→snapshot fallback (a behavior-dependent invariant) has a passing named test, so it is behaviorally VERIFIED rather than present-only.

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| table row onClick | detail panels | `onSelect(candidate) → useAnalyzerModel.selectedId → selected → PayoffChart/TermStructure/WhyPanel/EntryExitPlan` | WIRED |
| ⊕ cell onClick | combined book | `stopPropagation → onToggleCombine → combinedIds → bookCandidates → repriceScenario` | WIRED |
| sort header | tbody row order | `handleSortChange → cycleSort → sortCandidates(useMemo) → sortedRows` | WIRED |
| useAnalyzerModel.spot | PayoffChart T+0 | `spot → params(useMemo) → payoffDomain → scenarioResult → PayoffChart` (only the SOURCE of spot changed) | WIRED |
| useAnalyzerModel.liveBadgeProps | LiveStatusBadge | desktop Risk-profile header + MobileAnalyzerChart chrome | WIRED |
| GROUP_OF | desktop hero + mobile scorecard | single shared partition of scoreItems | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase-41 suites green | `bunx vitest run` on Analyzer / MobileScorecard / useAnalyzerModel / TermStructureChart test files | 4 files, 102 tests passed | ✓ PASS |
| apps/web own tsc (catch #29) | `bunx tsc -p apps/web --noEmit` | Exactly the documented 8-error pre-existing baseline (GexBars ×2, PayoffChart, ErrorBoundary ×2, Button, parsed-calendar-to-candidate, Overview.test); zero new errors, none in phase-41 files | ✓ PASS |
| AUI-07 honesty grep | `rg liveSpot\|liveStatus` MobileScorecard.tsx / Analyzer.tsx | 0 / 0 — verdict hero never reads the live stream | ✓ PASS |
| AUI-04 law grep | `rg exactAbs` Analyzer.tsx + MobileScorecard.tsx | 0 both | ✓ PASS |
| Retired-testid grep | `rg scoring-pills\|scoring-checklist\|candidate-card-` Analyzer.tsx | 0 — no false-green leak | ✓ PASS |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| (analyzer-mobile tree, Analyzer.tsx, TermStructureChart.tsx) | TBD/FIXME/XXX/HACK/PLACEHOLDER | none | 0 markers found — completion is auditable |

### Human Verification Required

**1. Final user visual approval of the new Analyzer on morai.wtf**

- **Test:** ANALYZER tab at ≥1280px and 390px — confirm ranked table (no 17-card scroll wall), row click → instant detail swap, verdict hero + Edge/Risk/Fit groups (chips gone), trading-precision numbers, live badge, sticky bounded table.
- **Expected:** User thumbs-up. Operator walk already **13/13 PASS** (41-UAT.md); screenshots delivered 2026-07-14.
- **Why human:** Final aesthetic/UX sign-off on the live deploy is the last acceptance criterion in 41-CONTEXT ("user visually approves"). All automated + operator checks pass; only the user's approval remains.

### Gaps Summary

No gaps. All seven AUI requirements are delivered in code and exercised by passing tests. Live-spot gating honors catch #26 (a stalled/frozen live value is never shown as fresh), scoring stays snapshot-derived, and the verdict hero reads zero live signal. Typecheck shows only the pre-existing 8-error baseline documented in 41-UAT.md — no new errors, none in phase-41 files. The single outstanding item is the end-of-phase human visual gate, per the team-lead directive to score it `human_needed` rather than fail.

---

_Verified: 2026-07-14_
_Verifier: Claude (gsd-verifier)_
