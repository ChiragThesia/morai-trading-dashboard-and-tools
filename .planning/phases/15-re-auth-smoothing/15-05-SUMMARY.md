---
phase: 15-re-auth-smoothing
plan: 05
subsystem: ui
tags: [react, vitest, testing-library, banner, auth]

requires:
  - phase: 15-re-auth-smoothing (plan 01)
    provides: refreshExpiresIn field on AppTokenStatus (core domain type, contract, and status DTO)
provides:
  - Amber pre-expiry warning banner in AuthExpiredBanner.tsx, gated on refreshExpiresIn from both trader and market apps
  - Extended AuthExpiredBanner.test.tsx covering amber precedence, both-apps coverage, and no-dismiss-button
affects: [ui-review, phase-15-uat]

tech-stack:
  added: []
  patterns:
    - "sibling banner state gated by boolean variables computed above return (no IIFE in JSX)"

key-files:
  created: []
  modified:
    - apps/web/src/components/AuthExpiredBanner.tsx
    - apps/web/src/components/AuthExpiredBanner.test.tsx

key-decisions:
  - "isNearExpiry checks BOTH trader and market (worst-case) per plan's Assumption A3, while isExpired (red) stays trader-only, matching pre-existing behavior — extending red to both apps was out of scope for this plan"
  - "Amber palette (#231a08 bg / #5a4a1f border / #ffb74d text) chosen distinct from red (#180f10 / #5a2b2e / #ef5350), following the same role=alert/fixed-bottom/JetBrains Mono structural precedent"
  - "Amber copy references docs/operations/schwab-reauth-runbook.md (D-02b) in a <code> element, same visual treatment as the red banner's `auth setup` code snippet"

patterns-established:
  - "Sibling banner state: guard on data/tokenFreshness once at the top (early return), then compute isExpired/isNearExpiry booleans as plain consts before the return, branch in render order (red > amber > null)"

requirements-completed: [AUTH-05]

coverage:
  - id: D1
    description: "Amber banner renders when either app's refreshExpiresIn is non-null and no app is AUTH_EXPIRED (both-apps worst-case coverage)"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/AuthExpiredBanner.test.tsx#renders an amber alert when trader is near-expiry and no app is AUTH_EXPIRED"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/AuthExpiredBanner.test.tsx#renders an amber alert for market-only near-expiry (trader fresh)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Red banner takes precedence over amber when an app is AUTH_EXPIRED and near-expiry are both true"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/AuthExpiredBanner.test.tsx#renders the red banner (precedence) when AUTH_EXPIRED and near-expiry are both true"
        status: pass
    human_judgment: false
  - id: D3
    description: "Amber banner has no dismiss button and renders nothing when both apps are fresh with refreshExpiresIn null"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/AuthExpiredBanner.test.tsx#renders no dismiss/close button in the amber state"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/AuthExpiredBanner.test.tsx#renders nothing when both apps are fresh with refreshExpiresIn null"
        status: pass
    human_judgment: false
  - id: D4
    description: "Amber banner is visually legible and distinct from red in a real browser (manual visual check)"
    verification: []
    human_judgment: true
    rationale: "Exact amber hex/contrast legibility is a visual judgment call that unit tests (jsdom, no rendering) cannot verify — deferred to the phase-level human-verify checkpoint per the plan's optional manual verification note."

duration: 8min
completed: 2026-07-02
status: complete
---

# Phase 15 Plan 05: Amber Pre-Expiry Banner Summary

**Amber sibling state added to AuthExpiredBanner.tsx, gated on refreshExpiresIn from both trader and market apps, with red (trader-only, unchanged) taking precedence**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T19:31:00Z (approx.)
- **Completed:** 2026-07-02T19:38:00Z
- **Tasks:** 1 (TDD: RED then GREEN)
- **Files modified:** 2

## Accomplishments
- Amber pre-expiry warning banner (AUTH-05) now renders inside the T-24h window, considering both the trader and market apps' `refreshExpiresIn` (worst-case coverage per RESEARCH Assumption A3)
- Red AUTH_EXPIRED banner takes precedence over amber when both conditions are true, verified by a dedicated precedence test
- Amber banner reuses the red banner's `role="alert"`, fixed-bottom, JetBrains Mono, no-dismiss-button structural precedent with a distinct amber palette, and references the operator re-auth runbook
- `AuthExpiredBanner.test.tsx` extended: `makeStatusData` now accepts per-app `refreshExpiresIn` overrides (trader/market independently), and 5 new amber-state tests added alongside the 5 pre-existing red/none tests (all 10 pass)

## Task Commits

Each task was committed atomically (TDD red -> green):

1. **Task 1 (RED): Add failing amber-state tests** - `1fe5b9b` (test)
2. **Task 1 (GREEN): Implement amber pre-expiry banner state** - `33e7bcf` (feat)

## Files Created/Modified
- `apps/web/src/components/AuthExpiredBanner.tsx` - Added `isNearExpiry` gate (both apps) and amber branch; red gate (trader-only) unchanged; render order red > amber > null
- `apps/web/src/components/AuthExpiredBanner.test.tsx` - `makeStatusData` parametrized with per-app `refreshExpiresIn`; new `describe("AuthExpiredBanner amber pre-expiry state (AUTH-05)")` block with 5 tests

## Decisions Made
- Amber gate checks both trader and market `refreshExpiresIn` (either non-null triggers amber) — matches the plan's explicit both-apps requirement (AUTH-05, RESEARCH Open Question 2 / Assumption A3)
- Red gate left trader-only (unchanged) — extending it to both apps would have required restructuring the locked red-copy branch beyond a one-or-two-line change; documented as a residual gap per the plan's surgical-changes guidance rather than expanded in scope
- Amber palette: `backgroundColor: #231a08`, `borderTop: 1px solid #5a4a1f`, `color: #ffb74d` — distinct amber tones chosen at Claude's Discretion (CONTEXT.md D-03), visually differentiated from red (`#180f10` / `#5a2b2e` / `#ef5350`)
- Amber copy includes a runbook reference (`docs/operations/schwab-reauth-runbook.md`, D-02b) in a `<code>` element, mirroring the red banner's `auth setup` code-snippet treatment

## Deviations from Plan

None - plan executed exactly as written. The one plan-anticipated "residual gap" (red banner stays trader-only) was explicitly permitted by the plan text and is documented above and in the component's doc comment, not an unplanned deviation.

## Known Residual Gap (plan-anticipated, not a stub)

The red AUTH_EXPIRED banner remains trader-only (pre-existing behavior, unchanged by this plan). A market-only AUTH_EXPIRED state does not trigger the red banner — only the amber pre-expiry state considers both apps. This is explicitly permitted by the 15-05-PLAN.md objective ("extend red to both apps ONLY if it is genuinely the same one-or-two lines... otherwise leave red as-is and note the residual red-only gap in the SUMMARY"). Documented in the component's doc comment at `apps/web/src/components/AuthExpiredBanner.tsx`.

## Issues Encountered

The plan's `<verify>` command specifies `bun test`, but this project's test runner is Vitest (`vitest run`, confirmed via `package.json` scripts: `"test": "vitest run"`). Ran `bunx vitest run --project web apps/web/src/components/AuthExpiredBanner.test.tsx` instead — same intent, correct tool for this repo. Not a deviation requiring a rule (Rule 3 — blocking issue, trivial command substitution, no package install involved).

`bun run typecheck` (apps/web `tsc --noEmit`) surfaces pre-existing errors in `ErrorBoundary.tsx`/`.test.tsx`, `useMacro.test.ts`, `Analyzer.test.tsx`, and `JournalContainer.test.tsx` — none in the files this plan touched. Per the orchestrator's sequential-execution context, this is known pre-existing debt predating Phase 15, out of scope for this plan. Confirmed `AuthExpiredBanner.tsx`/`.test.tsx` produce zero typecheck errors of their own.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The visible half of AUTH-05 ("never a silent outage") is now complete: the web dashboard shows an amber warning inside the T-24h window and red at expiry, red taking precedence, both apps considered for amber. Phase 15's remaining human-verify checkpoint (manual browser check of amber legibility, per the plan's optional verification note) can proceed at the phase-level UAT gate. No blockers for Phase 15 completion from this plan.

---
*Phase: 15-re-auth-smoothing*
*Completed: 2026-07-02*

## Self-Check: PASSED

- FOUND: apps/web/src/components/AuthExpiredBanner.tsx
- FOUND: apps/web/src/components/AuthExpiredBanner.test.tsx
- FOUND: 1fe5b9b (test commit)
- FOUND: 33e7bcf (feat commit)
