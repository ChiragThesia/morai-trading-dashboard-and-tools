---
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
plan: 06
subsystem: ui
tags: [react, react-query, zod, base-ui, oauth, sessionStorage]

requires:
  - phase: 37-02
    provides: Browser-facing reauth Zod contracts (@morai/contracts reauthStartRequest/Response, reauthExchangeRequest/Response)
provides:
  - Boot-time OAuth callback capture/strip (reauth-callback.ts) — module-scope one-shot, StrictMode-safe
  - useReauth data hook (startReauth/exchangeReauth via apiFetch, ["status"] invalidation on success)
  - ReauthWizard modal — sequential trader->market step machine with per-app failure isolation + sessionStorage cross-redirect continuity
  - AuthExpiredBanner Reconnect entry point (red + amber branches) + main.tsx boot wiring
affects: [37-07 (integration gate + human UAT consumes this wizard end-to-end)]

tech-stack:
  added: []
  patterns:
    - "Module-scope one-shot capture (consumeCapturedRedirect) as the StrictMode-double-invoke guard, rather than relying on lazy useState initializer semantics"
    - "sessionStorage completed-apps set for cross-full-page-redirect wizard continuity (OAuth legs are separate page loads, destroying React state)"

key-files:
  created:
    - apps/web/src/lib/reauth-callback.ts
    - apps/web/src/lib/reauth-callback.test.ts
    - apps/web/src/hooks/useReauth.ts
    - apps/web/src/hooks/useReauth.test.ts
    - apps/web/src/components/ReauthWizard.tsx
    - apps/web/src/components/ReauthWizard.test.tsx
  modified:
    - apps/web/src/components/AuthExpiredBanner.tsx
    - apps/web/src/components/AuthExpiredBanner.test.tsx
    - apps/web/src/main.tsx

key-decisions:
  - "The wizard's mount effect (not a useState lazy initializer) is what actually calls consumeCapturedRedirect() — a lazy initializer function is documented to be double-invoked by React StrictMode, which would silently discard the captured redirect on one of the two calls; doing the one-shot read inside useEffect(fn, []) means the second (no-op, null) invocation is provably harmless regardless of exactly how React schedules the two calls."
  - "Added a small sessionStorage 'reauth-completed-apps' record (not in the PLAN's literal task text, but required for correctness) so a fresh page mount after the market OAuth leg's redirect knows trader already succeeded — each leg is a full same-tab navigation away and back, which destroys all in-memory React state between legs. Cleared once both apps succeed, ready for the next 7-day cycle. ponytail: a plain completed-set, not itself keyed by the OAuth state nonce — sufficient for a strictly-sequential 2-step wizard; add per-nonce tracking only if a non-sequential resume path is ever introduced."
  - "DialogContent renders with showCloseButton={false} (RebuildButton.tsx precedent) — the default shadcn dialog X control and the wizard's own Done-state 'Close' button both have the accessible name 'Close', which is ambiguous for both users and tests; the wizard's explicit Close CTA is the intended dismiss action."

requirements-completed: [REAUTH-06]

coverage:
  - id: D1
    description: "Boot-time OAuth callback capture/strip (parseReauthRedirect/captureAndStripReauthRedirect/consumeCapturedRedirect) never logs the code/state, strips before use, one-shot consumption"
    requirement: "REAUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/reauth-callback.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "useReauth hook: startReauth/exchangeReauth via apiFetch parsed through @morai/contracts, exchange success invalidates [\"status\"]"
    requirement: "REAUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useReauth.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "ReauthWizard: trader->market sequential step machine, per-app failure isolation with scoped Retry, completed-chip continuity, silent auto-resume, never renders code/state/redirect"
    requirement: "REAUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/src/components/ReauthWizard.test.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "AuthExpiredBanner red + amber branches render the Reconnect CTA with the locked UI-SPEC copy; main.tsx strips the callback at boot before render"
    requirement: "REAUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/src/components/AuthExpiredBanner.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "End-to-end live operator flow (real Schwab redirect round-trip, phone/touch UAT)"
    verification: []
    human_judgment: true
    rationale: "Requires a real Schwab OAuth round trip against the live sidecar/server (37-04/37-05), gated in 37-07's integration gate + human UAT — cannot be proven by web-layer unit tests alone."

duration: ~35min
completed: 2026-07-13
status: complete
---

# Phase 37 Plan 06: Web Reconnect Wizard + Callback Capture + Banner Summary

**Boot-time OAuth callback capture/strip, a useReauth data hook, a sequential trader->market ReauthWizard modal with sessionStorage-backed cross-redirect continuity, and the AuthExpiredBanner Reconnect entry point wired at both red and amber states.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments
- `reauth-callback.ts`: pure `parseReauthRedirect`, imperative `captureAndStripReauthRedirect` (strip-before-use via `history.replaceState`), and one-shot `consumeCapturedRedirect` — never logs the code/state/redirect URL.
- `useReauth.ts`: `startReauth`/`exchangeReauth` mutations via `apiFetch`, parsed through the `@morai/contracts` reauth schemas (parse-don't-cast), exchange success invalidates the `["status"]` query.
- `ReauthWizard.tsx`: Trader (1/2) -> Market (2/2) step chips, idle/confirming/success/failure per-app states, scoped Retry (per-app failure isolation), silent auto-resume on landing, Done state with Close. A `sessionStorage` completed-apps record survives the full-page reload between the two OAuth legs so the wizard resumes at the correct step with the right chip filled.
- `AuthExpiredBanner.tsx`: red and amber branches now render `ReauthWizard`'s Reconnect trigger with the UI-SPEC-locked copy, superseding the old CLI-runbook copy (the runbook still documents the CLI fallback separately).
- `main.tsx`: `captureAndStripReauthRedirect()` runs as the first statement at module scope, before `createRoot(...).render(...)`.

## Task Commits

Each task was committed atomically (TDD RED confirmed before each GREEN):

1. **Task 1: reauth-callback capture/strip + useReauth hook** - `d3e0df5` (feat)
2. **Task 2: ReauthWizard modal — sequential step machine** - `1e89506` (feat)
3. **Task 3: Banner Reconnect entry + main.tsx boot capture** - `d5f522e` (feat)

## Files Created/Modified
- `apps/web/src/lib/reauth-callback.ts` - capture/strip/consume, module-scope one-shot
- `apps/web/src/lib/reauth-callback.test.ts` - 8 tests
- `apps/web/src/hooks/useReauth.ts` - startReauth/exchangeReauth mutations
- `apps/web/src/hooks/useReauth.test.ts` - 5 tests
- `apps/web/src/components/ReauthWizard.tsx` - the modal + step machine
- `apps/web/src/components/ReauthWizard.test.tsx` - 5 tests
- `apps/web/src/components/AuthExpiredBanner.tsx` - Reconnect CTA in red + amber branches, new UI-SPEC copy
- `apps/web/src/components/AuthExpiredBanner.test.tsx` - updated to assert the Reconnect button + new copy (was: no-button assertion)
- `apps/web/src/main.tsx` - boot-time capture/strip wiring

## Decisions Made
- Auto-resume consumption lives in `useEffect(fn, [])`, not a `useState` lazy initializer — React's documented StrictMode double-invoke of lazy initializers could silently discard the captured redirect; the effect-based one-shot is provably safe regardless of invocation order.
- Added a `sessionStorage` completed-apps record (Rule 2 — auto-add missing critical functionality): the PLAN's task text didn't specify how the wizard would know, on a fresh page load after the *second* OAuth leg's redirect, that the *first* app already succeeded. Without it, the chip/step display after a full reload would default to "trader idle" and only look correct by coincidence of a fallback default matching the OR-condition in the chip's active check — fragile, not a deliberate guarantee. The persisted set (cleared once both apps succeed) makes this correct by construction.
- `showCloseButton={false}` on the wizard's `DialogContent` (mirrors `RebuildButton.tsx`) to avoid two controls both named "Close" (the generic dialog X and the Done-state CTA).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] sessionStorage cross-redirect continuity**
- **Found during:** Task 2 (ReauthWizard)
- **Issue:** The PLAN's task text described only a module-level one-shot captured-redirect variable, which is destroyed by the full-page navigation between the trader and market OAuth legs. Without persisted progress, a fresh mount after the market leg's redirect has no way to know trader already succeeded, other than an accidental coincidence of default state.
- **Fix:** A `reauth-completed-apps` sessionStorage record (JSON array of completed apps), read at mount to seed `WizardState`, written after each successful exchange, cleared once both apps are done.
- **Files modified:** `apps/web/src/components/ReauthWizard.tsx`
- **Verification:** `ReauthWizard.test.tsx` "reaches the Done state (both chips filled) once market succeeds after trader already completed" seeds sessionStorage and asserts both chips render filled.
- **Committed in:** `1e89506` (part of Task 2 commit)

**2. [Rule 1 - bug] Ambiguous duplicate "Close" accessible name**
- **Found during:** Task 2 (ReauthWizard), surfaced by a failing test
- **Issue:** The default shadcn `DialogContent` renders its own X close button with accessible name "Close" (via an `sr-only` span), colliding with the wizard's own Done-state "Close" button — `getByRole("button", { name: "Close" })` matched two elements.
- **Fix:** `showCloseButton={false}` on the wizard's `DialogContent`, following the existing `RebuildButton.tsx` precedent for dialogs with their own explicit action buttons.
- **Files modified:** `apps/web/src/components/ReauthWizard.tsx`
- **Verification:** Full `ReauthWizard.test.tsx` suite green.
- **Committed in:** `1e89506` (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2, 1 Rule 1).
**Impact on plan:** Both were necessary for correctness (cross-redirect continuity is core to the two-leg sequential wizard actually working) and for an unambiguous test/accessibility surface. No scope creep — no new files beyond what the PLAN specified.

## Issues Encountered
None beyond the two auto-fixes above.

## User Setup Required
None — no external service configuration required in this plan. (Railway env vars `SIDECAR_ADMIN_TOKEN` etc. belong to 37-03/37-04/37-05, already handled there.)

## Next Phase Readiness
- 37-07 (integration gate + runbook + deploy/env + human UAT) can now exercise the full web wizard end-to-end against the live sidecar/server endpoints from 37-04/37-05.
- No blockers. Ran in parallel with 37-04 (`apps/sidecar/*.py`) and 37-05 (`apps/server/**`) on disjoint files — no conflicts observed; each task committed individually, and the full `apps/web` suite (67 files / 794 tests) is green with no regressions.

---
*Phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the*
*Completed: 2026-07-13*

## Self-Check: PASSED
All 6 created files (reauth-callback.ts/.test.ts, useReauth.ts/.test.ts, ReauthWizard.tsx/.test.tsx) and the 3 modified files (AuthExpiredBanner.tsx/.test.tsx, main.tsx) confirmed present on disk with the expected changes; all 3 task commit hashes (d3e0df5, 1e89506, d5f522e) confirmed in git log; full apps/web suite (67 files, 794 tests) passes.
