# Phase 22: Journal Calendar-Lifecycle Graph - Pattern Map

**Mapped:** 2026-07-05
**Files analyzed:** 12 (new) + 5 (modified)
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/journal/domain/fwd-vol.ts` | utility (domain fn) | transform | `packages/core/src/picker/domain/fwd-iv.ts` | exact |
| `packages/core/src/journal/domain/fwd-vol.test.ts` | test | transform | `packages/core/src/picker/domain/fwd-iv.test.ts` | exact |
| `packages/core/src/journal/domain/attribution.ts` | utility (domain fn) | transform (batch, per-interval accumulation) | `apps/web/src/lib/deriveStreamStatus.ts` (pure-fn style) + D-06 spec (no direct analog for accumulation) | role-match |
| `packages/core/src/journal/domain/attribution.test.ts` | test | transform | `packages/core/src/picker/domain/fwd-iv.test.ts` (fast-check shape) | role-match |
| `packages/core/src/journal/application/getCalendarLifecycle.ts` | service (use-case) | request-response (thin forwarder + map) | `packages/core/src/journal/application/getCalendarEventsWithRules.ts` (multi-port map) / `getJournal.ts` (thin forwarder) | exact |
| `packages/core/src/journal/application/getCalendarLifecycle.test.ts` | test | request-response | `packages/core/src/journal/application/getCalendarEventsWithRules.test.ts` | exact |
| `packages/contracts/src/journal.ts` (edit, additive) | config (Zod contract) | transform | `packages/contracts/src/picker.ts` (`fwdIv`/`fwdIvGuard` tagged pair) + existing `journal.ts` `snapshotResponse` | exact |
| `apps/server/src/adapters/http/journal-lifecycle.routes.ts` (new sibling) or edit `journal.routes.ts` | route | request-response | `apps/server/src/adapters/http/journal-rules.routes.ts` | exact |
| `apps/server/src/adapters/mcp/tools.ts` (edit, additive `get_journal_lifecycle`) | route (MCP tool) | request-response | existing `get_journal` / `get_rule_tags` tool registration in same file | role-match |
| `apps/server/src/main.ts` (edit, additive mount) | config (composition root) | request-response | existing `journalRoutes`/`journalRulesRoutes` mount lines 271-273 | exact |
| `apps/web/src/hooks/useLifecycle.ts` | hook | request-response (polling fetch) | `apps/web/src/hooks/useJournal.ts` | exact |
| `apps/web/src/components/LifecycleChart.tsx` (rewrite) | component | transform (SVG render) | `apps/web/src/components/charts/PayoffChart.tsx` (existing self, pre-rewrite) | exact |
| `apps/web/src/components/LifecycleMasthead.tsx` | component | request-response (presentational) | `apps/web/src/screens/Journal.tsx`'s current trade-header `Panel` block | role-match |
| `apps/web/src/components/PnlBridgeCard.tsx` | component | request-response (presentational, crosshair-reactive) | `system/index.tsx` `Stat`/kv-row idiom + `PayoffChart.tsx` crosshair-state pattern | role-match |
| `apps/web/src/components/EdgeCard.tsx` | component | request-response (presentational) | `system/index.tsx` `Stat`/`MetricChip` idiom | role-match |
| `apps/web/src/components/GreeksNowCard.tsx` | component | request-response (presentational) | `system/index.tsx` `Stat` kv-row idiom | role-match |
| `apps/web/src/components/BeatsCard.tsx` | component | request-response (presentational, list) | `apps/web/src/screens/Journal.tsx`'s retired "why it moved" callout + `RuleTagChips` list-rendering idiom | role-match |
| `apps/web/src/screens/Journal.tsx` (edit) | component (screen) | request-response | itself, current `LifecycleSection` (lines 319-430) | exact (self) |

## Pattern Assignments

### `packages/core/src/journal/domain/fwd-vol.ts` (domain fn, transform)

**Analog:** `packages/core/src/picker/domain/fwd-iv.ts` (full file, 31 lines — small enough to copy near-verbatim per RESEARCH.md's explicit "duplicate, don't import" instruction, architecture-boundaries.md rule 7).

**Full source to duplicate and adapt:**
```typescript
export type FwdIvResult =
  | { readonly fwdIv: number; readonly guard: "ok" }
  | { readonly fwdIv: null; readonly guard: "inverted" };

export function computeFwdIv(tf: number, ivf: number, tb: number, ivb: number): FwdIvResult {
  const rad = (tb * ivb * ivb - tf * ivf * ivf) / (tb - tf);
  if (rad < 0) {
    return { fwdIv: null, guard: "inverted" };
  }
  return { fwdIv: Math.sqrt(rad), guard: "ok" };
}
```
Rename to `computeForwardVol`, `ForwardVolResult` per RESEARCH.md's `fwd-vol.ts` code example (adds `Number.isFinite`/`tb === tf` guards before the radicand check — journal's raw fields are strings, picker's are pre-parsed numbers, so the wrapper differs slightly; keep the exact same guard-tag shape: `{ forwardVol: number; guard: "ok" } | { forwardVol: null; guard: "inverted" }`).

**Doc-comment pattern to copy:** the file-header block explaining the formula, guard rationale ("radicand exactly 0 is 'ok', not 'inverted'"), and "pure domain: no I/O" declaration — same 3-part structure for `fwd-vol.ts`'s header, cross-referencing the picker original per RESEARCH's duplication note.

---

### `packages/core/src/journal/domain/fwd-vol.test.ts` (test)

**Analog:** `packages/core/src/picker/domain/fwd-iv.test.ts` — read for its example-test + fast-check property shape (not reproduced in full here; the file exists and is small — planner/executor should Read it directly for the exact `fc.assert(fc.property(...))` invocation style used project-wide). Cover: radicand<0 → `"inverted"`, radicand===0 → `"ok"` + `forwardVol:0`, non-finite IV input → `"inverted"`.

---

### `packages/core/src/journal/domain/attribution.ts` (domain fn, transform/batch)

**No direct in-repo analog for the accumulation shape** (per-interval decomposition + cumulative sum walking an array). RESEARCH.md supplies the exact target shape as pseudocode — use it as the primary spec, and pattern-match the *pure-function, no-I/O, exported-type-first* style from `deriveStreamStatus.ts`:

**Style analog** (`apps/web/src/lib/deriveStreamStatus.ts`, full file):
```typescript
export type DerivedStatus = "live" | "quiet" | "connecting" | "stalled";

export function deriveStreamStatus(input: {
  readonly hasReceivedFirstTick: boolean;
  readonly msSinceLastTickOrConnect: number;
  readonly isRth: boolean | null;
  readonly stallThresholdMs: number;
}): DerivedStatus {
  if (input.isRth === false) return "quiet";
  if (input.isRth === null) return "connecting";
  if (input.msSinceLastTickOrConnect < input.stallThresholdMs) {
    return input.hasReceivedFirstTick ? "live" : "connecting";
  }
  return "stalled";
}
```
Copy: single exported object-param function signature, ordered branch comment ("Branch order (locked, do not reorder)"), no React/DOM import, caller supplies all inputs (no internal `Date.now()`/side effects — mirrors D-06's "caller passes the row array" requirement).

**Target shape** (from RESEARCH.md Code Examples — this is what the planner should implement, already vetted against the actual DB columns):
```typescript
export type AttributionInterval = {
  readonly theta: number;
  readonly vega: number;
  readonly deltaGamma: number;
  readonly residual: number;
};

export type LifecycleSnapshot = {
  readonly time: string;
  readonly isGap: boolean;
  readonly cumTheta: number;
  readonly cumVega: number;
  readonly cumDeltaGamma: number;
  readonly cumResidual: number;
};

function isGapRow(row: { spot: string; frontIv: string; backIv: string; netDelta: string; netGamma: string; netTheta: string; netVega: string }): boolean {
  if (row.spot === "0") return true;
  return [row.frontIv, row.backIv, row.netDelta, row.netGamma, row.netTheta, row.netVega]
    .some((v) => !Number.isFinite(parseFloat(v)));
}
// computeAttributionSeries(rows) walks consecutive pairs, skipping (never bridging) gap boundaries.
```
Locked conventions (do not relitigate — see 22-RESEARCH.md "Code Examples" + Pitfalls 1-4):
- `Δt` from `time` timestamps, NOT `dteFront`/`dteBack` (Pitfall 3 — those are integer-floored, flat within a day).
- vega bucket = `netVega[i] × Δ(mean(frontIv, backIv)) × 100` (Pitfall 2 — no per-leg vega history exists).
- `residual[i] = ΔpnlOpen[i] − theta[i] − vega[i] − deltaGamma[i]` (exact plug, never hidden — D-05).
- `pnlOpen` is already dollars, never divide by 100 again (Pitfall 1).

---

### `packages/core/src/journal/domain/attribution.test.ts` (test)

**Analog for fast-check shape:** `packages/core/src/picker/domain/fwd-iv.test.ts` (property-test invocation idiom). Required property (RESEARCH.md): sum of (theta+vega+deltaGamma+residual) across any contiguous non-gap span equals `pnlOpen[end] - pnlOpen[start]` exactly — this is a tautology-check on the plug-residual construction, write it as `fc.assert(fc.property(fc.array(rowArb), ...))`.

---

### `packages/core/src/journal/application/getCalendarLifecycle.ts` (use-case, request-response)

**Analog:** `packages/core/src/journal/application/getCalendarEventsWithRules.ts` (full file, 77 lines, read above) for the "map a Result through pure domain fns, propagate err early" shape, and `getJournal.ts` (full file, 26 lines, read above) for the even-thinner single-port forwarder shape this use-case is closer to (single `ForReadingJournal` port, not two ports).

**Core pattern to copy** (from RESEARCH.md, already adapted to this exact use-case — treat as the canonical target, cross-checked against both analogs' `ok/err` propagation idiom):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingJournal, SnapshotRow, StorageError } from "./ports.ts";
import { computeForwardVol } from "../domain/fwd-vol.ts";
import { computeAttributionSeries } from "../domain/attribution.ts";
import type { LifecycleSnapshot } from "../domain/attribution.ts";

export type GetCalendarLifecycleDeps = { readonly readJournal: ForReadingJournal };
export type ForRunningGetCalendarLifecycle = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<LifecycleSnapshot> | null, StorageError>>;

export function makeGetCalendarLifecycleUseCase(
  deps: GetCalendarLifecycleDeps,
): ForRunningGetCalendarLifecycle {
  return async (calendarId) => {
    const result = await deps.readJournal(calendarId);
    if (!result.ok) return err(result.error);
    if (result.value === null) return ok(null);
    const fwdVols = result.value.map(computeForwardVol);
    const attribution = computeAttributionSeries(result.value);
    return ok(result.value.map((row, i) => ({ ...row, ...fwdVols[i], ...attribution[i] })));
  };
}
```
Note: `getJournal.ts`'s `ok(null)` / `ok([])` / `err(...)` three-way Result contract (mirrored verbatim in the signature above) drives 404-vs-200-empty at the route layer — do not collapse `null` and `[]`.

**Error handling pattern:** propagate `err(result.error)` immediately on port failure (both analogs, line 1 of their body) — no try/catch needed, `Result` type replaces exceptions per typescript.md.

---

### `packages/core/src/journal/application/getCalendarLifecycle.test.ts` (test)

**Analog:** `packages/core/src/journal/application/getCalendarEventsWithRules.test.ts` — in-memory `ForReadingJournal` double, assert `ok(null)` on unknown id, `ok([])` passthrough, `err(StorageError)` propagation (mirrors RESEARCH.md's Test Map row for this file).

---

### `packages/contracts/src/journal.ts` (edit, additive)

**Analog:** existing file (full contents read above, 35 lines) — extend, do not modify `snapshotResponse`/`journalResponse`. Also mirrors `packages/contracts/src/picker.ts`'s tagged-pair Zod idiom (`fwdIv: z.number().nullable()` + `fwdIvGuard: z.enum(["ok","inverted"])`, lines 85-87).

**Pattern to add** (from RESEARCH.md, matches the existing file's own `.extend()`-free flat style but the additive approach is `snapshotResponse.extend({...})`):
```typescript
export const lifecycleSnapshotResponse = snapshotResponse.extend({
  isGap: z.boolean(),
  forwardVol: z.number().nullable(),
  forwardVolGuard: z.enum(["ok", "inverted"]),
  cumTheta: z.number().nullable(),
  cumVega: z.number().nullable(),
  cumDeltaGamma: z.number().nullable(),
  cumResidual: z.number().nullable(),
});
export const lifecycleResponse = z.object({ snapshots: z.array(lifecycleSnapshotResponse) });
export type LifecycleResponse = z.infer<typeof lifecycleResponse>;
```
Existing header comment convention to continue: `// MCP-02: ONE schema source for both GET /api/... and MCP ... tool.`

---

### `apps/server/src/adapters/http/journal-lifecycle.routes.ts` (new route)

**Analog:** `apps/server/src/adapters/http/journal-rules.routes.ts` (full file, 107 lines, read above).

**Imports pattern** (lines 1-8 of analog):
```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { setRuleTagsRequest, setRuleTagsResponse, getEventsWithRulesResponse } from "@morai/contracts";
import type {
  ForGettingCalendarById,
  ForRunningGetCalendarEventsWithRules,
  ForRunningSetRuleTags,
} from "@morai/core";
```
Swap for `lifecycleResponse` and `ForRunningGetCalendarLifecycle`.

**Auth pattern:** none inline — the route is JWT-gated by *mounting*, not by an in-file guard. See Pitfall 5 in RESEARCH.md and the Shared Patterns section below.

**Core request-response pattern** (analog lines 37-68, the GET handler — existence pre-check via `getCalendarById` then use-case call then contract-parse-and-respond):
```typescript
router.get("/journal/:calendarId/rules", async (c) => {
  const calendarId = c.req.param("calendarId");

  const calResult = await getCalendarById(calendarId);
  if (!calResult.ok) {
    return c.json({ error: "internal" }, 500);
  }
  if (calResult.value === null) {
    return c.json({ error: "not found" }, 404);
  }

  const result = await getEventsWithRules(calendarId);
  if (!result.ok) {
    return c.json({ error: "internal" }, 500);
  }

  return c.json(getEventsWithRulesResponse.parse({ /* map result.value */ }));
});
```
For `/lifecycle`, `getCalendarLifecycle`'s own `ok(null)` already distinguishes "unknown calendar" — so the separate `getCalendarById` existence pre-check may be unnecessary (unlike `getCalendarEventsWithRules`, which can't tell "unknown calendar" from "known calendar, 0 events"). Use `getJournal.routes.ts`'s existing route (same file family) to confirm whichever precedent it follows for `GET /api/journal/:calendarId` itself — that route is the closer shape match (single-port `ok(null)`→404 semantics) even though `journal-rules.routes.ts` is shown here for its two-port pre-check idiom precedent.

**Error handling pattern:** flat `{ error: "internal" }` / `{ error: "not found" }` JSON bodies, no stack traces leaked (T-03-16 threat mitigation referenced in RESEARCH.md Security Domain) — copy verbatim.

---

### `apps/server/src/main.ts` (edit, additive mount)

**Analog:** existing `journalRoutes`/`journalRulesRoutes` mount block, `apps/server/src/main.ts` lines 271-273 (per RESEARCH.md Pitfall 5 citation — read that exact range before writing the new mount line). Pattern: `.route("/", newRouterFactory(...))` chained into `apiRouter`, which is itself nested under `authReadGroup`. **Do not** mount the new router directly on `app` — that bypasses JWT gating (Pitfall 5, the phase's one named security risk).

---

### `apps/web/src/hooks/useLifecycle.ts` (hook, request-response polling)

**Analog:** `apps/web/src/hooks/useJournal.ts` (full file, 40 lines, read above).

**Full pattern to copy and adapt:**
```typescript
import { useQuery } from "@tanstack/react-query";
import { lifecycleResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export function useLifecycle(calendarId: string) {
  return useQuery({
    queryKey: ["lifecycle", calendarId],
    queryFn: async () => {
      const res = await apiFetch(`/api/journal/${calendarId}/lifecycle`);
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error(`GET /api/journal/${calendarId}/lifecycle failed: ${res.status}`);
      return lifecycleResponse.parse(await res.json());
    },
    enabled: !!calendarId,          // <-- FIX, see Shared Patterns below; useJournal.ts itself LACKS this
    refetchInterval: 60_000,
    staleTime: 50_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}
```

---

### `apps/web/src/components/LifecycleChart.tsx` (rewrite, transform/SVG render)

**Analog:** `apps/web/src/components/charts/PayoffChart.tsx` (1000 lines — read targeted sections only, do not load whole file).

**Imports pattern** (lines ~19-30 of analog):
```typescript
import { localPoint } from "@visx/event";
// plus LinePath / AreaClosed / LinearGradient / scaleLinear / curveMonotoneX per its own header comment
```

**Crosshair mapping pattern** (analog lines 324-342, exact technique UI-SPEC mandates reusing verbatim):
```typescript
const [crosshair, setCrosshair] = useState<{ /* x, renderedWidth, ...derived values */ }>();
// ...
const point = localPoint(svg, event);
// localPoint returns coords relative to the SVG element
const svgRect = svg.getBoundingClientRect();
const scaleX = SVG_W / svgRect.width;
const logicalX = point.x * scaleX;
```

**Tooltip positioning pattern** (analog lines ~862-868):
```typescript
// crosshair.x is in viewBox units [0, SVG_W]; the tooltip is an HTML element that
// tracks the crosshair line at any SVG render width.
(crosshair.x / SVG_W) * crosshair.renderedWidth + 14
```
UI-SPEC (Layout & Chart Geometry) locks the new viewBox as `0 0 840 700` with `preserveAspectRatio="xMinYMin meet"` (NOT `"none"` like PayoffChart's own viewBox) — this is the one deliberate deviation from the analog; everything else (the `localPoint`→`scaleX`→`logicalX` chain, the tooltip position formula) carries over unchanged.

**Gap-aware line rendering (new pattern for this phase, not in PayoffChart):**
```typescript
import { LinePath } from "@visx/shape";

<LinePath
  data={enrichedSeries}
  x={(d) => xScale(d.time)}
  y={(d) => yScale(d.attribution.cumTheta)}
  defined={(d) => !d.isGap}
  curve={curveMonotoneX}
  stroke={THETA_COLOR}
/>
```
For stacked-area fills (no visx first-class gap-aware area primitive), port the mockup's manual `areaSeg`/`flush()` segment-building approach from `mockups/journal-lifecycle-v3.html` lines 198-206, translated to TS — do not attempt to force `AreaClosed`'s own `defined` accessor to replicate flush semantics (RESEARCH.md confirms this gap is real, not an oversight).

**Color constants pattern:** UI-SPEC mandates copying `PayoffChart.tsx`'s own module-level hex-constant block style (`VIOLET`/`TEAL`/`CORAL`/`AMBER`/`BLUE`/`GRAY_MUTED`/`ZERO_LINE`/`GRID_LINE`) — locate that block (`rg -n "^const.*=.*#" apps/web/src/components/charts/PayoffChart.tsx`) and mirror its naming convention 1:1 against the 22-UI-SPEC.md Chart Series Color Map table (do not introduce hex values outside that table).

---

### `apps/web/src/components/LifecycleMasthead.tsx`, `PnlBridgeCard.tsx`, `EdgeCard.tsx`, `GreeksNowCard.tsx`, `BeatsCard.tsx` (new, presentational)

**Analog:** `apps/web/src/screens/Journal.tsx`'s current trade-header `Panel` block and `LifecycleSection` (lines 304-430 — `PreHistoryStub`, `LifecycleSection` function) for loading/empty-state idioms (`isPending` → `bg-line opacity-40` skeleton, `aria-busy="true"`), plus the `system/index.tsx` `Stat`/`MetricChip`/`Panel`/`PanelHeading`/`SectionLabel` molecules (reused unmodified per UI-SPEC Component Inventory) for the kv-row / stat-display idiom these five new cards are built from. No new visual pattern is being invented — UI-SPEC explicitly states `GreeksNowCard` "reuses `Stat`/kv row idiom already in `system/index.tsx`, not a new visual pattern."

---

## Shared Patterns

### Auth (JWT-gated mount, not in-file guard)
**Source:** `apps/server/src/main.ts` lines 271-273 (existing `journalRoutes`/`journalRulesRoutes` mount into `apiRouter` → `authReadGroup`).
**Apply to:** the new `journal-lifecycle.routes.ts` route and the new `get_journal_lifecycle` MCP tool registration. Never mount a new router directly on `app`.

### Result-based error propagation (no try/catch in core)
**Source:** `packages/core/src/journal/application/getJournal.ts` / `getCalendarEventsWithRules.ts` — `if (!result.ok) return err(result.error);` as the first line after every port call.
**Apply to:** `getCalendarLifecycle.ts`.

### Flat, non-leaking HTTP error bodies
**Source:** `apps/server/src/adapters/http/journal-rules.routes.ts` lines 43-92 — `{ error: "internal" }` (500), `{ error: "not found" }` (404), `{ error: message }` (400 validation) — never a raw stack trace or DB error string.
**Apply to:** the new `/lifecycle` route.

### react-query `enabled` guard (bug fix carried forward from Phase 20)
**Source:** memory `morai-phase20-executed-deployed` — `useRuleTags(calendarId)` (read in full above) is confirmed to be MISSING `enabled: !!calendarId` on its `useQuery` call, meaning it fires a request with an empty calendarId when no trade is selected. `useJournal.ts` has the same gap.
**Apply to:** the NEW `useLifecycle.ts` hook must include `enabled: !!calendarId` from the start (do not replicate the bug in new code); flag to the planner whether fixing `useJournal.ts`/`useRuleTags.ts` retroactively is in this phase's scope (RESEARCH.md/CONTEXT.md do not explicitly require the retroactive fix — treat as a one-line opportunistic fix only if a plan task already touches those files for another reason, per workflow.md's "minimal impact" rule; otherwise leave as a noted follow-up, not a drive-by fix in this phase).

### Tagged-guard result (never bare NaN)
**Source:** `packages/core/src/picker/domain/fwd-iv.ts` — `{ value: number; guard: "ok" } | { value: null; guard: "inverted" }` discriminated union.
**Apply to:** `fwd-vol.ts` (`ForwardVolResult`) and any gap-typed field in `attribution.ts`/the lifecycle contract (`isGap: boolean` instead of a bare NaN passthrough).

### Crosshair `localPoint` → viewBox-space mapping
**Source:** `apps/web/src/components/charts/PayoffChart.tsx` lines 324-342, 862-868.
**Apply to:** `LifecycleChart.tsx`'s new shared crosshair (spanning the full stacked-panel height per UI-SPEC) and the rail's crosshair-reactive `PnlBridgeCard`.

## No Analog Found

None — every file in this phase has at least a role-match analog; the closest thing to a gap is `attribution.ts`'s accumulation-over-array shape, which has no exact structural precedent in the codebase but is fully specified by RESEARCH.md's Code Examples section (treated as the primary spec for that one file, per the "role-match" entry above).

## Metadata

**Analog search scope:** `packages/core/src/picker/domain/`, `packages/core/src/journal/{domain,application}/`, `packages/contracts/src/`, `apps/server/src/adapters/{http,mcp}/`, `apps/server/src/main.ts`, `apps/web/src/{hooks,components,screens,lib}/`
**Files scanned:** ~30 (targeted reads + `rg` structural greps; no full-repo scan needed — RESEARCH.md's Sources section already pre-verified the same set of files this pass re-confirmed)
**Pattern extraction date:** 2026-07-05
