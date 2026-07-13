---
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
plan: 07
subsystem: docs
tags: [integration-gate, runbook, deploy-docs, vitest, pytest, eslint]

requires:
  - phase: 37-04
    provides: sidecar admin endpoints (/sidecar/admin/reauth/start, /exchange)
  - phase: 37-05
    provides: server proxy routes (/api/reauth/start, /exchange) + SIDECAR_ADMIN_TOKEN config
  - phase: 37-06
    provides: web ReauthWizard + AuthExpiredBanner Reconnect entry point
provides:
  - "Full cross-layer green gate: TS workspace (311 files / 3423 tests), sidecar pytest (84 tests), typecheck, lint"
  - "docs/operations/schwab-reauth-runbook.md — wizard documented as primary re-auth path, CLI kept as labeled fallback, Railway deploy prerequisites recorded"
  - "Fix for a real cross-layer wiring gap: config.test.ts's shared fixture never threaded the new SIDECAR_ADMIN_TOKEN field"
affects: []

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - apps/server/src/config.test.ts
    - apps/web/src/components/ReauthWizard.tsx
    - docs/operations/schwab-reauth-runbook.md
    - docs/TOPIC-MAP.md

key-decisions:
  - "The 39-typecheck-error report from exec-37-06 did not reproduce: a clean `bun run typecheck` (exit 0, zero errors) on the current commit history. 37-04/37-05/37-06 shared one working tree/index while executing in parallel (already documented in 37-05's own SUMMARY under 'Coordination Note') — a typecheck run during that concurrent window would have observed a transient half-written state (e.g. before 37-05's barrel-export fix landed), not a real defect. No bisection needed since the defect is absent at HEAD; no code changes attributed to this item beyond the two real gate failures below."
  - "config.test.ts's BASE_VALID_ENV fixture was missing SIDECAR_ADMIN_TOKEN (added by 37-05's config.ts change), failing 5 of its own tests. Rule 1 fix: added the field once to the shared fixture object (root cause, all 5 failures share this one cause) rather than patching each test."
  - "ReauthWizard.tsx carried `// eslint-disable-next-line react-hooks/exhaustive-deps` above a useEffect, but this project's eslint.config.js never registers the react-hooks plugin (confirmed: no other file in the repo uses this rule name, and grep of the flat config shows zero react-hooks references). ESLint errors on disable comments naming a rule with no registered definition. Rule 1 fix: removed the dead comment — the underlying effect behavior (module-scope one-shot guarded by consumeCapturedRedirect(), documented in the adjacent comment) is unaffected, since the rule was never enforced in this project to begin with."
  - "Updated docs/TOPIC-MAP.md's one-line description of the runbook (CLI-only phrasing was stale) alongside the runbook itself — required by this plan's own action text and the docs.md cross-reference-consistency rule, even though TOPIC-MAP.md wasn't in the plan frontmatter's files_modified list."

requirements-completed: [REAUTH-07]

coverage:
  - id: D1
    description: "Runbook documents the in-app wizard as the primary re-auth path (banner Reconnect -> Trader -> Market -> auto-clear) and keeps seed_token.py as the explicitly-labeled fallback"
    requirement: REAUTH-07
    verification:
      - kind: other
        ref: "grep -Eiq 'reconnect|wizard|banner' docs/operations/schwab-reauth-runbook.md && grep -Eiq 'fallback' docs/operations/schwab-reauth-runbook.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "Full cross-layer integration gate: TS workspace test suite, sidecar pytest suite, root typecheck, root lint — all green"
    requirement: REAUTH-07
    verification:
      - kind: integration
        ref: "bun run test (311 test files / 3423 tests passed)"
        status: pass
      - kind: integration
        ref: "cd apps/sidecar && .venv/bin/python -m pytest -q (84 passed)"
        status: pass
      - kind: unit
        ref: "bun run typecheck (tsc --build --force, exit 0)"
        status: pass
      - kind: unit
        ref: "bun run lint (eslint ., exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Railway deploy prerequisites recorded in the runbook: SIDECAR_ADMIN_TOKEN identical on server + sidecar, SCHWAB_WEB_CALLBACK_URL on sidecar, both Schwab-app callback registration — no secret values committed"
    requirement: REAUTH-07
    verification:
      - kind: manual_procedural
        ref: "docs/operations/schwab-reauth-runbook.md#deploy-prerequisites-railway (reviewed for absence of any secret value, only variable names + placement)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live human UAT: the next real Schwab re-auth (~2026-07-20) performed through the wizard end-to-end, confirming URL param strip, both apps connected, banner clears in ~30s, live data resumes, and per-app retry isolation on a partial failure"
    verification: []
    human_judgment: true
    rationale: "Requires an actual Schwab OAuth round trip against the live deployed sidecar/server/web stack during the real 7-day expiry window — cannot be proven by any test run today. This is the plan's designated human-check gate."

duration: ~30min
completed: 2026-07-13
status: complete
---

# Phase 37 Plan 07: Integration Gate + Runbook + Deploy/Env Documentation Summary

**Closed Phase 37 by proving every layer (sidecar, server, web) integrates on a single green gate — TS suite 311/311 files (3423 tests), sidecar pytest 84/84, typecheck and lint both clean after two real cross-layer fixes — and rewrote the operator runbook so the in-app wizard is the primary re-auth path, with the CLI kept as documented fallback and Railway deploy prerequisites recorded.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2/2 completed
- **Files modified:** 4 (0 created)

## Accomplishments

- Ran the full phase-close gate exactly as specified: `bun run test` (TS workspace), `cd apps/sidecar && python -m pytest` (via `.venv/bin/python`), `bun run typecheck`, `bun run lint`. Found and fixed two real cross-layer gaps surfaced by the gate itself (see Deviations) — both fixed, both re-verified green.
- Investigated the known-issue item (exec-37-06's report of 39 pre-existing typecheck errors in `apps/web` test files). It does not reproduce at HEAD: `bun run typecheck` is clean (exit 0, zero errors, zero output). Concluded this was a transient artifact of 37-04/37-05/37-06 sharing one working tree/index while executing in parallel — 37-05's own SUMMARY already documents this exact hazard under "Coordination Note" (a commit from one executor could sweep files mid-flight from another). No further action needed; the defect isn't present in the committed history this plan gates against.
- Rewrote `docs/operations/schwab-reauth-runbook.md`: the in-app Reconnect wizard is now the documented primary path (banner Reconnect -> Trader step -> Market step -> silent exchange -> banner clears in ~30s), with a troubleshooting note for per-app retry-only-the-failed-app (mirrors the CLI's existing "do NOT restart the sidecar" rule). The existing CLI steps (`seed_token.py authurl`/`exchange`/`login`, the mandatory sidecar restart, post-restart verification) are unchanged in content, now explicitly labeled as the fallback path for when the app itself is down. Added a "Deploy Prerequisites (Railway)" section: `SIDECAR_ADMIN_TOKEN` must be identical on both the `server` and `sidecar` Railway services, `SCHWAB_WEB_CALLBACK_URL=https://morai.wtf` on the sidecar, and both Schwab Developer Portal apps must have the callback registered — no secret values, only variable names and placement.
- Updated `docs/TOPIC-MAP.md`'s one-line description of the runbook (was CLI-only phrasing) to match the new wizard-primary/CLI-fallback structure, per the docs.md cross-reference rule the plan's own task text calls out.

## Task Commits

1. **Task 1: Runbook — add the UI (wizard) path** + **Task 2: Full-suite integration gate + deploy prerequisites** were executed together since the gate's own fixes and the runbook content landed as a natural pair of commits:
   - `320328a` (fix): `apps/server/src/config.test.ts` (+ SIDECAR_ADMIN_TOKEN fixture field), `apps/web/src/components/ReauthWizard.tsx` (- dead eslint-disable comment)
   - `62b8e29` (docs): `docs/operations/schwab-reauth-runbook.md` (wizard primary path + CLI fallback label + deploy prerequisites), `docs/TOPIC-MAP.md` (description sync)

## Files Created/Modified

- `apps/server/src/config.test.ts` — added `SIDECAR_ADMIN_TOKEN: "a-valid-admin-token-1234"` to the shared `BASE_VALID_ENV` fixture object.
- `apps/web/src/components/ReauthWizard.tsx` — removed one dead `eslint-disable-next-line react-hooks/exhaustive-deps` comment; no behavior change.
- `docs/operations/schwab-reauth-runbook.md` — new "Primary Path: The In-App Wizard" section, "Fallback: The CLI" label above the unchanged existing steps, new "Deploy Prerequisites (Railway)" section.
- `docs/TOPIC-MAP.md` — one-line description sync for the runbook row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `config.test.ts`'s shared fixture never threaded the new `SIDECAR_ADMIN_TOKEN` field**
- **Found during:** Task 2, running the full `bun run test` gate.
- **Issue:** 37-05 added `SIDECAR_ADMIN_TOKEN: z.string().min(16, ...)` as a required field on `apps/server/src/config.ts`'s schema, but `apps/server/src/config.test.ts`'s `BASE_VALID_ENV` object (shared by every test in the file via spread) was never updated to include it. 5 of the file's own tests failed with a `ZodError` naming `SIDECAR_ADMIN_TOKEN` as missing.
- **Fix:** Added `SIDECAR_ADMIN_TOKEN: "a-valid-admin-token-1234"` (24 chars, satisfies the 16-char minimum) to the one shared fixture object — root-cause fix since all 5 failures shared this single cause.
- **Files modified:** `apps/server/src/config.test.ts`.
- **Verification:** `bunx vitest run --project server src/config.test.ts` — 14/14 passed. Full `bun run test` re-run afterward — 311 files / 3423 tests, all green.
- **Commit:** `320328a`

**2. [Rule 1 - Bug] Dead `eslint-disable-next-line react-hooks/exhaustive-deps` comment fails lint**
- **Found during:** Task 2, running `bun run lint`.
- **Issue:** `ReauthWizard.tsx` (from 37-06) carried an `eslint-disable-next-line react-hooks/exhaustive-deps` comment above a `useEffect(fn, [])`. This project's `eslint.config.js` never registers the `react-hooks` plugin (confirmed by grep: zero matches for `react-hooks` in the flat config, and zero other files in the repo reference this rule name). ESLint's flat-config engine errors when a disable comment names a rule with no loaded definition ("Definition for rule 'react-hooks/exhaustive-deps' was not found").
- **Fix:** Removed the dead disable comment. No behavior change — the rule was never enforced in this project, so the comment did nothing except break lint. The explanatory comment above it (documenting the one-shot `consumeCapturedRedirect()` mount-effect pattern) stays.
- **Files modified:** `apps/web/src/components/ReauthWizard.tsx`.
- **Verification:** `bun run lint` — exit 0, only pre-existing repo-wide config warnings remain (multiple-tsconfig-projects notice, boundaries legacy-selector notice — both unrelated to phase 37, out of scope per the executor's scope-boundary rule). Re-ran `bunx vitest run --project web src/components/ReauthWizard.test.tsx` — 5/5 passed, confirming the effect's behavior is unchanged.
- **Commit:** `320328a`

### Investigated, No Fix Needed

**3. exec-37-06's reported 39 pre-existing typecheck errors**
- **Investigated:** Ran `bun run typecheck` (`tsc --build --force`) fresh at HEAD (after all of 37-01 through 37-06's commits landed). Exit 0, zero output, zero errors — including in the four files named in the known-issue brief (`JournalMobile.test.tsx`, `JournalContainer.test.tsx`, `Market.test.tsx`, `Overview.test.tsx`, all under `apps/web/src/screens/`, not `apps/web/src/pages/` as the brief's paths suggested — the actual location was confirmed via `find`).
- **Conclusion:** Not a real defect at HEAD. 37-04 (`apps/sidecar`), 37-05 (`apps/server`), and 37-06 (`apps/web`) executed in parallel against one shared working tree/index — 37-05's own SUMMARY documents this exact hazard under "Coordination Note" (a commit without a pathspec swept in another executor's staged files). A typecheck run during that concurrent window could plausibly have observed a transient, half-written intermediate state (e.g., before 37-05's `packages/adapters/src/index.ts` barrel-export fix landed, which 37-05's own Deviations section documents as a real gap it found and fixed). No bisection against a stashed state was performed since the defect does not reproduce today — there is nothing to bisect toward. No code changes made for this item.

## Issues Encountered

None beyond the two auto-fixed gate failures and the investigated non-reproducing typecheck report, both covered above.

## User Setup Required

Before deploy (owned by the orchestrator, not this plan — documentation only per this plan's scope):
- Set `SIDECAR_ADMIN_TOKEN` to the same strong random value (16+ chars) on both the Railway `server` service and the `sidecar` service.
- Set `SCHWAB_WEB_CALLBACK_URL=https://morai.wtf` on the Railway `sidecar` service.
- Confirm `https://morai.wtf` is registered as a callback URL on both the trader and market Schwab Developer Portal apps — user confirmed 2026-07-13 this registration is already done on both apps.

## Next Phase Readiness

Phase 37 is code-complete and fully gated: every layer's own test suite is green, and the cross-layer integration gate (full TS workspace + sidecar pytest + typecheck + lint) confirms no wiring gaps remain between the sidecar admin endpoints (37-04), the server proxy routes (37-05), and the web wizard (37-06). The one remaining item is the human UAT: the next real Schwab re-auth (~2026-07-20) performed through the wizard, which requires the Railway deploy prerequisites above to be set before that window. After that UAT passes, Phase 37 can be marked complete and this becomes the last CLI-driven re-auth cycle.

## Self-Check: PASSED

- FOUND: `docs/operations/schwab-reauth-runbook.md` (modified, wizard primary path + CLI fallback + deploy prerequisites present)
- FOUND: `docs/TOPIC-MAP.md` (modified, description synced)
- FOUND: `apps/server/src/config.test.ts` (modified, SIDECAR_ADMIN_TOKEN in fixture)
- FOUND: `apps/web/src/components/ReauthWizard.tsx` (modified, dead disable comment removed)
- FOUND commit `320328a`
- FOUND commit `62b8e29`
- Full gate re-verified green after both fixes: `bun run test` 311/311 files (3423/3423 tests), sidecar pytest 84/84, `bun run typecheck` exit 0, `bun run lint` exit 0.

---
*Phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the*
*Completed: 2026-07-13*
