---
phase: 36
plan: 01
subsystem: web
status: complete
tags: [analyzer, mobile, refactor, extraction, useIsDesktop, byte-identity-guard]
requires:
  - useIsDesktop (35 D-01, reused verbatim)
  - MobileRiskPanel chrome (35.1, phone-checked)
  - Overview matchMedia stub pattern (35.1 D-10)
provides:
  - MobileChartControls (shared mobile chart chrome — Overview + Analyzer)
  - useAnalyzerModel (shared Analyzer state/derivation hook + exported constants/helpers)
  - Analyzer useIsDesktop switch (AnalyzerDesktop | AnalyzerMobile)
  - AnalyzerMobile skeleton root (analyzer-mobile-root)
affects:
  - apps/web/src/screens/Analyzer.tsx
  - apps/web/src/screens/overview-mobile/MobileRiskPanel.tsx
tech-stack:
  added: []
  patterns:
    - dedicated-mobile-tree switch (verbatim Overview/35.1 recipe)
    - shared model hook (useOverviewModel precedent)
    - same-commit test migration to matchMedia stub (35.1 D-10 byte-identity guard)
key-files:
  created:
    - apps/web/src/components/charts/MobileChartControls.tsx
    - apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts
    - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx
  modified:
    - apps/web/src/screens/overview-mobile/MobileRiskPanel.tsx
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
decisions:
  - Exposed a computed `isLoading` (isPending && data === undefined) from the model instead of the raw isPending/data pair — the single loading gate both trees need (per Task 2 action note).
  - Left the pre-existing unused `cn` import in Analyzer.tsx untouched (surgical: my change did not orphan it; lint tolerates it).
metrics:
  duration_min: 17
  completed: 2026-07-11
  tasks: 3
  files_created: 3
  files_modified: 3
---

# Phase 36 Plan 01: Analyzer Mobile — Switch, Model, Shared Chrome Summary

Structural foundation for the dedicated mobile Analyzer tree: extracted the mobile chart
chrome into a shared `MobileChartControls` (D-05), pulled all Analyzer state/derivation into
`useAnalyzerModel()` (D-02), turned `Analyzer` into a `useIsDesktop()` switch (D-01), and
migrated every pre-existing Analyzer desktop test to the `matchMedia` stub in the same commit
that landed the switch (D-16). Desktop ≥1024px is provably unchanged and 35.1's phone-checked
Overview chart row is provably untouched.

## What shipped

- **Task 1 — `MobileChartControls` extraction (D-05).** The slim `‹ [date pill] › … ⋯`
  control row, the Projection dialog (quick-jump chips + day slider + exact date input), and
  the `⋯` toggles dialog moved VERBATIM out of `MobileRiskPanel.tsx` into
  `components/charts/MobileChartControls.tsx` (desktop sibling: `PayoffControls.tsx`), props
  `{ dateControl, bounds, toggles, onToggle }`. `MobileRiskPanel` is now a thin consumer; its
  section wrapper, `mobile-payoff` chart block, and Overview-specific `mobile-freshness`
  caption stay. All local-date math (catch #22) moved untouched. Commit `8837f17`.
- **Task 2 — `useAnalyzerModel` extraction (D-02).** All non-trivial Analyzer state/derivation
  (picker query + sorting, pasted-candidate flow, selection/combine, copy, date/toggles,
  scenario/domain, book totals, repull) moved into `analyzer-mobile/useAnalyzerModel.ts`. The
  D-02 constants/helpers (`TODAY_CURVE_COLOR`, `EXPIRATION_CURVE_COLOR`,
  `PASTED_NOT_SCORED_NOTE`, `PASTE_ERROR_COPY`, `CHIP_LABELS`, `EXPERIMENTAL_SHORT`,
  `FALLBACK_SCORE_ITEMS`, `scoreStatus`) export from the model as the single source;
  `Analyzer.tsx` re-imports them. `Analyzer()` became a thin destructure of the model with the
  JSX unchanged. Commit `5b9a48f`.
- **Task 3 — `useIsDesktop` switch + test migration (D-01/D-16).** `Analyzer` is now the thin
  switch (`isDesktop ? <AnalyzerDesktop /> : <AnalyzerMobile />`); today's body was renamed
  in-file to module-private `AnalyzerDesktop` with its JSX untouched. `AnalyzerMobile` skeleton
  root (`analyzer-mobile-root`) mounts and wires `useAnalyzerModel()` live. Three new branch
  tests (J1/J2/J9-desktop-half) plus migration of all ten pre-existing `<Analyzer />` desktop
  describes to a shared `stubDesktopMatchMedia()` helper landed in one commit. Commit `a1d2536`.

## TDD RED evidence (Task 3)

The three branch tests were written first and run before implementation. J1 failed for the
right reason (a query failure, not an import error); J2/J9 passed because the desktop tree
still rendered unconditionally pre-switch:

```
❯ src/screens/Analyzer.test.tsx (58 tests | 1 failed)
   × J1: default jsdom render mounts the MOBILE tree — no desktop grid / chips / rail
 FAIL  Analyzer branch — D-01/D-16 (36) > J1: default jsdom render mounts the MOBILE tree …
 TestingLibraryElementError: Unable to find an element by: [data-testid="analyzer-mobile-root"]
     expect(screen.getByTestId("analyzer-mobile-root")).toBeTruthy();
 Test Files  1 failed (1)
      Tests  1 failed | 57 passed (58)
```

After GREEN (skeleton + switch + test migration): `58 passed (58)`.

## Verification

| Gate | Result |
|------|--------|
| MobileRiskPanel.test.tsx (D-05 guard, `git diff --quiet` on the test file) | 13 passed, UNMODIFIED |
| Overview.test.tsx (35.1 mobile tree still mounts MobileRiskPanel) | 85 passed |
| Analyzer.test.tsx (behavior guard T2 + branch tests T3) | 55 → 58 passed; test file unmodified through Task 2 |
| `bun run test` (full workspace) | 299 files / 3327 tests passed |
| `bun run typecheck` | clean |
| `bun run lint` | clean (only pre-existing project-wide boundaries-v6 warnings) |
| `rg QUICK_JUMPS` absent from MobileRiskPanel.tsx | confirmed |

Closes validation claims J1, J2, J8 (extraction half), and the desktop call-site half of J9.

## Deviations from Plan

None — plan executed as written. Two documented judgment calls (see frontmatter `decisions`):
the model exposes a computed `isLoading` gate rather than the raw `isPending`/`data` pair (the
Task 2 action explicitly sanctioned this), and the pre-existing unused `cn` import in
Analyzer.tsx was left untouched (surgical — not orphaned by this change; lint passes).

## Notes for downstream plans

- **36-02 (AnalyzerMobile tree)** hangs off this branch: it consumes `useAnalyzerModel()`
  slices by name and `MobileChartControls` for the chart chrome. The model return shape follows
  UI-SPEC §2 (with `isLoading` in place of raw `isPending`/`data`).
- The desktop dead-branch cleanup (D-17: `order-*`, `contents lg:grid`, `-mx-3 lg:mx-0`) is a
  later plan — the migrated `mobile stack order` describe still asserts those classes on the
  desktop tree under the stub, and stays green until D-17 lands.
- `Analyzer 2.tsx` (stray) remained untracked and untouched throughout.

## Self-Check: PASSED
