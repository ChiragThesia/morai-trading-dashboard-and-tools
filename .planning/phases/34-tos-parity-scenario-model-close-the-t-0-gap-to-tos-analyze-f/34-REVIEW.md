---
phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f
reviewed: 2026-07-11T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - packages/shared/src/settlement-timestamp.ts
  - packages/shared/src/settlement-timestamp.test.ts
  - packages/shared/src/index.ts
  - packages/core/src/analytics/domain/implied-carry.ts
  - packages/core/src/analytics/domain/implied-carry.test.ts
  - packages/core/src/analytics/application/ports.ts
  - packages/core/src/analytics/application/computeGexSnapshot.ts
  - packages/core/src/analytics/application/computeGexSnapshot.test.ts
  - packages/core/src/analytics/application/getGex.test.ts
  - packages/core/src/analytics/domain/gex.test.ts
  - packages/core/src/analytics/index.ts
  - packages/core/src/index.ts
  - packages/adapters/src/postgres/gex-snapshot.repo.ts
  - packages/adapters/src/__contract__/gex-snapshot.contract.ts
  - packages/adapters/src/postgres/gex-snapshot.repo.contract.test.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/adapters/src/postgres/migrations/0023_gex_implied_carry.sql
  - packages/adapters/src/postgres/migrations/meta/0023_snapshot.json
  - packages/adapters/src/postgres/migrations/meta/_journal.json
  - packages/contracts/src/gex.ts
  - packages/contracts/src/gex.test.ts
  - apps/server/src/adapters/http/gex.routes.ts
  - apps/server/src/adapters/http/gex.routes.test.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/adapters/mcp/tools.test.ts
  - apps/worker/src/main.ts
  - apps/web/src/lib/pair-calendars.ts
  - apps/web/src/lib/pair-calendars.test.ts
  - apps/web/src/lib/scenario-engine.ts
  - apps/web/src/lib/scenario-engine.test.ts
  - apps/web/src/lib/resolve-carry.ts
  - apps/web/src/lib/resolve-carry.test.ts
  - apps/web/src/screens/Overview.tsx
  - apps/web/src/screens/Overview.test.tsx
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: fixed
---

# Phase 34: Code Review Report

**Reviewed:** 2026-07-11T00:00:00Z
**Depth:** standard (cross-file tracing on the money paths)
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Re-derived the put-call parity solve independently and it matches what shipped:
`rhs = (C−P) + K·e^{−rT}`, `q = −ln(rhs/S)/T`. The 34-03 SUMMARY's self-reported correction of
RESEARCH's sign-error formula is genuine and verified — the shipped formula is the correct one,
confirmed against a hand-derived oracle and independently against `bsmPrice`. The FRED
short-rate interpolation divides by 100 exactly once, clamps correctly to the documented
[30d, 90d] bracket, and the day-count (365.25) is consistent between `computeGexSnapshot.ts`'s
server-side T and `scenario-engine.ts`'s client-side T. `settlementTimestamp`'s third-Friday
detection correctly checks day-of-week AND day-of-month range, and its DST-offset technique is
sound for Friday-only inputs (the only case that matters here, since US DST transitions always
land on a Sunday). `dteExact` in `pair-calendars.ts` correctly reuses `parseOccSymbol`'s
already-parsed, LOCAL-constructed `.expiry` field, so the web-side settlement math is
TZ-invariant by construction. `bsmPrice` self-guards `T<=0` (returns intrinsic value), so the
frontT-floors-at-0 / backT-floors-at-1e-6 asymmetry in `scenario-engine.ts` (pre-existing,
unchanged by this phase) stays safe even though `dteExact` now makes T=0 more frequently
reachable. Migration 0023 is a clean single additive nullable jsonb column, matching the
`nearTerm` precedent exactly, with full round-trip + legacy-null coverage on both the Postgres
and in-memory adapters. Web-vs-server expiry-key matching (the seam flagged as highest-risk) is
actually sound: both sides derive the `YYYY-MM-DD` key via a local-construct-then-local-read
round trip (`parseOccSymbol` + `toDateInputValue` on the web; `getFullYear/getMonth/getDate` at
ingest in `fetchChain.ts`), which is TZ-invariant regardless of what timezone either process
runs in.

One BLOCKER survived: `computeGexSnapshot.ts`'s new Step 8c does NOT use that same safe pattern
internally. It re-derives an expiry `Date` from the DB's `expiration` string via a UTC-anchored
constructor, then feeds it into `settlementTimestamp`, which reads it back with LOCAL getters —
breaking the local-construct/local-read symmetry every other call site in this phase relies on.
This is TZ-dependent (correct only when the server process's TZ happens to be UTC, which is
nowhere pinned, documented, or tested in this repo) and it is the same bug class the project's
own `date-projection.ts` comment says has already bitten this codebase twice. The bug is
invisible to the test suite because the test's own "independent oracle" reproduces the identical
buggy construction, so oracle and SUT drift together. Two WARNING-level findings round this out:
a missing sanity guard on ATM-bracket marks before they feed the parity solve, and the resulting
non-independence of the `computeGexSnapshot.test.ts` impliedCarry oracle.

## Critical Issues

### CR-01: Server-side settlement/T computation is TZ-dependent — UTC-constructed Date read via LOCAL getters, unguarded by any test

**Status:** fixed — commit `091b419`

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:164-171`

**Issue:** Inside `computeImpliedCarry`:

```ts
const rootParsed = parseOccSymbol(firstLeg.contract);
if (!rootParsed.ok) continue;

const expiryDate = new Date(`${expiration}T00:00:00.000Z`);   // UTC-anchored construction
if (Number.isNaN(expiryDate.getTime())) continue;

const settlement = settlementTimestamp(rootParsed.value.root, expiryDate);
```

`settlementTimestamp` (`packages/shared/src/settlement-timestamp.ts:56-58`) reads its `expiry`
argument with **local** getters (`getFullYear()`, `getMonth()`, `getDate()`). Its one other
production caller, `pair-calendars.ts:77`, satisfies that contract correctly by passing
`parsed.value.expiry` — a `Date` that `parseOccSymbol` constructed via the LOCAL-timezone
`new Date(year, month0, day)` constructor. Local-construct + local-read is a closed, TZ-invariant
round trip (it always returns the same Y/M/D regardless of what timezone the process is in).

`computeGexSnapshot.ts` breaks that symmetry: `expiryDate` is built via `Date.UTC`-equivalent
semantics (the explicit `Z` suffix), then read back with LOCAL getters. If the server process's
timezone is anything other than UTC (negative offset — e.g. `America/New_York`), the local
getters see the *previous* calendar day for any hour before the offset's magnitude past
midnight — always true for a `T00:00:00.000Z` instant — silently shifting the resolved
settlement instant, and therefore `T`, back by a full day. For a ~98-day expiry that's roughly a
1% relative error in `T`, propagated into both the FRED-rate interpolation input and the
`impliedDivYield` parity solve — corrupting exactly the numbers this phase exists to make
TOS-accurate. Nothing in this repository pins the server process's `TZ` (no Dockerfile, no
nixpacks.toml, no `railway.json/toml`, no `process.env.TZ` reference anywhere) — the correctness
of this code today rests entirely on an unverified, unenforced container default.

This is also not a new problem pattern for this codebase: `apps/web/src/lib/date-projection.ts`
documents it by name — *"RESEARCH Pitfall 1 (the CBOE-UTC bug class this project has hit twice,
inverted direction): `new Date(string)` parses a bare YYYY-MM-DD string as UTC midnight, which
drifts a day in negative-UTC-offset timezones."* This is now effectively a third instance of the
same class, freshly introduced in this phase.

The test that exercises this path does not catch it:
`computeGexSnapshot.test.ts:383-385` builds its "independent oracle" the exact same way —
`new Date(\`${CARRY_EXPIRY}T00:00:00.000Z\`)` fed into `settlementTimestamp` — so the test and
the SUT compute the identical (and, under a non-UTC TZ, identically wrong) value together. It
would pass in any environment TZ, proving nothing about the correctness of this specific
construction.

**Fix:** Use the `Date` `parseOccSymbol` already returned instead of re-deriving one from the
string — it's already parsed, already validated, and already the correct LOCAL-constructed
input `settlementTimestamp` expects:

```ts
const rootParsed = parseOccSymbol(firstLeg.contract);
if (!rootParsed.ok) continue; // degrade: unparseable contract, skip this expiry

const settlement = settlementTimestamp(rootParsed.value.root, rootParsed.value.expiry);
```

This removes the redundant `expiryDate`/`Number.isNaN` guard entirely (an OCC symbol that
parses successfully always has a valid `.expiry`) and makes the computation TZ-invariant by
construction, matching `pair-calendars.ts`'s proven-correct usage. The test's "independent
oracle" should be updated the same way so it no longer mirrors the SUT's date-construction
step verbatim (see WR-02).

## Warnings

### WR-01: `pickAtmBracketPair` accepts any finite mark, including zero or near-zero, without a sanity floor

**Status:** fixed — commit `394a999`

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:111-137`

**Issue:** The ATM-bracket strike is chosen purely by "nearest to spot with both a call and a
put mark present," where "present" means `Number.isFinite(mark)` (line 118). A `mark` of
exactly `"0"` (a plausible stale/no-liquidity DB value, not a parse failure) passes this check
and is fed straight into `impliedDivYield`. `impliedDivYield`'s own guard (`rhs <= 0` → null)
catches the common case where a bad mark drives the parity right-hand side negative, but it
does not catch every combination — e.g. a stale-zero call mark paired with a small-but-nonzero
put mark can still produce a positive `rhs` and a silently-wrong `divYield` for that expiry,
with no signal that the input was garbage. Because `computeImpliedCarry` (line 177-181) only
ever tries the single nearest-to-spot strike and `continue`s to the next expiry on failure
(a documented, ponytail-flagged simplification — not itself a finding), a corrupted mark at
that one strike is the only chance that expiry gets.

**Fix:** Require both marks to be strictly positive (and arguably above some minimal epsilon,
e.g. `> 0.01`) before accepting a strike as the ATM pair:

```ts
if (!Number.isFinite(mark) || mark <= 0) continue;
```

### WR-02: `computeGexSnapshot.test.ts`'s impliedCarry oracle mirrors the SUT's date construction instead of independently verifying it

**Status:** fixed — commit `091b419` (landed together with CR-01; the oracle fix and the SUT
fix are inseparable at green — see that commit)

**File:** `packages/core/src/analytics/application/computeGexSnapshot.test.ts:383-385`

**Issue:** The block's own comment claims this is an "independent oracle: T computed directly
via settlementTimestamp (not via the SUT's own carry step)." That's true only for the
*settlementTimestamp call itself* — but the `Date` fed into it (`EXPIRY_DATE = new
Date(\`${CARRY_EXPIRY}T00:00:00.000Z\`)`) is constructed via the exact same UTC-anchored pattern
the SUT uses internally (CR-01). Money-path rule requires oracles built independently of the
implementation; here, the test's oracle and the SUT's logic share the one line of code most
at risk of a TZ bug, so the test cannot distinguish "correct" from "wrong in the same way twice."

**Fix:** Once CR-01 is fixed (SUT uses `parseOccSymbol(...).value.expiry` instead of a
re-derived UTC Date), update this oracle to do the same — pass a LOCAL-constructed expiry Date
(e.g. via `parseOccSymbol` on the fixture's own `contract` field, or `new Date(year, month-1,
day)`) into `settlementTimestamp`, so the oracle no longer depends on the UTC/local round-trip
being correct by coincidence.

---

_Reviewed: 2026-07-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
