# Phase 18: Analyzer → Picker UI Redesign - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 10 (8 new/modified + 2 modified test files) + 11 delete-candidates
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/contracts/src/picker.ts` | model (Zod contract) | transform (parse/validate) | `packages/contracts/src/gex.ts` | exact |
| `packages/contracts/src/picker.test.ts` | test | transform | `packages/contracts/src/gex.test.ts` | exact |
| `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` | config/fixture (static data) | transform | no existing `__fixtures__` dir in `packages/contracts` yet — analog is the oracle-payload literal inlined in `gex.test.ts` (lines 12-35), promoted to its own module | role-match (new subdir, established literal-data convention) |
| `packages/contracts/src/index.ts` | config (barrel re-export) | — | itself (existing re-export block pattern) | exact |
| `apps/web/src/lib/candidate-to-position.ts` | utility (adapter/transform) | transform | `apps/web/src/screens/Analyzer.tsx` private `calendarToAnalyzerPosition` (lines 120-135) | role-match (pattern to imitate, not import — see note below) |
| `apps/web/src/lib/candidate-to-position.test.ts` | test | transform | `apps/web/src/lib/scenario-engine.test.ts` | exact |
| `apps/web/src/components/charts/PayoffChart.tsx` | component | request-response (props-in, SVG-out) | itself — 3 prior additive-prop rounds (`highlightedPositionId`, `todayCurveColor`/`expirationCurveColor`) | exact |
| `apps/web/src/components/charts/PayoffChart.test.tsx` | test | request-response | itself (existing test file, new cases added) | exact |
| `apps/web/src/screens/Analyzer.tsx` | component (screen) | request-response | `apps/web/src/screens/Overview.tsx` (sibling screen: Panel/system molecules + `PayoffChart` + fixture/hook-driven data) | exact |
| `apps/web/src/screens/Analyzer.test.tsx` | test | request-response | `Overview.test.tsx` conventions for a Panel/PayoffChart screen test | role-match |

## Pattern Assignments

### `packages/contracts/src/picker.ts` (model, transform)

**Analog:** `packages/contracts/src/gex.ts` (77 lines, read in full)

**Imports pattern** (line 1):
```typescript
import { z } from "zod";
```
No other imports — contracts layer is zod-only for a self-contained schema (architecture-boundaries.md: contracts may import zod + `@morai/shared` only).

**Module header-comment convention** (lines 3-5 of `gex.ts`):
```typescript
// GEX contracts (MCP-02: ONE schema source for GET /api/analytics/gex + get_gex MCP tool).
// gexSnapshotResponse = gexSnapshotEntry — a SINGLE object (not an array; D-03).
// A one-sided field rename fails `bun run typecheck`. No second inline GEX schema.
```
Mirror this for `picker.ts`: state that `pickerCandidate` is the ONE schema both the Phase-18 fixture and the Phase-19 `/api/picker/candidates` response/`get_picker_candidates` MCP tool must satisfy, per D-01/research's MCP-02 pattern note.

**Core schema pattern — nested object composition + z.infer per concern** (gex.ts lines 10-27, 36-69):
```typescript
export const gexWallEntry = z.object({
  k: z.number(),
  gex: z.number(),
  coi: z.number().int(),
  poi: z.number().int(),
  vol: z.number().int(),
});
export type GexWallEntry = z.infer<typeof gexWallEntry>;

export const gexSnapshotEntry = z.object({
  spot: z.number(),
  flip: z.number().nullable(),
  callWall: z.number().nullable(),
  putWall: z.number().nullable(),
  netGammaAtSpot: z.number(),
  profile: z.array(z.object({ spot: z.number(), gamma: z.number() })),
  strikes: z.array(gexWallEntry),
  byExpiry: z.array(z.object({ date: z.string(), gex: z.number() })),
  computedAt: z.string().datetime(),
});
export type GexSnapshotEntry = z.infer<typeof gexSnapshotEntry>;
```
Apply this exact shape to `picker.ts`: `pickerCandidateLeg` (small nested object, like `gexWallEntry`), `breakdownEntry`, `exitPlan` as their own named schemas + `z.infer` types, composed into the top-level `pickerCandidate` object (like `gexSnapshotEntry` composes `gexWallEntry`). RESEARCH.md's Pattern 1 code block gives the concrete field list to use for `picker.ts` — that block is the accepted starting point, not a re-derivation.

**Nullable + doc-comment convention for guard fields** (gex.ts lines 39-51): every nullable field carries a `/** ... null when ... */` doc comment explaining the null condition. Apply the same style to `fwdIv`/`fwdIvGuard` (D-01a): document that `fwdIvGuard === "inverted"` implies `fwdIv === null`, mirroring `flip`/`callWall`/`putWall`'s "null when no crossing/no dominant wall" comments.

**Response-alias pattern** (gex.ts lines 71-77):
```typescript
export const gexSnapshotResponse = gexSnapshotEntry;
export type GexSnapshotResponse = GexSnapshotEntry;
```
Not required this phase (no route/MCP consumer yet — Phase 19), but note it as the established idiom for exposing a contract as both an internal type and a transport-alias name later.

**No `.refine()` used in gex.ts** — confirms RESEARCH.md's Assumption A4: cross-field validation (`fwdIvGuard`/`fwdIv` consistency) is optional, matching the repo's existing lightness. Prefer plain nullable + enum-tag fields unless the fixture's own test needs stronger enforcement.

---

### `packages/contracts/src/picker.test.ts` (test, transform)

**Analog:** `packages/contracts/src/gex.test.ts` (106 lines, read lines 1-40 in full)

**Imports + header-comment pattern** (lines 1-10):
```typescript
/**
 * GEX contract tests (Phase 8, Plan 08-02).
 *
 * gexSnapshotEntry is the single Zod schema source for both GET /api/analytics/gex and the
 * get_gex MCP tool (MCP-02). gexSnapshotResponse = gexSnapshotEntry (single object, not an
 * array — D-03). Oracle values from mockups/gex-snapshot.json + mockups/gex-profile.json.
 */

import { describe, it, expect } from "vitest";
import { gexSnapshotEntry, gexSnapshotResponse, gexWallEntry } from "./gex.ts";
```
Mirror: header comment naming the phase/decision provenance ("Phase 18, D-01") and the oracle-data source (`mockups/playground-v4.html`'s real candidates, per D-03). Import `{ describe, it, expect } from "vitest"` and the schemas from `./picker.ts`.

**Oracle-payload test pattern** (lines 12-40):
```typescript
const oraclePayload = {
  spot: 7381.1201,
  flip: 7488,
  // ...literal real data...
};

describe("gexSnapshotEntry", () => {
  it("parses the oracle payload (spot 7381, flip 7488, callWall 7600, putWall 7400, netGammaAtSpot -47)", () => {
    expect(() => gexSnapshotEntry.parse(oraclePayload)).not.toThrow();
  });
```
Apply directly: one `oraclePayload`-style literal per test file (or import the frozen fixture module itself), `.parse()` — never `.safeParse()` swallowed — asserted via `.not.toThrow()`. Add a second `it` for a malformed breakdown entry that MUST throw (per RESEARCH.md's ANLZ-01 test-map row), and a third `it` parsing the guard-case candidate (`fwdIv: null`, `fwdIvGuard: "inverted"`) to prove the nullable path is schema-legal.

---

### `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` (config/fixture, transform)

**Analog:** No `__fixtures__/` subdirectory exists yet under `packages/contracts/src/` — RESEARCH.md's Assumption A2 cites `packages/core/src/__fixtures__/` and `packages/adapters/src/test/fixtures/` as repo precedent for the *naming convention* (a dedicated fixtures directory, not test-inlined literals). Nearest in-package analog for the *data shape itself* is the `oraclePayload` literal in `gex.test.ts` (lines 14-35) — same idea (frozen real numbers as a typed const), promoted to its own importable module instead of staying test-local, since this fixture is also imported by the picker screen (not test-only).

**Pattern to follow:**
```typescript
import type { PickerCandidate } from "../picker.ts";

export const pickerCandidatesFixture: readonly PickerCandidate[] = [
  // 6-8 real candidates ported from mockups/playground-v4.html buildCandidates() OUTPUT
  // (not its logic — D-03), spot 7498.85, GEX flip 7473, walls 7400/7525, netGamma +26.2B,
  // FOMC 7/29, CPI 7/14+8/12, NFP 7/3+8/7.
  // ...
  // Guard-case candidate (D-03a): inverted structure, fwdIv: null, fwdIvGuard: "inverted",
  // expectedMove/theta/vega/score all normal computed values (Pitfall 3 — don't null those out).
];
```
Read `mockups/playground-v4.html` directly (header comment + `buildCandidates()`'s output values, not its function body) to source the literal numbers — this is authoring work, not a code port.

---

### `packages/contracts/src/index.ts` (config, barrel)

**Analog:** itself — read the existing re-export block convention.

**Pattern:** Add a `picker.ts` export block in the same style as the existing per-contract blocks (one block per module, presumably grouped by comment header matching `gex.ts`'s style). Read the existing file directly before editing to match exact block formatting (grouping comment + named exports vs. `export *`).

---

### `apps/web/src/lib/candidate-to-position.ts` (utility, transform)

**Analog:** `apps/web/src/screens/Analyzer.tsx` private `calendarToAnalyzerPosition` (lines 120-135) — **pattern to imitate, cannot be imported** (it is unexported and shaped for `CalendarGroup`, a paired-broker-leg type with `longQty`/`shortQty`/`BrokerPositionResponse` fields a `PickerCandidate` doesn't have).

**Exact pattern being imitated** (lines 115-135):
```typescript
/**
 * Build one AnalyzerPosition from a paired calendar (front = short/nearer, back = long/farther).
 * This is the real calendar structure — front/back DTE come from the actual leg expiries, not
 * the single-leg DEFAULT_FRONT/BACK_DTE fallback. IVs stay at DEFAULT_IV (broker has no IV).
 */
function calendarToAnalyzerPosition(cal: CalendarGroup): AnalyzerPosition {
  const qty = Math.max(1, Math.abs(cal.back.longQty - cal.back.shortQty));
  return {
    id: cal.key,
    name: `${cal.strike}${cal.optionType}`,
    live: true,
    occSymbol: cal.back.occSymbol, // AnalyzerPosition.occSymbol = BACK leg
    putCall: cal.optionType,
    frontDte: cal.dteFront,
    backDte: cal.dteBack,
    frontIv: DEFAULT_IV,
    backIv: DEFAULT_IV,
    qty,
    included: true,
  };
}
```
**What to change for the new adapter:** `live: false` (D-02b — hypothetical, never broker), `frontIv`/`backIv` come from `candidate.frontLeg.iv`/`candidate.backLeg.iv` (real fixture values, not `DEFAULT_IV` — candidates carry their own IV, calendars from broker positions don't), `occSymbol` must be synthesized from the strike (no real broker symbol exists) — RESEARCH.md's Code Examples section gives a concrete `occSymbolForStrike()` helper to pair with this; read that block (`RESEARCH.md` "Pattern 3") alongside this analog before writing.

**Sibling function for context** (`fmtGreek`/`fmtDollar`, lines 137-149) — same file's local-helper style (small pure functions above the main export) — not directly reused, but shows the file's formatting-helper convention if the picker screen needs similar formatters.

---

### `apps/web/src/lib/candidate-to-position.test.ts` (test, transform)

**Analog:** `apps/web/src/lib/scenario-engine.test.ts` (477 lines) — the file's own multi-describe-block, kernel-parity + fast-check-property style (per RESEARCH.md Summary finding #1: 7+ describe blocks covering kernel parity, payoff-shape, expiration-curve invariance, non-convergence exclusion, and a 1000-run fast-check heatmap property test).

**Core invariant test to write** (RESEARCH.md Code Examples, exact block to copy):
```typescript
import { repriceScenario } from "./scenario-engine.ts";
import { candidateToAnalyzerPosition } from "./candidate-to-position.ts";

it("a candidate's max loss on the expirationCurve does not exceed its debit (within pricing tolerance)", () => {
  const position = candidateToAnalyzerPosition(SOME_FIXTURE_CANDIDATE);
  const result = repriceScenario([position], BASE_PARAMS);
  const worstCase = Math.min(...result.expirationCurve.map((p) => p.pl));
  expect(worstCase).toBeGreaterThanOrEqual(-SOME_FIXTURE_CANDIDATE.debit - TOLERANCE);
});
```
Add a `fast-check` property-test variant (numRuns ≥ 100) generating arbitrary in-range candidate legs, per `.claude/rules/tdd.md`'s "numerical code needs fast-check property tests" requirement — model the property test's `fc.assert(fc.property(...))` shape directly on `scenario-engine.test.ts`'s existing 1000-run heatmap property test (read that describe block before writing, to match its generator/assertion style exactly).

---

### `apps/web/src/components/charts/PayoffChart.tsx` (component, request-response)

**Analog:** itself — 3 prior additive-prop rounds already establish the exact idiom to extend a 4th time.

**Interface extension pattern** (lines 48-102, `PayoffChartProps`):
```typescript
export interface PayoffChartProps {
  // ...existing required fields (todayCurve, fanCurves, expirationCurve, rollCurve, gex, spot,
  //    toggles, fitY, onFitYConsumed, positionSetSignature, baseExpirationCurve)...

  /**
   * D-05 row-highlight: id of the docked-table row currently hovered/selected.
   * ...
   */
  highlightedPositionId?: string | null;
  highlightedTodayCurve?: ReadonlyArray<PayoffPoint> | null;
  highlightedExpirationCurve?: ReadonlyArray<PayoffPoint> | null;
  excludedFromT0Count?: number;
  /**
   * D-03 TOS-fidelity override seam: net-book T+0 curve + BE stroke color.
   * Defaults to the Analyzer's violet brand color; the Overview hero injects
   * TOS magenta here without affecting the Analyzer (which passes neither color prop).
   */
  todayCurveColor?: string;
  expirationCurveColor?: string;
}
```
Add the new pair in the exact same style, each optional (`?`) with a doc comment stating the phase/decision and default behavior:
```typescript
/** ⊕-compare overlay: single dashed amber front-expiry curve for a second candidate (ANLZ-02). */
compareCurve?: ReadonlyArray<PayoffPoint> | null;
compareCurveColor?: string; // default AMBER
/** ±1σ expected-move band: two tick marks + connector at the zero-P&L line (ANLZ-02). */
expectedMoveBand?: { spot: number; em: number } | null;
```

**Destructuring-default pattern** (lines 221-239, the function signature itself):
```typescript
export function PayoffChart({
  todayCurve,
  fanCurves,
  expirationCurve,
  rollCurve,
  gex,
  spot,
  toggles,
  fitY,
  onFitYConsumed,
  positionSetSignature,
  baseExpirationCurve,
  highlightedPositionId = null,
  highlightedTodayCurve = null,
  highlightedExpirationCurve = null,
  excludedFromT0Count = 0,
  todayCurveColor = VIOLET,
  expirationCurveColor = GRAY_MUTED,
}: PayoffChartProps): React.ReactElement {
```
Add `compareCurve = null, compareCurveColor = AMBER, expectedMoveBand = null` to this same destructuring list — **this exact pattern is what satisfies `exactOptionalPropertyTypes`** (Pitfall 4 in RESEARCH.md) and is what keeps `Overview.tsx`'s existing call site (which doesn't pass these props) compiling and behaving unchanged.

**Existing color constants to reuse** (lines 116-126): `AMBER = "#f0b429"` and `BLUE = "#5b9cf6"` are already declared module constants — use them directly for `compareCurveColor` default and the EM-band tick color; do not redeclare.

**Layer placement — z-order pattern** (existing "Zero line" layer near line 453, `rollCurve` layer at lines 517-527):
```typescript
{rollCurve !== null && rollCurve.length > 0 && (
  <LinePath
    data={[...rollCurve]}
    // ...
  />
)}
```
Follow this exact `!== null && .length > 0 &&` guard idiom for `compareCurve`'s new conditional render block. Per RESEARCH.md/UI-SPEC: draw `expectedMoveBand` between the existing zero-line layer and the T+0 curve layer (new layer, not a repurposed one); draw `compareCurve` as its **own separate conditional block** alongside (not inside) the existing `rollCurve` block — same visual style (dashed amber) but a distinct prop/layer, since `rollCurve` is retired-but-still-present (picker always passes `rollCurve={null}`, per D-04).

---

### `apps/web/src/components/charts/PayoffChart.test.tsx` (test, request-response)

**Analog:** itself (existing file) — read its current `@testing-library/react` render + assertion style before adding cases. New cases needed (per RESEARCH.md's test map): `compareCurve` renders a dashed amber line when supplied, renders nothing extra when `null`/absent (regression guard for `Overview.tsx`'s existing call, which never passes it); `expectedMoveBand` ticks render at `spot ± em` at the zero-P&L y-position and appear before the curve layers in SVG element order (z-order assertion).

---

### `apps/web/src/screens/Analyzer.tsx` (component/screen, request-response — FULL REPLACE)

**Analog:** `apps/web/src/screens/Overview.tsx` (1163 lines) — sibling screen using `Panel`/system molecules + `PayoffChart`, fixture/hook-driven, no broker-position editing (closest existing "view-only screen wired to PayoffChart" precedent). Also read `Overview.tsx`'s existing `PayoffChart` call site directly before finalizing the picker's own call, to confirm exactly which props it omits (proof that new optional props don't break it).

**Retained export contract** (Analyzer.tsx line 465):
```typescript
export function Analyzer(): React.ReactElement {
```
**Keep this exact export name and signature** — `apps/web/src/App.tsx` imports `{ Analyzer }` and renders it under the unchanged nav key `"Analyzer"`; a same-name full rewrite means `App.tsx` needs zero changes (confirmed by RESEARCH.md's route-wiring note).

**System molecules to reuse** (per CONTEXT.md/RESEARCH.md — `Panel`, `SectionLabel`, `Stat`, `MetricChip`, `PanelHeading` from `apps/web/src/components/system/index.tsx`, "same pattern as Phase 17.1"): read that module's exports directly before building the 3-column layout; do not invent new layout primitives.

**What NOT to keep from the old file** (verified callers, see Deletions section below): `ScenarioPanel` (lines 277-283 region), `BookGreeksTable` (line 376), the whole `calendarToAnalyzerPosition`/`CalendarGroup`/broker-position wiring — none of it survives the rewrite; only the *pattern* of building an `AnalyzerPosition` and feeding `PayoffChart` carries forward (via the new adapter, not this code).

---

### `apps/web/src/screens/Analyzer.test.tsx` (test — FULL REWRITE)

**Analog:** Existing `Analyzer.test.tsx`'s 7 `describe`/`it` blocks all assert retired behavior (paste-positions, roll simulator) and must be deleted wholesale, not edited. Use `Overview.test.tsx`'s conventions (render via `@testing-library/react`, assert Panel/`PayoffChart` presence, fixture-driven props) as the structural analog for the new picker screen's tests. Cover per RESEARCH.md's test map: breakdown-bar data-driven filtering (never hard-coded index), guard-case candidate render (`n/a` caption, zero-width bar, no throw/NaN), forward-edge sentence branching, entry/exit plan arithmetic.

---

## Shared Patterns

### Contract module + barrel re-export
**Source:** `packages/contracts/src/gex.ts` + `packages/contracts/src/index.ts`
**Apply to:** `picker.ts`, `picker.test.ts`, `index.ts` edit
One `*.ts` (Zod schema + `z.infer` type) + one `*.test.ts` (oracle-payload `.parse()` assertions) + a re-export block in `index.ts`. Zero cross-imports beyond `zod` (contracts-layer boundary rule).

### Additive optional props, never touching existing callers
**Source:** `apps/web/src/components/charts/PayoffChart.tsx` `PayoffChartProps` (3 prior rounds: `highlightedPositionId`/`todayCurveColor`/`expirationCurveColor` families)
**Apply to:** `PayoffChart.tsx`'s new `compareCurve`/`compareCurveColor`/`expectedMoveBand` props
Every new prop is `?`-optional in the interface AND has a destructured default in the function signature (`= null` / `= AMBER`). This is what keeps `exactOptionalPropertyTypes` satisfied and `Overview.tsx`'s existing call untouched (Pitfall 4).

### Nullable value + sibling enum-tag (never a bare NaN, never a Result-shaped Zod union)
**Source:** `apps/web/src/lib/scenario-engine.ts`'s `AnalyzerPosition.frontIvStatus?: "ok" | "non-convergent"` idiom (cited by RESEARCH.md; also `packages/contracts` nullable-field precedent in `gex.ts`'s `flip`/`callWall`/`putWall`)
**Apply to:** `picker.ts`'s `fwdIv: z.number().nullable()` paired with `fwdIvGuard: z.enum(["ok", "inverted"])` (D-01a)
Never encode `fwdIv` as `NaN`, never build a full `Result<T,E>`-shaped discriminated union at the contracts layer — that's a core/adapter-tier concept, not this repo's wire-format idiom.

### Pattern-to-imitate, not code-to-import (private helper analogs)
**Source:** `apps/web/src/screens/Analyzer.tsx`'s private `calendarToAnalyzerPosition` (unexported, `CalendarGroup`-shaped)
**Apply to:** `candidate-to-position.ts`'s new `candidateToAnalyzerPosition`
Do not attempt to export/reuse the private function or force `PickerCandidate` legs into `CalendarGroup`'s broker-position shape (`BrokerPositionResponse`, `longQty`/`shortQty`). Write an independent adapter following the same *field-mapping shape* (`id`, `name`, `occSymbol`, `frontDte`/`backDte`/`frontIv`/`backIv`, `qty`, `included: true`) with `live: false` and a synthesized `occSymbol` (Pitfall 2).

## No Analog Found

None — every file in scope has at least a role-match analog (see table above). The one near-miss is the fixture module's *directory* (`__fixtures__/` doesn't exist yet under `packages/contracts/src/`), but the *data-authoring pattern* it should follow (a frozen typed literal, `gex.test.ts`'s `oraclePayload`) is a strong analog; only the subdirectory itself is new plumbing, not a missing pattern.

## Deletions (D-04/D-04a) — Verified Current Locations

| Symbol/File | Verified location this session | Disposition |
|---|---|---|
| `calendarToAnalyzerPosition` | `apps/web/src/screens/Analyzer.tsx:120-135` (private, unexported) | Deleted with the file rewrite — not exported, no external caller possible |
| `ScenarioPanel` | `apps/web/src/screens/Analyzer.tsx:277-283` region (`interface ScenarioPanelProps` at 277, `function ScenarioPanel` at 283, used at `:731`) | DELETE — inline function, goes away with rewrite |
| `BookGreeksTable` | `apps/web/src/screens/Analyzer.tsx:376` (used at `:864`) | DELETE — inline function, goes away with rewrite |
| `export function Analyzer()` | `apps/web/src/screens/Analyzer.tsx:465` | REWRITTEN in place, same export name/signature kept |
| `RollSimulator`, `AdHocPicker`, `rollScenario`, `parseTosOrder`, `AttributionWaterfall`, `GreekStrips`, `PnlHeatmap`, `LevelBar` | Separate component/lib files per RESEARCH.md's caller-verified table (grep-confirmed `Analyzer.tsx`-only importers) | DELETE each file + its test file once `Analyzer.tsx`'s rewrite no longer imports them — re-verify each via `grep -rl` immediately before deleting, per D-04a ("verify callers before deleting") |
| `repriceScenario`, `AnalyzerPosition`, `bookPL`, `PayoffChart`, `pairPositionsIntoCalendars`, `CalendarGroup`, `usePositions`, `useGex`, `useLiveStream`, `GammaProfile`, `GexBars` | Shared across `Analyzer.tsx` **and** `Overview.tsx`/other screens | KEEP (D-04a explicit) — the new picker screen simply stops importing the ones it no longer needs (`usePositions`, `useGex`, `pairPositionsIntoCalendars`/`CalendarGroup`) while `Overview.tsx` keeps using them |

## Metadata

**Analog search scope:** `packages/contracts/src/`, `apps/web/src/screens/`, `apps/web/src/lib/`, `apps/web/src/components/charts/` (directories directly named in CONTEXT.md/RESEARCH.md's file list)
**Files scanned/read this session:** `packages/contracts/src/gex.ts` (full, 77 lines), `packages/contracts/src/gex.test.ts` (lines 1-40 of 106), `apps/web/src/screens/Analyzer.tsx` (lines 100-149 of 880, plus grep-located line numbers for `ScenarioPanel`/`BookGreeksTable`/`Analyzer()`), `apps/web/src/components/charts/PayoffChart.tsx` (lines 40-289 of 880, plus grep-located line numbers for the full `PayoffChartProps` interface and z-order layers)
**Pattern extraction date:** 2026-07-04
