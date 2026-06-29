---
phase: 12-streaming-ts-fan-out
reviewed: 2026-06-29T18:43:33Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - apps/web/src/lib/live-position-greeks.ts
  - apps/web/src/lib/live-position-greeks.test.ts
  - apps/web/src/screens/Overview.tsx
  - apps/web/src/screens/Overview.test.tsx
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
resolved:
  - "CR-01 — net-greek ×netQty² scaling (magnitude + short-leg sign), fixed in 112d1b1 with 4 RED→GREEN lock-in tests"
  - "WR-01 — multi-lot test gap, closed by the CR-01 regression fixtures"
deferred:
  - "WR-02 — lexicographic liveTs assumes uniform fractional-second precision (flash-key/stale only, not numbers)"
  - "IN-01 — test-only as/! (eslint-disabled)"
  - "IN-02 — partial-live calendar rows flash statically-sourced aggregate cells (wording mismatch, no numeric impact)"
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-29T18:43:33Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found (CR-01 + WR-01 resolved 2026-06-29 in `112d1b1`; WR-02 + 2 INFO deferred)

## Summary

Scope is the 12-07 gap-closure diff (base `42802d0`): a pure per-row resolver
(`resolveLivePositionRow`) plus the Overview re-wiring that overlays live SSE ticks onto
the positions table. The live-vs-static fallback for **netVal** and **unreal** is correct
and faithfully mirrors the prior static math; sign conventions on short legs hold; the
React key-trick and the color-dim (non-opacity) stale treatment are implemented correctly
and backed by CSS (`.live-cell.stale` → `var(--color-dim)`, outspecifies the Tailwind text
color). Strict-rules compliance in production code is clean (no `any`/`as`/`!`, Result
narrowed via `.ok`).

The one material defect is in the **greeks scaling**: both the live and the static branches
multiply by an extra `netQty` factor (`× netQty × nq` = `× netQty² × 100`), which is correct
only for single-lot positions and over-states greeks by a factor of `netQty` for any
multi-contract leg. This is faithfully copied from the pre-existing `netGreeksForLegs`, so
the "equivalence" goal is met — but the equivalence is to buggy math, and the new live path
re-introduces the same error independently. The test suite cannot see it because every
fixture uses `netQty = ±1`.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Net greeks over-scaled by a factor of `netQty` (wrong for any multi-contract leg)

**File:** `apps/web/src/lib/live-position-greeks.ts:108-128` (and mirrored in `apps/web/src/screens/Overview.tsx:59-64`)

**Issue:**
`computePositionGreeks` already returns greeks scaled by `netQty` (`position-greeks.ts:122-126`:
`delta = kernelGreeks.delta * netQty`). The resolver's static branch then multiplies that
result again by `nq = netQty * 100`:

```ts
greeks.delta += r.value.greeks.delta * nq;   // = (kernel × netQty) × (netQty × 100)
```

so the position greek becomes `kernel × netQty² × 100`. The correct position greek is
`kernel_per_share × netQty × 100` (shares = contracts × 100). The extra `netQty` is a bug.

The live branch makes the identical mistake (`tick.bsmDelta` is raw per-share, same layer as
the kernel):

```ts
greeks.delta += tick.bsmDelta * netQty * nq;  // = bsmDelta × netQty² × 100
```

For `|netQty| = 1` this collapses to the correct value, which is why it ships. For a 2-lot
calendar leg the displayed Δ/Γ/Θ/Vega are **2×** too large; a 3-lot leg is **3×** too large.
On a trading dashboard these greeks drive hedging/risk decisions, so the numbers are
materially wrong for multi-contract positions. `netVal` and `unreal` are unaffected (they
multiply by `netQty × 100` exactly once and are correct).

This is the prior static behavior (`Overview.tsx` `netGreeksForLegs` and the duplicated test
helper), so the no-tick path does match it exactly — but the equivalence target is itself
defective, and 12-07 propagates it into the live overlay.

**Fix:** Drop the extra `netQty` — `computePositionGreeks` already applied it, and the live
tick needs `netQty × 100` once. Fix all three sites together so live still equals static:

```ts
// live-position-greeks.ts — live branch (tick is raw per-share):
greeks.delta += tick.bsmDelta * nq;   // nq = netQty * 100   (drop the extra * netQty)
greeks.gamma += tick.bsmGamma * nq;
greeks.theta += tick.bsmTheta * nq;
greeks.vega  += tick.bsmVega  * nq;

// live-position-greeks.ts — static branch (r.value already × netQty):
greeks.delta += r.value.greeks.delta * 100;   // contract multiplier only
greeks.gamma += r.value.greeks.gamma * 100;
greeks.theta += r.value.greeks.theta * 100;
greeks.vega  += r.value.greeks.vega  * 100;
```

Apply the same `* 100` correction to `Overview.tsx:60-63` (`netGreeksForLegs`, feeds
`BookSummary`) and to the duplicated `netGreeksForLegs` in the test file (lines 51-54), or
the BookSummary will disagree with the table. Add a multi-lot fixture to lock the fix in
(see WR-01).

## Warnings

### WR-01: Equivalence/example tests only exercise `netQty = ±1`, hiding CR-01

**File:** `apps/web/src/lib/live-position-greeks.test.ts:79-103, 135-153`

**Issue:** Every fixture (`makeLongLeg` longQty 1, `makeShortLeg` shortQty 1) and the
fast-check equivalence property all use `|netQty| = 1`, where `netQty² == netQty`, so the
over-scaling in CR-01 is invisible. Worse, the equivalence property compares the resolver
against a **copy of the same buggy `netGreeksForLegs`** (lines 34-57) rather than against an
independent ground-truth greek, so it asserts "matches the static helper" not "is correct" —
two wrongs pass green. The repo already proves multi-lot matters: `position-greeks.test.ts`
deliberately tests `longQty: 3` and `longQty: 2, shortQty: 2`.

**Fix:** Add an example test with a multi-contract leg (e.g. `longQty: 2`) asserting the
live greek equals `tick.bsmDelta * netQty * 100` (NOT `× netQty²`), and assert the static
branch equals `kernel × netQty × 100`. This test should fail today and pass after CR-01.

### WR-02: `liveTs` selection uses lexicographic string compare on a variable-precision timestamp

**File:** `apps/web/src/lib/live-position-greeks.ts:132-136`

**Issue:** "Latest tick" is chosen by `tick.ts > liveTs` on raw strings. The contract types
`ts` as `z.string().datetime()` (`stream-events.ts:47`), which accepts arbitrary
fractional-second precision. Lexicographic order only matches chronological order when every
string has identical precision. Mixed precision misorders: `"2026-06-29T14:31:00Z"` compares
**greater than** `"2026-06-29T14:31:00.5Z"` (char 19: `'Z'` 0x5A > `'.'` 0x2E), even though
the `.5Z` tick is later. Impact is limited to the flash-retrigger key and the stale-dim
("freshest tick") semantics — not the displayed numbers — but a stale tick can win and a
real tick's flash can be dropped. Today the sidecar coalesces to ~1/sec and normalizes to
`Z`, so it likely emits uniform precision; the resolver nonetheless silently depends on that.

**Fix:** Compare parsed instants instead of strings, e.g. keep the max of
`Date.parse(tick.ts)` and only then store the corresponding `ts` string, or assert/normalize
a fixed precision at the parse boundary. A short comment documenting the uniform-precision
assumption would be the minimum.

## Info

### IN-01: Test file uses `as unknown as` and a non-null assertion `!`, contradicting the strict no-`as`/no-`!` rule

**File:** `apps/web/src/screens/Overview.test.tsx:46-47`; `apps/web/src/lib/live-position-greeks.test.ts:284-285`

**Issue:** Project rule (`.claude/rules/typescript.md`, global CLAUDE.md #3) bans `as` and
`!` with "no exceptions". `Overview.test.tsx` casts via `... as unknown as ReturnType<typeof
usePositions>` and the resolver test uses `result!.liveTs`, both silenced with
`eslint-disable`. These are test-only and low-risk, but the `result!` pattern stems from
assigning inside an `expect(() => { ... }).not.toThrow()` callback where TS can't prove
assignment.

**Fix:** For the mock, build a typed partial helper instead of a double-cast. For `result!`,
initialize `let result: ... | undefined` and assert `expect(result).toBeDefined()` before
dereferencing, or compute the value outside the `toThrow` closure.

### IN-02: Partial-live calendar row flashes/dims statically-sourced aggregate cells

**File:** `apps/web/src/screens/Overview.tsx:217-220, 244-283`

**Issue:** The doc comment (lines 144-146) promises "no tick for a symbol → static polled
value, no live-cell class." But classes are applied at the row-aggregate level: a calendar
row where only the front leg has a tick still has `liveTs !== null`, so the whole row
(including the back leg's static contribution folded into each aggregate cell) gets
`live-cell`/`live-cell-flash`/stale. This is inherent to aggregating two legs into one cell
and is not wrong numerically — just a slight mismatch between the per-symbol-fallback wording
and the per-row visual behavior.

**Fix:** None required for correctness. If precise per-cell semantics are wanted, the
comment should be softened to "row flashes when any leg in the row ticks," or the resolver
could expose a per-row "fully live vs partially live" flag for styling.

---

_Reviewed: 2026-06-29T18:43:33Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
