---
phase: 08-web-dashboard-backend-gex-auth-rpc
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - apps/server/src/adapters/http/gex.routes.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/config.ts
  - apps/server/src/main.ts
  - apps/worker/src/handlers/compute-gex-snapshot.ts
  - apps/worker/src/handlers/compute-analytics.ts
  - apps/worker/src/schedule.ts
  - apps/worker/src/main.ts
  - packages/adapters/src/postgres/gex-snapshot.repo.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/adapters/src/memory/gex-snapshot.ts
  - packages/contracts/src/gex.ts
  - packages/core/src/analytics/domain/gex.ts
  - packages/core/src/analytics/application/computeGexSnapshot.ts
  - packages/core/src/analytics/application/getGex.ts
  - packages/core/src/analytics/application/ports.ts
  - packages/adapters/src/__contract__/gex-snapshot.contract.ts
findings:
  critical: 1
  warning: 7
  info: 4
  total: 12
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-24
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Re-review of the GEX-snapshot backend slice after the two prior criticals were fixed. Both are
confirmed resolved against current code (see "Resolved Criticals"). One NEW critical surfaced that
the prior advisories circled but never named as a hard failure: the contract enforces integer
`k`/`callWall`/`putWall`, but the producer feeds them `strike / 1000` (fractional for any
half/quarter-point SPX strike) and the DB wall columns are `integer`. That pairing is a runtime
fault (write-side truncation or read-side Zod throw → 500), not a quality smell, so it is escalated
to BLOCKER and the prior WR-04/WR-05 are reframed around it.

The remaining findings are the prior advisories, re-verified and re-numbered against current line
numbers, plus one boundary-rule violation (the in-memory GEX twin is implemented but never exported,
so architecture-boundaries §8 "ship the twin" is only half-met at the package surface).

### Resolved Criticals (do not reopen)

- **CR-01 (netGammaAtSpot, prior phase):** RESOLVED. `computeGexSnapshot.ts:141-142` derives the
  scalar from `buildProfile(legs, [spot])` (profile-at-spot semantics) rather than the per-strike
  concentrated GEX of the nearest strike. Matches the oracle (-47.43 @ s=7380).
- **CR-02 (computedAt persistence, prior phase):** RESOLVED. A dedicated `computed_at` column exists
  (migration `0009_gex_computed_at.sql`; `schema.ts:371`), the use-case stamps it with `deps.now()`
  (`computeGexSnapshot.ts:181`), the repo round-trips it distinctly from `cycleTime`
  (`gex-snapshot.repo.ts:120,160`), and a regression test pins it
  (`__contract__/gex-snapshot.contract.ts:201-229`).

## Structural Findings (fallow)

No structural-findings block was provided for this re-review.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Integer contract on `k`/`callWall`/`putWall` vs `strike/1000` producer + `integer` wall columns

**File:** `packages/contracts/src/gex.ts:12,38,39`; `packages/core/src/analytics/domain/gex.ts:94`;
`packages/core/src/analytics/application/computeGexSnapshot.ts:124,129,158`;
`packages/adapters/src/postgres/schema.ts:361,362`

**Issue:** The contract pins `gexWallEntry.k`, `callWall`, and `putWall` to `z.number().int()`. The
producer computes every strike as `leg.strike / 1000` (`domain/gex.ts:94`,
`computeGexSnapshot.ts:158`), and `callWall`/`putWall` are assigned directly from `entry.k`
(`computeGexSnapshot.ts:124,129`). The `×1000` convention only guarantees integrality after `/1000`
for whole-point strikes. Any half- or quarter-point listed strike (e.g. 7412.5 → stored `7412500`
→ `/1000 = 7412.5`) produces a fractional value. One fractional input yields two failure paths:
  1. **Write side:** `callWall`/`putWall` map to `integer("call_wall")`/`integer("put_wall")`
     columns (`schema.ts:361-362`). Persisting `7412.5` into an `integer` column errors or silently
     truncates — the wall is lost or wrong.
  2. **Read side:** even with null walls, a fractional `k` in any `strikes[]` entry makes
     `gexSnapshotResponse.parse(...)` throw at the read seam in BOTH `gex.routes.ts:44` and
     `tools.ts:522`, returning `{error:"internal"}`/`500` for an otherwise-valid snapshot.
There is no integrality guard anywhere between the `×1000` source and these integer sinks.

**Fix:** Decide the grain explicitly and enforce it once. Either (a) relax the contract to
`z.number()` for `k`/`callWall`/`putWall` and change the wall columns to `numeric`, or (b) keep
integers and round/validate at the domain boundary:
```ts
// domain/gex.ts — make the ×1000→points conversion total and integral
const kRaw = leg.strike / 1000;
const k = Number.isInteger(kRaw) ? kRaw : Math.round(kRaw); // or skip + log non-integral strikes
```
Add a property test over fractional strikes so the seam can never 500 on real chain data again.

## Warnings

### WR-01: `findFlip` interpolates over a spot grid but its parameter is named/typed `strike`

**File:** `packages/core/src/analytics/domain/gex.ts:135-163`, fed by `buildProfile` at `184-235`

**Issue:** `buildProfile` returns `{ strike: S, gamma }` where `S` is a grid SPOT (`gex.ts:231`),
not an option strike. `findFlip` consumes `{ strike, gamma }` and returns
`a.strike + t*(b.strike - a.strike)` — an interpolated spot level. The math is correct (the flip is
a spot level), but the field name `strike` mislabels the dimension, inviting a future bug when
someone treats the flip as a strike.

**Fix:** Rename the profile/flip axis field to `spot` (or `level`) end-to-end: `buildProfile`
returns `{ spot, gamma }`, `findFlip` takes `{ spot, gamma }`. Align or document the contract's
`profile` field accordingly.

### WR-02: `dollarGamma` formula duplicated in the use-case as `dollarGammaContrib`

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:193-196` vs
`packages/core/src/analytics/domain/gex.ts:42-44`

**Issue:** `dollarGammaContrib` is a byte-for-byte copy of domain `dollarGamma`
(`(gamma * oi * 100 * spot * spot * 0.01) / 1e9`). The byExpiry rollup uses the copy while the
strike/profile paths use the domain function. Two copies of a numeric formula drift the moment one
is tuned, silently desyncing byExpiry from the rest of the snapshot.

**Fix:** Delete `dollarGammaContrib` and call the exported domain `dollarGamma` in the byExpiry
loop — it is already importable from `../domain/gex.ts`.

### WR-03: Spot taken from non-deterministic `legs[0]` despite the "average" comment

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:101-106`

**Issue:** The comment says "Extract spot (average underlyingPrice across the cohort)" but the code
takes `legs[0].underlyingPrice`. Leg order comes from the repo JOIN, which has no `ORDER BY`
(`gex-snapshot.repo.ts:58-78`), so "first leg" is whatever Postgres returns — non-deterministic. If
the cohort spans more than one underlying quote (clock skew, partial re-fetch), the chosen spot is
arbitrary and propagates into the entire profile/grid/netGammaAtSpot computation.

**Fix:** Either compute the actual average to match the comment, or assert single-valued
underlyingPrice and document the invariant. Do not depend on unordered `legs[0]`.

### WR-04: No integrality guard on `callWall`/`putWall` before the `integer` column write

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:117-131,175-176`;
`packages/adapters/src/postgres/gex-snapshot.repo.ts:113-114`

**Issue:** Narrower companion to CR-01, kept actionable on its own. `callWall`/`putWall` are written
through `gex-snapshot.repo.ts` with no rounding or validation (`callWall: row.callWall`), straight
into `integer` columns. Even after CR-01's contract decision, the repo write path should not assume
integrality silently.

**Fix:** Enforce the chosen grain at the repo boundary too (round or reject), so a fractional wall
can never reach an integer column undetected.

### WR-05: `putWall` argmin is not gated on negative GEX, contradicting the contract doc

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:119-131`;
contract doc `packages/contracts/src/gex.ts:40`

**Issue:** `callWall` is gated on positive GEX (`entry.gex > 0 && entry.gex > callWallGex`), but
`putWall` is a pure argmin (`entry.gex < putWallGex`, seeded at `+Infinity`). The contract documents
`putWall` as "Strike with highest net NEGATIVE GEX". On a fully long-gamma chain (every strike
positive), the argmin still returns the least-positive strike and labels it the put wall — a
non-negative "negative-GEX" wall, contradicting the field's stated meaning.

**Fix:** Mirror the callWall gate:
```ts
if (entry.gex < 0 && entry.gex < putWallGex) { putWallGex = entry.gex; putWall = entry.k; }
```
leaving `putWall` null when no strike has negative GEX.

### WR-06: JSONB blobs `$type`-cast on read instead of Zod-parsed (parse-don't-cast)

**File:** `packages/adapters/src/postgres/gex-snapshot.repo.ts:157-159`;
`packages/adapters/src/postgres/schema.ts:366-368`

**Issue:** `profile`, `strikes`, and `byExpiry` come back from Postgres as untyped JSONB but are
trusted as their `$type<>`-annotated shapes and assigned straight onto `GexSnapshotRow`
(`repo.ts:157-159`). `$type<>` is a compile-time annotation only — zero runtime validation — so a
malformed/legacy/hand-edited JSONB row flows into the domain unchecked. The typescript rule mandates
"parse, don't cast" for every external input, and a DB read crossing the adapter seam is external
input. (The HTTP/MCP routes parse on the way out, but the domain boundary itself is unguarded.)

**Fix:** Validate the JSONB blobs with a Zod schema in the repo read path before constructing
`GexSnapshotRow` (reuse the contract sub-schemas or a domain-local schema). Keep `$type<>` for
ergonomics; the runtime parse is what satisfies the rule.

### WR-07: In-memory GEX twin exists but is never exported — boundary §8 only half-met

**File:** `packages/adapters/src/index.ts:64-66` (only `makePostgresGexSnapshotRepo` exported); twin
lives at `packages/adapters/src/memory/gex-snapshot.ts`

**Issue:** architecture-boundaries §8 requires shipping the in-memory twin for every driven port.
`makeMemoryGexSnapshotRepo` is implemented (`memory/gex-snapshot.ts`) but absent from the package
public surface, while every other memory twin (calendars, fills, term-structure, skew,
risk-reversal, job-queue) IS exported. Consumers outside the package cannot wire the twin for
in-process/dev use, and the §8 "same PR" intent is satisfied only internally. The comment at
`index.ts:64` ("memory twin deferred to 08-07 via getGex") acknowledges the gap rather than closing
it.

**Fix:**
```ts
export { makeMemoryGexSnapshotRepo } from "./memory/gex-snapshot.ts";
export type { MemoryGexSnapshotRepo } from "./memory/gex-snapshot.ts";
```

## Info

### IN-01: `void k` dead computation in the byExpiry loop

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:158,163`

**Issue:** `const k = leg.strike / 1000;` is computed then discarded via `void k;` with the comment
"k is used in strikeGex not here". Pure dead code in this loop.

**Fix:** Remove both the `const k` line and the `void k;` line.

### IN-02: Asymmetric / off-center spot grid relative to spot

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:54-62`

**Issue:** `buildSpotGrid` rounds `start`/`end` independently and steps by `GRID_STEP=20` from
`start`, so when `spot` is not aligned to the 20-pt step the grid is not symmetric about `spot` and
`spot` itself may not be a grid node. `netGammaAtSpot` is computed separately via
`buildProfile(legs, [spot])` so it is unaffected, but the charting profile is subtly off-center.

**Fix:** Anchor the grid on `spot` (step outward from `Math.round(spot)` both directions), or
document that the profile grid is intentionally step-aligned rather than spot-centered.

### IN-03: Optional `get_gex` MCP tool registers silently when `getGex` is omitted

**File:** `apps/server/src/adapters/mcp/server.ts:61,86-88`

**Issue:** `getGex` is an optional constructor param; when undefined the tool is simply not
registered, with no log. main.ts always passes it today (`main.ts:234`), so this is latent, but a
future call site dropping the arg would silently lose the tool with no boot-time signal — same
pattern as the other optional trader tools.

**Fix:** Either make `getGex` required (it is always wired) or `console.warn` when an expected tool
is skipped.

### IN-04: Non-deterministic JOIN order in `readLegObsForGex`

**File:** `packages/adapters/src/postgres/gex-snapshot.repo.ts:58-78`

**Issue:** The leg-obs JOIN has no `ORDER BY`. Aggregates are order-independent (strikeGex/
buildProfile sum correctly), but the missing ordering is what makes WR-03's `legs[0]` spot pick
non-deterministic and makes raw-cohort debugging/snapshotting unstable.

**Fix:** Add a deterministic `ORDER BY` (e.g. `contracts.strike, contracts.contractType`). It also
directly de-risks WR-03 by making `legs[0]` stable.

---

_Reviewed: 2026-06-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
