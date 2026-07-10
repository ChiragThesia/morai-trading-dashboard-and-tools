---
phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
fixed_at: 2026-07-10T15:42:26Z
review_path: .planning/phases/30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-/30-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 30: Code Review Fix Report

**Fixed at:** 2026-07-10T15:42:26Z
**Source review:** .planning/phases/30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-/30-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (CR-01, WR-01, WR-02 — fix_scope: critical_and_warning; IN-01 out of scope)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: `computePayoffDomain` collapsed to a zero-width `{min: spot, max: spot}` domain when every position is excluded from T+0

**Files modified:** `apps/web/src/lib/payoff-domain.ts`, `apps/web/src/lib/payoff-domain.test.ts`
**Commit:** `70de093`
**Applied fix:** Added an early return in `computePayoffDomain` for `contributing.length === 0` (every position user-excluded or non-convergent on both legs, per `includedForT0`) that falls back to the same `spot ± FALLBACK_HALF_WIDTH` domain as the truly-empty-book case, instead of collapsing `baseAnchors` to `[spot]` alone. This removed the dead `strikes.length > 0 ? ... : [spot]` ternary immediately below, since `strikes` is now guaranteed non-empty past the guard.

RED→GREEN: added two regression tests — all-`included:false` positions, and all-`non-convergent` positions — asserting `domain` equals the `spot ± 500` fallback (finite, non-degenerate) rather than `{min: spot, max: spot}`. Both failed for the right reason (`{min: 7300, max: 7300}` vs expected `{min: 6800, max: 7800}`) before the fix, passed after.

## CR-01: `analyzeAdHocCalendarRequest` accepted unvalidated/inconsistent date strings, letting user input reach an `assertDefined()` throw and silently desync scored greeks from the exit plan

## WR-02: `assertDefined` used as external-input validation instead of an invariant guard (same root cause as CR-01, fixed by the same commit)

**Files modified:** `packages/contracts/src/picker.ts`, `packages/contracts/src/picker.test.ts`, `packages/core/src/picker/domain/candidate-selection.ts`, `packages/core/src/picker/application/analyzeAdHocCalendar.ts`, `packages/core/src/picker/application/analyzeAdHocCalendar.test.ts`, `apps/server/src/adapters/http/picker.routes.test.ts`
**Commit:** `5100e5c`
**Applied fix:**
1. **Contract-level format validation** (fixes the throw): `analyzeAdHocCalendarRequest.frontExpiry`/`backExpiry` now use `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` instead of a bare `z.string()`. A malformed date string now 400s at the Zod boundary (both the HTTP `zValidator` and the MCP tool's `safeParse`, which share this one schema — MCP-02) and never reaches `isoDayNumber`'s `assertDefined` deep in the engine. This restores `assertDefined` there to a true invariant (WR-02's fix, same root cause per the reviewer's own note) — it can now only ever be called with already-format-validated strings.
2. **Cross-field consistency check** (fixes the silent desync): exported `daysBetween` from `candidate-selection.ts` (was already defined, just unexported) and added a guard in `makeAnalyzeAdHocCalendarUseCase`, right after `asOfIso`/`fe`/`be` are resolved and before any `bsmGreeks` call: if `daysBetween(asOfIso, fe) !== input.frontDte` or `daysBetween(asOfIso, be) !== input.backDte`, the use-case returns `ok({scored: false, reason: "dte-expiry-mismatch"})` — never a throw, matching the existing binding #2 flat-degradation pattern (same shape as `no-snapshot`). This makes it structurally impossible for a caller to submit a `frontDte`/`frontExpiry` pair that price one date's greeks against a different date's exit plan.

RED→GREEN:
- `picker.test.ts`: added a regression test asserting malformed `frontExpiry`/`backExpiry` (`"not-a-date"`, `""`, `"07-17-2026"`) throws at `.parse()`. Failed before the regex, passed after.
- `analyzeAdHocCalendar.test.ts`: added two regression tests — a `frontDte`/`frontExpiry` pair and a `backDte`/`backExpiry` pair that disagree with the snapshot's `asOf` — asserting `ok({scored: false, reason: "dte-expiry-mismatch"})`. Both failed for the right reason (use-case returned `scored: true` with mismatched pricing) before the fix, passed after.
- `picker.routes.test.ts`: added a route-level regression test — malformed `frontExpiry` returns 400 and the use-case is never called (`called` spy stays `false`).
- Updated the existing byte-parity fast-check property test (T-30-10) in `analyzeAdHocCalendar.test.ts` to derive `frontExpiry`/`backExpiry` from the arbitrary `frontDte`/`backDte` offsets against `SNAPSHOT_ASOF` (via a small local `addDaysIso` helper, mirroring `isoDayNumber`'s pure `Date.UTC` day-arithmetic style) instead of using fixed date strings unrelated to the randomized dte values. The old fixed-string version encoded exactly the vulnerable assumption the finding flagged (a dte independent of its expiry); the property's actual intent — byte-parity of the pricing formula across the dte/strike/iv range — is unchanged and still holds with 200 runs.
- IN-01 (out of scope, `fix_scope: critical_and_warning`) is a side-benefit but not fully addressed: `frontDte`/`backDte` are still the values threaded into `RawCandidate`/`bsmGreeks` (unchanged, preserves T-30-10 byte-parity with `scoreCalendarCandidates`); they are now validated equal to the derived value rather than independently trusted, but not dropped in favor of full server-side derivation. The doc-comment IN-01 asks for on `AdHocCalendarInput` was not added (out of scope).

## Skipped Issues

None — all in-scope findings were fixed.

## Verification

- `bun run typecheck` — clean (no errors).
- `bun run lint` — clean (only pre-existing `[boundaries]` legacy-selector-syntax warning, unrelated).
- `bun run test` (full suite, not bare vitest) — **280 test files, 3017 tests, all green**.
- No-override/no-paste byte-identical requirement held: `computePickerSnapshot` and Phase 27 replay suites were not touched and were not part of the failing/changed set.

---

_Fixed: 2026-07-10T15:42:26Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
