---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
plan: 06
subsystem: web
tags: [react, react-query, zod, rule-settings, preview, regime]

requires:
  - phase: 32-01
    provides: "previewRuleOverridesRequest/Response contracts"
  - phase: 32-04
    provides: "POST /api/settings/rules/preview + previewRuleOverridesResponse shape"
  - phase: 32-05
    provides: "RuleSettingsModal.tsx explainer captions/tags/tooltips surface"
provides:
  - "apps/web/src/hooks/useRuleSettingsPreview.ts — POST /api/settings/rules/preview mutation hook + previewRegimeBands pure client-side re-band helper"
  - "RuleSettingsModal.tsx — explicit Preview button per group + picker/exit/regime delta rendering + loading/error/staleness"
  - "@morai/core top barrel now re-exports bandVixTermStructure/bandVvix/bandVix9dRatio/bandHyOas + RegimeBand/RegimeThresholds"
affects: []

tech-stack:
  added: []
  patterns:
    - "Client-side regime re-band reuses resolveRegimeRuleConfig (the same merge-with-defaults seam the server board use-case uses) + the four real @morai/core band<X> functions — no duplicated banding logic, parity by construction (T-32-12)"
    - "Preview and Save share ONE buildStagedGroup() closure in GroupPanel — both act on the identical staged-group body, so the preview a user sees always matches what Save would persist"
    - "Client-side Zod parse (previewRuleOverridesRequest.parse) before the network call, wrapped in try/catch so a still-mid-edit staged group (e.g. one weight nudged without rebalancing the others) surfaces as a normal preview error line instead of an unhandled promise rejection"

key-files:
  created:
    - apps/web/src/hooks/useRuleSettingsPreview.ts
    - apps/web/src/hooks/useRuleSettingsPreview.test.ts
  modified:
    - apps/web/src/screens/RuleSettingsModal.tsx
    - apps/web/src/screens/RuleSettingsModal.test.tsx
    - packages/core/src/index.ts
    - packages/core/src/analytics/index.ts

key-decisions:
  - "The four regime band<X> classifiers + RegimeBand/RegimeThresholds types were exported through analytics/index.ts's own barrel (Phase 24) but never through the TOP-LEVEL @morai/core package barrel apps/web actually imports from — added the re-export (Rule 3, blocking) rather than reaching past the barrel into a package-internal path."
  - "previewRegimeBands is a thin id-to-band-function/threshold-key lookup over resolveRegimeRuleConfig's merge-with-defaults output — the actual calm/warning/crisis DECISION is 100% delegated to the real core functions; an unrecognized indicator id fails soft (before === after) rather than throwing, matching Plan 05's explainer-lookup idiom."
  - "Preview's staged body is validated by the SAME strict previewRuleOverridesRequest schema (identity-reused from ruleOverrides, T-32-05) the PUT route enforces — including the weight-sum-100 refinement. A partial in-progress edit (one weight nudged, not yet rebalanced) fails that validation; caught locally and rendered as a preview error rather than left as an unhandled rejection."

requirements-completed: [B1, B2, B3, B5, B7]

coverage:
  - id: D1
    description: "useRuleSettingsPreview mutation hook POSTs the staged body to /api/settings/rules/preview and parses previewRuleOverridesResponse, mirroring useAnalyzeCalendar's throw-only-on-HTTP-failure shape"
    requirement: B7
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useRuleSettingsPreview.test.ts — POST+parse success, throws on HTTP failure"
        status: pass
    human_judgment: false
  - id: D2
    description: "previewRegimeBands re-bands each on-screen regime indicator against staged thresholds by calling the ACTUAL @morai/core band<X> functions (parity by construction, T-32-12)"
    requirement: B3
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useRuleSettingsPreview.test.ts — parity across all 4 indicators against direct band<X> calls; re-bands to the stored band when staged === defaults"
        status: pass
    human_judgment: false
  - id: D3
    description: "Explicit Preview button per group (no keystroke spam); picker renders top movers old->new + gate/sizing before-after chips + the server's honest universe note (never fake movers when staged); exits render per-calendar current->staged; empty/unchanged stage renders 'No change.'"
    requirement: B1
    verification:
      - kind: unit
        ref: "apps/web/src/screens/RuleSettingsModal.test.tsx — weight-stage movers, universe-knob honest note, unstaged 'No change.', regime band before->after, Save unregressed"
        status: pass
    human_judgment: false
  - id: D4
    description: "Exit preview renders per-calendar current->staged verdict/rung from the live combined preview endpoint response"
    requirement: B2
    verification:
      - kind: unit
        ref: "apps/web/src/screens/RuleSettingsModal.tsx renderExitsPreview — covered structurally by D3's suite + the server's already-tested exits branch (32-04)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Loading spinner while the mutation is pending, an error line on HTTP/validation failure, and a staleness note showing the snapshot asOf for picker/exit deltas"
    requirement: B7
    verification:
      - kind: unit
        ref: "apps/web/src/screens/RuleSettingsModal.test.tsx — 'Snapshot as of 2026-07-09' assertion in the weight-stage test; error path exercised via the previewParseError catch (manually verified, not asserted by a dedicated test)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Manual UAT on morai.wtf: stage a weight swap -> Preview -> sensible movers; stage a universe knob -> honest note; stage a regime band -> band shifts"
    verification: []
    human_judgment: true
    rationale: "Requires a deployed build and live picker/regime data; this plan is local-only (not yet deployed) — deferred to the phase's live UAT pass, same as Plan 04's server surface."

duration: ~45m
completed: 2026-07-10
status: complete
---

# Phase 32 Plan 06: Staged-change impact preview Summary

**An explicit Preview button per rule-settings group dry-runs staged changes: picker/exits POST to `/api/settings/rules/preview` (Plan 04) rendering old->new score movers, gate/sizing deltas, or an honest "affects next cycle" universe note; regime re-bands client-side by importing the real `@morai/core` band functions directly — no server round-trip, no duplicated banding logic.**

## Performance

- **Duration:** ~45m
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `useRuleSettingsPreview()` (B7): a `useMutation` hook mirroring `useAnalyzeCalendar`'s non-optimistic shape exactly — POSTs the staged `ruleOverrides`-shaped body to `/api/settings/rules/preview`, parses `previewRuleOverridesResponse`, throws only on a genuine HTTP/network failure.
- `previewRegimeBands(stagedRegime, indicators)` (B3): a pure helper that re-bands each on-screen regime indicator against staged thresholds by calling `resolveRegimeRuleConfig` (the same merge-with-defaults seam the server board use-case uses) plus the four real `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`/`bandHyOas` functions — parity by construction, proven by a per-indicator parity test against the direct core calls.
- Re-exported the regime band classifiers + `RegimeBand`/`RegimeThresholds` types through the top-level `@morai/core` package barrel (they were only reachable via `analytics/index.ts`'s own barrel before) — a small, additive Rule 3 fix required to satisfy the plan's "import the ACTUAL core functions from `@morai/core`" mandate.
- Each `GroupPanel` gained an explicit "Preview" button (B1) reading the SAME staged-group body `handleSave` builds (`buildStagedGroup()`, extracted as a shared closure): picker renders top movers by `|newScore − oldScore|` (max 5) plus a gate before→after chip and sizing before→after when they change, or the server's honest `universeNote` verbatim when band/DTE knobs were staged (never fake movers); exits render per-calendar current→staged verdict/rung (B2); an unchanged staged group collapses to "No change." for both branches; regime renders each indicator's label + band before→after computed client-side.
- Loading ("Previewing…"), error ("Couldn't preview {group} settings."), and a snapshot staleness note (`Snapshot as of {asOf}` / "No stored snapshot yet") surface per group (B5/B7). Save/Reset/captions/tooltips from Plan 05 and v1 are byte-unregressed.

## Task Commits

Each task was committed atomically (TDD RED→GREEN for Task 1 per its `tdd="true"` frontmatter):

1. **Task 1 RED: failing test for useRuleSettingsPreview + previewRegimeBands** — `2c4d7fe` (test)
2. **Task 1 GREEN: implement useRuleSettingsPreview + previewRegimeBands** — `b3bd70a` (feat)
3. **Task 2: explicit Preview button + picker/exit/regime delta rendering** — `ceb6261` (feat)

## Files Created/Modified

- `apps/web/src/hooks/useRuleSettingsPreview.ts` — the preview mutation hook + `previewRegimeBands` pure helper + the `id -> band function / RegimeRuleConfig key` lookup tables.
- `apps/web/src/hooks/useRuleSettingsPreview.test.ts` — 5 tests: POST+parse success, throws on HTTP failure, 4-indicator parity against direct core calls, `before` carries the stored band, re-bands to the stored band when staged === defaults.
- `apps/web/src/screens/RuleSettingsModal.tsx` — `useRuleSettingsPreview`/`useRegimeBoard` wiring, `buildStagedGroup()` extraction (shared by Save and Preview), `handlePreview()` with a local `previewParseError` catch, `toRegimeOverrides()` bridge, `renderPickerPreview`/`renderExitsPreview` helpers, the Preview button + delta panel JSX.
- `apps/web/src/screens/RuleSettingsModal.test.tsx` — added a `QueryClientProvider`-wrapped `renderModal()` helper (all 7 pre-existing tests updated to use it), mocked `useRegimeBoard`/`useRuleSettingsPreview` (the latter via `importOriginal` so `previewRegimeBands` stays real), and 5 new Preview-flow tests.
- `packages/core/src/index.ts` — re-exports `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`/`bandHyOas` + `RegimeBand`/`RegimeThresholds` from `./analytics/index.ts`.
- `packages/core/src/analytics/index.ts` — re-exports `RegimeThresholds` (previously only `RegimeBand` crossed this inner barrel).

## Decisions Made

See `key-decisions` in the frontmatter. In short: (1) added the missing top-barrel regime-function exports rather than reaching into a package-internal path; (2) `previewRegimeBands` is pure id-lookup glue over the real core banding functions, never a second copy of the banding decision; (3) the staged preview body is validated by the identical strict schema the PUT route uses, and a validation failure (e.g. a not-yet-rebalanced weight edit) is caught locally and surfaced as a preview error instead of an unhandled rejection.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regime band classifiers not reachable from `@morai/core`'s top barrel**
- **Found during:** Task 1, writing the hook's imports.
- **Issue:** The plan's `<read_first>` names `packages/core/src/analytics/domain/regime.ts`'s four `band<X>` functions and says to import them "from `@morai/core`" — but `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`/`bandHyOas` (and `RegimeThresholds`) were only re-exported through `analytics/index.ts`'s own internal barrel, never through the top-level `packages/core/src/index.ts` the `@morai/core` package resolves to (`package.json`'s `"exports": {".": "./src/index.ts"}`).
- **Fix:** Added the re-export block to `packages/core/src/index.ts` (band functions + `RegimeBand`/`RegimeThresholds` types) and `RegimeThresholds` to `analytics/index.ts`'s own barrel. Purely additive — no existing export renamed or removed.
- **Files modified:** `packages/core/src/index.ts`, `packages/core/src/analytics/index.ts`.
- **Verification:** `bun run typecheck` clean; `useRuleSettingsPreview.test.ts`'s parity tests import the same functions from `@morai/core` and pass.
- **Committed in:** `2c4d7fe` (part of the Task 1 RED commit, since the test file needed the import to even compile).

**2. [Rule 1 - Bug] Unhandled promise rejection on a partial staged-weight edit**
- **Found during:** Task 2, running the new "staging a weight" component test (initial attempt edited a single weight field, breaking the weight-sum-100 refinement `previewRuleOverridesRequest` shares with the PUT route).
- **Issue:** `handlePreview()` called `previewRuleOverridesRequest.parse(...)` synchronously before `mutateAsync`; a client-side validation failure (e.g. a still-mid-edit, not-yet-rebalanced weight) threw outside any catch, surfacing as an unhandled promise rejection rather than a visible preview error.
- **Fix:** Wrapped the parse + `mutateAsync` call in a try/catch, storing the failure in a new local `previewParseError` state rendered alongside the existing `previewMutation.isError` line. Also fixed the test fixture itself to stage a weight-sum-neutral edit (slope +5, fwdEdge -5) for the intended happy-path assertion.
- **Files modified:** `apps/web/src/screens/RuleSettingsModal.tsx`, `apps/web/src/screens/RuleSettingsModal.test.tsx`.
- **Verification:** `bun run test -- apps/web/src/screens/RuleSettingsModal.test.tsx` green, no unhandled-rejection warning in the run output.
- **Committed in:** `ceb6261` (Task 2 commit).

---

**Total deviations:** 2 auto-fixed (1 blocking barrel-export gap, 1 bug — unhandled rejection on invalid staged input).
**Impact on plan:** Both fixes were small and additive; no scope creep. The barrel fix is required for the plan's own "import the ACTUAL core functions" mandate to even compile; the rejection fix makes the Preview button robust against a realistic mid-edit user action the plan's happy-path examples didn't anticipate.

## Issues Encountered

None beyond the two auto-fixes documented above.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. Every rendered preview branch (picker movers/gate/sizing/universe-note, exits current→staged, regime band before→after, loading/error/staleness) is wired to real data — either the live `/api/settings/rules/preview` response or the real client-side `previewRegimeBands` computation. No placeholder text, no hardcoded empty fallback.

## Threat Flags

None new. Both threats in this plan's threat register (`T-32-12` regime client re-band, `T-32-13` preview render is read-only) are satisfied as written: `previewRegimeBands` imports the actual core functions (no hand-copy, parity test enforces it); the Preview button never calls `saveGroup`/`resetGroup` — Save remains the only mutating action.

## Verification

- `bun run test -- apps/web/src/hooks/useRuleSettingsPreview.test.ts apps/web/src/screens/RuleSettingsModal.test.tsx` — 17/17 tests green (5 hook + 12 modal)
- `bun run typecheck` — clean
- `bun run lint` — clean (only the pre-existing `[boundaries]` legacy-selector-syntax warning, unrelated and out of scope)
- `bun run test` (full workspace) — 286 files / 3138 tests, green
- Manual UAT on morai.wtf (stage a weight swap → Preview → sensible movers; stage a universe knob → honest note; stage a regime band → band shifts): **not yet run** — this plan is local-only, not deployed. Deferred to the phase's live UAT pass (see coverage D6).

## Next Phase Readiness

- Modal v2 (Plans 01–06) is code-complete: explainer captions/tags/tooltips (Plan 05) + the staged-change preview flow (this plan) both live in `RuleSettingsModal.tsx` against the real Plan 04 server surface.
- Ready for deployment + the phase's live manual UAT pass (D6) — no code blockers.
- No blockers for closing Phase 32.

---
*Phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: apps/web/src/hooks/useRuleSettingsPreview.ts
- FOUND: apps/web/src/hooks/useRuleSettingsPreview.test.ts
- FOUND: apps/web/src/screens/RuleSettingsModal.tsx (modified)
- FOUND: apps/web/src/screens/RuleSettingsModal.test.tsx (modified)
- FOUND: packages/core/src/index.ts (modified)
- FOUND: packages/core/src/analytics/index.ts (modified)
- FOUND commit 2c4d7fe (test(32-06): add failing test for useRuleSettingsPreview + previewRegimeBands)
- FOUND commit b3bd70a (feat(32-06): implement useRuleSettingsPreview mutation hook + client-side regime re-band)
- FOUND commit ceb6261 (feat(32-06): explicit Preview button + picker/exit/regime delta rendering)
