---
phase: 22-journal-calendar-lifecycle-graph
plan: 01
subsystem: journal-domain-contracts
tags: [forward-vol, zod-contract, tdd, hexagonal-core]
status: complete
dependency-graph:
  requires: []
  provides:
    - "computeForwardVol + ForwardVolResult (@morai/core, journal barrel)"
    - "lifecycleSnapshotResponse + lifecycleResponse + LifecycleResponse (@morai/contracts)"
  affects:
    - packages/core/src/journal/index.ts
tech-stack:
  added: []
  patterns:
    - "Duplicate-not-import across bounded contexts (architecture-boundaries.md rule 7): fwd-vol.ts is a near-verbatim, deliberately duplicated copy of picker/domain/fwd-iv.ts"
    - "Tagged never-NaN guard union ({ value; guard: 'ok' } | { value: null; guard: 'inverted' })"
    - "Additive Zod .extend() over an existing MCP-02 shared schema, never mutating the original"
key-files:
  created:
    - packages/core/src/journal/domain/fwd-vol.ts
    - packages/core/src/journal/domain/fwd-vol.test.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/contracts/src/journal.ts
decisions:
  - "computeForwardVol duplicates computeFwdIv's exact formula/guard shape rather than importing packages/core/src/picker/domain/fwd-iv.ts, per architecture-boundaries.md rule 7 (no cross-bounded-context domain/ imports) and 22-RESEARCH.md's explicit Alternatives Considered call."
  - "lifecycleSnapshotResponse extends snapshotResponse via .extend() (additive-only); trigger field is optional so existing SnapshotRow-based callers are unaffected."
metrics:
  duration: "~25 min"
  completed: "2026-07-05"
---

# Phase 22 Plan 01: Forward-Vol Domain Fn + Lifecycle Contract Summary

One-liner: `computeForwardVol` — a tagged, never-NaN forward-vol domain function duplicated from
the proven `computeFwdIv` — plus the additive `lifecycleSnapshotResponse`/`lifecycleResponse` Zod
contract, both re-exported for Wave-2/3 plans to consume.

## What Was Built

**Task 1 — `computeForwardVol` (RED→GREEN, TDD):**
- `packages/core/src/journal/domain/fwd-vol.ts` — pure domain function implementing D-07's
  forward-vol identity: `σ_fwd = sqrt((σ_back²·tB − σ_front²·tF)/(tB−tF))`. Takes journal's raw
  string-typed `SnapshotRow` fields (`frontIv`/`backIv`, possibly the literal `"NaN"`), parses
  them, and guards on `!Number.isFinite(ivf) || !Number.isFinite(ivb) || tb === tf` (non-finite
  input or division-by-zero) as well as `rad < 0` (inverted term structure) — both collapse to
  `{ forwardVol: null, guard: "inverted" }`. Radicand exactly `0` returns `{ forwardVol: 0, guard:
  "ok" }`, never "inverted".
- `packages/core/src/journal/domain/fwd-vol.test.ts` — mirrors `fwd-iv.test.ts`'s idiom exactly:
  4 example tests (normal, inverted, degenerate-zero, non-finite-input) + 1 division-by-zero
  example + 1 fast-check property (`fc.assert(fc.property(...), { numRuns: 1000 })`) asserting
  `Number.isNaN(result.forwardVol) === false` across arbitrary DTE/IV pairs, using
  `fc.float({ min: Math.fround(...), max: Math.fround(...), noNaN: true })` per the v4 32-bit
  bound requirement.
- RED confirmed first: ran the test against the not-yet-created module, got
  `Cannot find module './fwd-vol.ts'` (import error, not an assertion failure) — the right
  failure reason — before writing the implementation.
- `computeForwardVol` and `ForwardVolResult` re-exported from `packages/core/src/journal/index.ts`.

**Task 2 — Additive lifecycle Zod contract:**
- `packages/contracts/src/journal.ts` gained `lifecycleSnapshotResponse` (= `snapshotResponse
  .extend({...})` adding `isGap`, `forwardVol`, `forwardVolGuard`, `cumTheta`, `cumVega`,
  `cumDeltaGamma`, `cumResidual`, and optional `trigger`), `lifecycleResponse` (`{ snapshots:
  z.array(lifecycleSnapshotResponse) }`), and the inferred `LifecycleResponse` type (plus
  `LifecycleSnapshotResponse` for the per-row type, an incidental but harmless additional export).
  `snapshotResponse`/`journalResponse` are byte-for-byte unchanged — confirmed via `git diff`
  (32 pure insertions, zero deletions/modifications to existing lines).

## Deviations from Plan

None — plan executed exactly as written. One incidental addition: exported
`LifecycleSnapshotResponse` (the per-row inferred type) alongside the plan-specified
`LifecycleResponse`, since Zod's `z.infer` idiom makes it free and it's immediately useful to
Plan 22-03/22-04's route and hook typing — purely additive, not a deviation from any locked
behavior.

## Verification

- `bunx vitest run packages/core/src/journal/domain/fwd-vol.test.ts` — 6/6 tests passed.
- `bun run typecheck` (workspace-root `tsc --build --force`) — clean, zero errors.
- `bun run lint` (workspace-root `eslint .`) — clean (only pre-existing tsconfig/boundaries
  informational warnings unrelated to this plan's files).
- `git diff packages/contracts/src/journal.ts` — confirmed additive-only (32 insertions, 0
  deletions).

## Self-Check

- `packages/core/src/journal/domain/fwd-vol.ts` — FOUND
- `packages/core/src/journal/domain/fwd-vol.test.ts` — FOUND
- `packages/contracts/src/journal.ts` (extended) — FOUND
- Commit `2b25f0d` (test RED) — FOUND in `git log`
- Commit `a149efc` (feat GREEN, computeForwardVol) — FOUND in `git log`
- Commit `9a8799a` (feat, lifecycle contract) — FOUND in `git log`

## TDD Gate Compliance

Task 1 (`type="tdd"`) followed RED→GREEN: `test(22-01): add failing test for computeForwardVol`
(2b25f0d) precedes `feat(22-01): implement computeForwardVol domain fn (JRNL-01)` (a149efc) in
git log. Gate sequence satisfied.

## Self-Check: PASSED
