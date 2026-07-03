# Phase 17: Overview v2 Redesign + IV Calibration Fix - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 8 (2 new, 4 modified/rewritten, 2 test files extended/new)
**Analogs found:** 8 / 8

RESEARCH.md already did the deep code inspection (module locations, architecture map,
pitfalls). This document turns those findings into per-file, line-referenced excerpts for
the planner to copy from directly. `invertIv` itself is frozen/do-not-modify infrastructure —
no pattern entry rewrites it, only callers.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/src/lib/iv-calibration.ts` (NEW) | utility/service (pure fn) | transform (price→IV) | `apps/web/src/lib/position-greeks.ts` (shape) + `packages/core/src/streaming/recompute-live-greek.ts` (price/error convention) | exact (composite) |
| `apps/web/src/lib/iv-calibration.test.ts` (NEW) | test | property + unit | `packages/core/src/journal/domain/iv-inversion.test.ts` | exact |
| `apps/web/src/lib/scenario-engine.ts` (MODIFY) | service (pure fn, CRUD-like recompute) | transform | itself (existing file, extend in place) | exact |
| `apps/web/src/lib/scenario-engine.test.ts` (MODIFY) | test | unit | itself (existing file, extend in place) | exact |
| `apps/web/src/screens/Overview.tsx` (REWRITE) | component (screen) | request-response (poll + SSE) | itself (existing `Overview.tsx`) + `apps/web/src/screens/Market.tsx` (staleness badge pattern) | exact |
| `apps/web/src/components/charts/PayoffChart.tsx` (MODIFY) | component (chart) | transform (render) | itself (existing file, extend props) | exact |
| Row-highlight interaction (in `Overview.tsx` docked table) | component/hook (local state) | event-driven | `apps/web/src/components/AdHocPicker.tsx` (`clearHovered` toggle) | exact |

## Pattern Assignments

### `apps/web/src/lib/iv-calibration.ts` (NEW — utility, transform)

**Analogs:** `apps/web/src/lib/position-greeks.ts` (file shape/imports) + `packages/core/src/streaming/recompute-live-greek.ts` (mid-price resolution + error tagging convention)

**Imports pattern** (from `position-greeks.ts` lines 14-17):
```typescript
import { parseOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import { ok, err } from "@morai/shared";
// this file additionally needs:
import { invertIv } from "@morai/core";
import type { IvError } from "@morai/core";
```
`invertIv`/`IvError` are exported at `@morai/core` package root per RESEARCH.md — no deep
relative import into `packages/core/src/journal/domain/iv-inversion.ts` from `apps/web`.

**OCC-parse → guard → call-kernel → Result shape** (mirror `position-greeks.ts` lines 73-105):
```typescript
export function computePositionGreeks(
  input: PositionGreeksInput,
): Result<PositionGreeksResult, GreeksError> {
  const parseResult = parseOccSymbol(input.occSymbol);
  if (!parseResult.ok) {
    return err({ kind: "OCC_PARSE_ERROR", detail: `...` });
  }
  const { expiry, type, strike } = parseResult.value;
  const T = (expiry.getTime() - Date.now()) / MS_PER_YEAR;
  if (T <= 0) { return ok({ ... zero-value shape ... }); }
  // call shared kernel, scale, return ok(...)
}
```

**Mid-price resolution + non-convergence tagging** (verbatim convention from
`recompute-live-greek.ts` lines 49-86 — this IS the mid-price/error-tagging source of truth,
copy the guard *order*, not the literal SSE-tick types):
```typescript
// Guard 1: resolve price — mark ?? (bid+ask)/2, else REST marketValue/netQty fallback (Pitfall 3)
let price: number;
if (tick.mark !== null && tick.mark > 0) {
  price = tick.mark;
} else if (tick.bid !== null && tick.ask !== null) {
  const midpoint = (tick.bid + tick.ask) / 2;
  if (midpoint <= 0) return err<LiveGreekSkip>({ kind: "no-price" });
  price = midpoint;
} else {
  return err<LiveGreekSkip>({ kind: "no-price" });
}
// ... parse OCC, guard T <= 0 → { kind: "expired" } ...
const ivResult = invertIv(price, S, K, T, rate, q, type);
if (!ivResult.ok) {
  return err<LiveGreekSkip>({ kind: "iv-failed" }); // NEVER DEFAULT_IV, never last iterate
}
```

**REST-fallback price derivation** — no existing analog for this exact math (new territory,
per RESEARCH Pitfall 3); write it as a guarded local branch, not a new file:
```typescript
// Pitfall 3: BrokerPositionResponse has no bid/ask/mark — derive from marketValue
if (restMarketValue !== null && netQty !== 0) {
  price = Math.abs(restMarketValue) / (Math.abs(netQty) * 100);
} else {
  return err({ kind: "no-price" });
}
```

**Trust-tick-as-converged shortcut (Pitfall 2)** — when a live SSE tick exists for the leg,
trust `tick.bsmIv` directly (already `ok` by construction, server only emits on
`ivResult.ok`); only call `invertIv` client-side for the REST/cold-start fallback path. This
keeps exactly one non-convergence code path.

**Recommended shape (RESEARCH.md "Code Examples" section, already synthesized)** — use
`resolveLegIv(occSymbol, spot, rate, divYield, liveTick, restMarketValue, netQty, now)`
returning `Result<number, CalibrationError>` where
`CalibrationError = IvError | { readonly kind: "no-price" }`.

---

### `apps/web/src/lib/iv-calibration.test.ts` (NEW — test, property + unit)

**Analog:** `packages/core/src/journal/domain/iv-inversion.test.ts`

**Property-test scaffold to mirror** (lines 1-40+):
```typescript
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { invertIv } from "@morai/core"; // vs local ./iv-inversion.ts in the analog

describe("round-trip property — invertIv recovers sigma within 1e-6", () => {
  it("round-trip: |bsmPrice(sigma_recovered) - mark| ≤ 1e-6 (numRuns=1000)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(500), max: Math.fround(8000), noNaN: true }), // S
        fc.float({ min: Math.fround(400), max: Math.fround(9000), noNaN: true }), // K
        fc.float({ min: Math.fround(0.01), max: Math.fround(2), noNaN: true }),   // T
        fc.float({ min: Math.fround(0.05), max: Math.fround(3), noNaN: true }),   // sigma
        // ... (see full analog file for the remaining property + assertion body)
      ),
      { numRuns: 1000 },
    );
  });
});
```
`iv-calibration.test.ts` does NOT need to re-prove `invertIv`'s own 1000-run properties
(already covered upstream in `packages/core`) — its own property coverage should target
`resolveLegIv`'s wrapper behavior specifically: ATM/ITM/OTM/near-zero-vega legs round-trip
through the wrapper, ok/err classification matches `invertIv`'s own result, and REST-fallback
price math never produces `NaN`/`Infinity` (Pitfall 3 unit tests, `netQty === 0` case).

**Degenerate-input unit-test convention** (same file, later sections not re-read here —
pattern is: one `it()` per `IvError.kind` variant, asserting `result.ok === false` and the
exact `kind` tag, never asserting on a computed numeric fallback).

---

### `apps/web/src/lib/scenario-engine.ts` (MODIFY — extend flat IV to calibrated per-leg IV)

**Analog:** itself — extend `AnalyzerPosition` and the pricing helpers in place; do not
introduce a parallel file.

**Current flat-IV shape to extend** (lines 27-53, `AnalyzerPosition` type):
```typescript
export type AnalyzerPosition = {
  readonly id: string;
  readonly name: string;
  readonly live: boolean;
  readonly occSymbol: string;
  readonly putCall: "C" | "P";
  readonly frontDte: number;
  readonly backDte: number;
  readonly frontIv: number; // flat — OVW-02 replaces this input source, not the field's role
  readonly backIv: number;  // flat
  readonly qty: number;
  readonly included: boolean;
};
```
Recommended extension: keep `frontIv`/`backIv` as the numeric fields `calendarNetPrice`
already consumes (lines 148-168, 164-165) but add per-leg convergence tags, e.g.
`frontIvStatus: "ok" | "non-convergent"` and `backIvStatus: "ok" | "non-convergent"`
(or a `Result`-shaped pair) so callers (`bookPL`, `bookPLAtExpiry`) can branch — see Pitfall 1
below for the exact front-vs-back exclusion rule.

**Where flat DEFAULT_IV currently enters (to be replaced)**: `apps/web/src/screens/Overview.tsx`
lines 36 (`DEFAULT_IV = 0.18`) and 50-58 (`netGreeksForLegs` passing `iv: DEFAULT_IV`) — this is
the `BookSummary`/`netGreeksForLegs` path RESEARCH.md's Open Question #2 asks the planner to
explicitly scope in/out. `DEFAULT_IV` in `Market.tsx`/elsewhere should also be grepped per
RESEARCH Pitfall 4's residual guard.

**Leg-level (not position-level) non-convergence exclusion — Pitfall 1 refinement:**
```typescript
// bookPL (T+0, lines 204-221 today): exclude a position from the T+0 sum when its
// FRONT leg is non-convergent (front leg's live time value unknown before expiry).
// bookPLAtExpiry (lines 229-244 today): exclude a position from BOTH the T+0 sum AND the
// @exp sum when its BACK leg is non-convergent (back leg still has real time value at
// frontDte, per bookPLAtExpiry's `backT = max((backDte - frontDte)/365, 1e-6)`).
// Front-only non-convergence: @exp draws normally (front leg is intrinsic-only at its own
// expiry — bsmPrice's T<=0 branch needs no IV).
```
This directly implements 17-UI-SPEC.md State Contract A + RESEARCH.md Pitfall 1 — do not
implement D-02's blanket "exclude from T+0, always draw @exp" rule without this leg split.

---

### `apps/web/src/lib/scenario-engine.test.ts` (MODIFY — extend in place)

**Analog:** itself (existing 220-line file, existing fast-check + unit test conventions already
used for `repriceScenario`/`rollScenario`). Add:
- Front-leg-non-convergent fixture → asserts `@exp` curve unaffected, `T+0` excludes that
  position's contribution.
- Back-leg-non-convergent fixture → asserts BOTH curves exclude that position.
- Scenario-strip level-set cap/dedup/sort test (D-06) if `buildScenarioStrip`-style helper is
  added to this file rather than a new `scenario-strip.test.ts` (planner's call per RESEARCH.md's
  Test Map row).

---

### `apps/web/src/screens/Overview.tsx` (REWRITE — TOS-dock layout)

**Analog:** itself (current file, full structure below) + `apps/web/src/screens/Market.tsx`
(staleness badge pattern, imported verbatim not reimplemented).

**Current imports/hooks to preserve** (lines 1-18):
```typescript
import { useMemo, useState } from "react";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import { useStatus } from "../hooks/useStatus.ts";
import { useLiveStream } from "../hooks/useLiveStream.ts";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";
import { computePositionGreeks } from "../lib/position-greeks.ts";
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { pairPositionsIntoCalendars } from "../lib/pair-calendars.ts";
import { parseOccSymbol } from "@morai/shared";
import { Market } from "./Market.tsx";
import { CotCard } from "../components/CotCard.tsx";
import { MacroCard } from "../components/MacroCard.tsx";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { Panel, SectionLabel, Stat } from "../components/system/index.tsx";
import { cn } from "@/lib/utils";
import type { BrokerPositionResponse } from "@morai/contracts";
import type { StreamLiveGreekEvent } from "@morai/contracts";
```
Add: `PayoffChart`, the new `iv-calibration.ts` helper, `repriceScenario`/scenario-engine
types, `Badge`/`Tooltip` (per UI-SPEC), and the compact `GammaProfile`/`GexBars` right-rail
components (already used elsewhere with `compact` props per RESEARCH.md).

**D-06 constraint (single live-stream consumer)** — preserve verbatim (lines 31-33, 404-412):
```typescript
// D-06 constraint: exactly one live-stream consumer on this surface. useLiveStream()
// is called here and threaded into PositionsTable — NOT into BookSummary or any other
// section. AdHocPicker / SC6 stays on Analyzer (already wired + functional).
const { greeks: liveGreeks, status: liveStatus, lastTickAt: liveLastTickAt } = useLiveStream();
```
The TOS-dock rewrite must keep this single-call invariant — thread `liveGreeks`/`liveStatus`
into the new payoff hero + docked table, not a second `useLiveStream()` call.

**Sections to keep unmodified per UI-SPEC §E.3** (lines 433-458 today — `CotCard`, `MacroCard`,
`BookSummary`, `SystemHealth` — only their page position shifts, JSX body unchanged):
```typescript
<CotCard />
<MacroCard />
// ...
<BookSummary positions={positions} spot={spot} />
<SystemHealth />
```

**Sections to REPLACE** (current Section 1 `PositionsTable` at lines 150-342 → docked table +
payoff hero pair; current Section 2's `<Market />` full embed at line 437 → compact right-rail
GEX stack using `GammaProfile`/`GexBars` `compact` props, not a new chart component).

**Staleness badge — GEX (reuse verbatim, no changes)** — from `Market.tsx`:
```typescript
// lines 43-50
function relAge(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
const GEX_FRESH_MS = 35 * 60 * 1000; // chain refreshes every 30 min during RTH
// lines 199, 239, 242
const gexFresh = gexAgeMs < GEX_FRESH_MS;
<span className={cn("size-1.5 rounded-full", gexFresh ? "bg-up" : "bg-amber")} />
<span className={gexFresh ? "text-up" : "text-amber"}>· {relAge(gexAgeMs)}</span>
```

**Staleness badge — live mark (NEW, same visual grammar, independent 5-min threshold per D-03)**:
```typescript
const markAgeMs = Date.now() - new Date(liveTs).getTime();
const markFresh = markAgeMs <= 5 * 60 * 1000;
// same dot + label + relAge(markAgeMs) shape as the GEX badge above — do not invent a
// second staleness language (UI-SPEC explicit instruction)
```

---

### `apps/web/src/components/charts/PayoffChart.tsx` (MODIFY — dimmed/highlighted dual-curve mode)

**Analog:** itself (existing 741-line file, already renders T+0/@exp/breakevens/GEX walls per
RESEARCH.md — no new chart library, extend props only).

Per 17-UI-SPEC.md State Contract C: add an optional `highlightedPositionId` (or similar) prop.
When set:
- Net-book curve strokes: reduce `stroke-opacity` to **0.3** (a chart-layer prop, NOT the
  existing `opacity-40` row-exclusion class from `PositionsTable` — UI-SPEC explicitly says
  these must stay visually distinct concepts).
- Single highlighted-position curves: same stroke tokens as today's net-book curves — T+0
  violet `#a78bfa` @ 2.6px with glow filter; `@exp` gray-muted dashed @ 1.4px.
- No new chart instance, no modal — same `PayoffChart` component instance re-rendered with new
  curve-data props from `scenario-engine.ts`'s per-position curve functions
  (`positionGreeksAt`/a new single-position payoff-curve helper mirroring `bookPL`'s shape but
  scoped to one position).

Also add the non-convergence exclusion note rendering (D-02 net-book self-flagging) and the
"IV n/a" `Badge`+`Tooltip` per position row, per UI-SPEC State Contract A copy contract.

---

### Row-highlight interaction (D-05, inside the rewritten `Overview.tsx` docked table)

**Analog:** `apps/web/src/components/AdHocPicker.tsx`

**Toggle-on-same-click-to-clear pattern** (lines 65, 131-137):
```typescript
const [clearHovered, setClearHovered] = useState(false);
// ...
<button
  onClick={handleClear}
  onMouseEnter={() => { setClearHovered(true); }}
  className={cn(
    clearHovered ? "text-txt" : "text-muted-foreground",
    // ...
  )}
>
```
For the docked-table row highlight, mirror this shape with two pieces of local state: a
transient hover id (reverts on `onMouseLeave`) and a persisted click-select id (toggles off on
re-click of the same row, switches on click of a different row) — same toggle semantics, applied
to `<tr>` rows instead of a button.

---

## Shared Patterns

### `Result<T,E>` / tagged-error discipline
**Source:** `packages/core/src/journal/domain/iv-inversion.ts` (`IvError`), extended locally in
`iv-calibration.ts` as `CalibrationError = IvError | { readonly kind: "no-price" }`.
**Apply to:** `iv-calibration.ts`, any new branch in `scenario-engine.ts` that surfaces
convergence state. Never `any`/`as`/`!`; always `ok()`/`err()` from `@morai/shared`.

### Mid-price / mark resolution convention
**Source:** `packages/core/src/streaming/recompute-live-greek.ts` lines 49-61
(`price = tick.mark ?? (bid+ask)/2`, `err({kind:"no-price"})` on failure).
**Apply to:** `iv-calibration.ts` — copy this exact guard order for the live-tick branch; the
REST-fallback branch is new (Pitfall 3) but follows the same "typed err, never divide-by-zero"
discipline.

### Staleness-timestamp badge (dot + label + relative age)
**Source:** `apps/web/src/screens/Market.tsx` lines 43-53 (`relAge`, `GEX_FRESH_MS`), 199,
239-242 (render).
**Apply to:** both the reused GEX badge (verbatim import/reuse, no reimplementation) and the new
live-mark badge (same shape, independent 5-min threshold) in the rewritten `Overview.tsx`.

### OCC-parse-first, no hand-rolled symbol parsing
**Source:** `apps/web/src/lib/position-greeks.ts` line 76 (`parseOccSymbol(input.occSymbol)`),
also used identically in `recompute-live-greek.ts` line 70 and `Overview.tsx` line 127.
**Apply to:** `iv-calibration.ts` — always resolve `expiry`/`type`/`strike` via
`parseOccSymbol` from `@morai/shared`, never `scenario-engine.ts`'s manual `extractStrike`
string-slice (lines 189-197) for anything touching the calibration path — that helper is a
pre-existing exception scoped only to the flat-IV pricer, not a pattern to extend.

### Local toggle state for hover/select UI (no route change, no global state)
**Source:** `apps/web/src/components/AdHocPicker.tsx` lines 65, 131-137.
**Apply to:** row-highlight interaction (D-05) in the rewritten `Overview.tsx`.

## No Analog Found

None — every file in scope has at least one strong (exact/composite) analog. The
REST-fallback price-derivation math (Pitfall 3) has no direct precedent in the codebase; it is
new logic but follows the established `Result`/typed-err discipline, not a novel pattern
category.

## Metadata

**Analog search scope:** `apps/web/src/lib/`, `apps/web/src/screens/`,
`apps/web/src/components/`, `packages/core/src/journal/domain/`,
`packages/core/src/streaming/` — directories already enumerated by RESEARCH.md's Sources
section; no additional Glob/Grep sweep was needed beyond confirming line ranges.
**Files read directly (this pass):** `position-greeks.ts` (full), `recompute-live-greek.ts`
(full), `scenario-engine.ts` (full), `Overview.tsx` (full), `Market.tsx` (lines 1-80 + targeted
grep for badge lines), `AdHocPicker.tsx` (targeted grep), `iv-inversion.ts` (lines 1-60),
`iv-inversion.test.ts` (lines 1-40).
**Pattern extraction date:** 2026-07-03
