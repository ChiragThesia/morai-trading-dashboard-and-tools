---
phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
plan: 05
subsystem: ui
tags: [integration-gate, uat, analyzer, vitest, typecheck, lint]

requires:
  - phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
    provides: "Plans 41-01..41-04 — live-spot seam, ranked table + sticky layout, verdict
      hero + mobile groups, rounding + term-structure/paste polish; this gate proves they
      hold together"

provides:
  - "Green phase gate: full workspace suite 3639/3639 (323 files), root typecheck clean,
    apps/web own tsc at the pre-existing 8-error baseline (zero new), lint clean"
  - "AUI-law grep evidence: exactAbs=0 on Analyzer.tsx + MobileScorecard.tsx (AUI-04);
    liveSpot/liveStatus=0 in MobileScorecard.tsx and badge/chrome-only in Analyzer.tsx
    (AUI-07 honesty); no retired chip/card testid in Analyzer.tsx (green-suite law)"
  - "41-UAT.md — automated results + 13-step human-verify script, operator-walked 13/13
    PASS on morai.wtf (desktop 1440px + mobile 390px + live RTH check), screenshots
    41-UAT-desktop.png / 41-UAT-mobile.png / 41-UAT-mobile-scorecard.png delivered to user"
  - "compactCalendarName (Analyzer.tsx) — shortens ISO dates in live picker names so
    ranked-table rows stay one line (UI-SPEC preview form '7525P Aug 6 / Aug 10')"

affects: [phase-41-verifier, v1.3-milestone-close]

tech-stack:
  added: []
  patterns:
    - "UAT-surfaced fixture blind spot: pickerSnapshotFixture names use short dates while
      the live engine emits ISO dates — visual defects in name-driven layout can only be
      seen against prod data; the regression test now pins the transform itself"
    - "Pure-string date display transform (no Date construction) — the local-vs-UTC law
      (catch #22, 3 prior bugs) applied preventively at the display layer"

key-files:
  created:
    - .planning/phases/41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar/41-UAT.md
    - .planning/phases/41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar/41-UAT-desktop.png
    - .planning/phases/41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar/41-UAT-mobile.png
    - .planning/phases/41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar/41-UAT-mobile-scorecard.png
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx

key-decisions:
  - "Live UAT surfaced a real defect the suite could not see (ISO-date names wrap table
    rows to 4 lines at 1440px; fixture names are already short). Fixed red→green in
    372ad2a as part of this gate rather than deferring: compactCalendarName pure string
    transform + whitespace-nowrap on the calendar cell; full gate rerun green after."
  - "Year is dropped in the compact form (Aug 6, not Aug 6 '26) — candidates are always
    near-dated; ambiguity across years is not a real case for this table."
  - "13/13 operator UAT walk recorded as PASS via the standing chrome-devtools permission;
    end-of-phase human gate = user's visual approval of the delivered screenshots."

requirements-completed: [AUI-01, AUI-02, AUI-03, AUI-04, AUI-05, AUI-06, AUI-07]

coverage:
  - id: G1
    description: "Full workspace suite + root typecheck + apps/web own tsc + lint all green"
    requirement: "AUI-01..07 (gate)"
    verification:
      - kind: integration
        ref: "bun run test → 323 files / 3639 tests passed (post-372ad2a rerun, exit 0);
          bun run typecheck clean; bunx tsc -p apps/web --noEmit → pre-existing 8-error
          baseline only; bun run lint clean"
        status: pass
  - id: G2
    description: "AUI-04 law — no exact-broker-value formatter on the Analyzer tab"
    requirement: "AUI-04"
    verification:
      - kind: grep
        ref: "rg -c 'exactAbs' Analyzer.tsx MobileScorecard.tsx → 0 matches both"
        status: pass
  - id: G3
    description: "AUI-07 honesty — verdict hero never reads the live stream"
    requirement: "AUI-07"
    verification:
      - kind: grep
        ref: "rg -n 'liveSpot|liveStatus' MobileScorecard.tsx → 0; Analyzer.tsx matches
          confined to LiveStatusBadge/chart chrome"
        status: pass
  - id: G4
    description: "Green-suite law — retired chip/card testids gone from desktop source"
    requirement: "AUI-01/AUI-02"
    verification:
      - kind: grep
        ref: "rg -n 'scoring-pills|scoring-checklist|candidate-card-' Analyzer.tsx → none"
        status: pass
  - id: G5
    description: "Desktop detail components unchanged, re-wire on row selection (tripwire)"
    requirement: "AUI-01/AUI-03"
    verification:
      - kind: unit
        ref: "Analyzer.test.tsx 'right column' + 'payoff center' describe blocks green in
          the full gate run"
        status: pass
  - id: G6
    description: "Human UAT on morai.wtf — desktop + mobile + live"
    requirement: "AUI-01..07"
    verification:
      - kind: human
        ref: "41-UAT.md 13-step script, operator walk 13/13 PASS; screenshots delivered;
          final user approval pending (end-of-phase gate)"
        status: pass

metrics:
  duration: "gate + UAT + wrap-fix ~50min"
  completed: "2026-07-14"
  tests-passing: 3639
  test-files: 323
---

# Phase 41 Plan 05: Integration gate + morai.wtf UAT Summary

**Full gate green (3639/3639, dual tsc, lint, all AUI-law greps), 13/13 UAT walk on
morai.wtf, one UAT-surfaced defect (ISO-date row wrap) fixed red→green in 372ad2a.**

The gate ran twice: once at wave close (3638 tests) and again after the UAT-surfaced
table-wrap fix (3639 — the new compactCalendarName regression test). The wrap defect is a
textbook fixture blind spot: `pickerSnapshotFixture` candidate names use short-form dates
("7500P Jul 23 / Aug 14") while the live picker engine emits ISO ("7525P 2026-08-06 /
2026-08-10"), so every suite assertion passed while prod rows wrapped to four lines. The
fix is a pure string transform (no `Date` construction — catch #22's local-vs-UTC law) and
the calendar cell is `whitespace-nowrap`.

UAT was operator-walked on the deployed morai.wtf via the standing chrome-devtools
permission during RTH: ranked table, instant row→detail swap, verdict hero + Edge/Risk/Fit
groups, trading-precision numbers, LIVE badge with the header spot tracking the sidecar
tick, taller term-structure chart with short/long markers — desktop 1440px and mobile
390px both PASS. Screenshots delivered to the user for the final end-of-phase approval.

## Deviations

- Added `compactCalendarName` + regression test (Analyzer.tsx/.test.tsx) — deviation from
  the plan's "no new code" gate shape, per the plan's own rule 1 (fix in the owning
  plan's files rather than paper over); the table is 41-02's surface, fixed here at gate.

## Self-Check

- Full suite green post-fix: PASS (3639/3639, exit 0)
- 41-UAT.md exists with automated + human sections: PASS
- All coverage rows pass: PASS (G6 human = operator walk; user approval pending)
