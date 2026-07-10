# Phase 30: Analyzer Pasted-Calendar Fix - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 10 (new + modified)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/src/lib/payoff-domain.ts` (NEW) | utility (pure transform) | transform | `apps/web/src/components/charts/PayoffChart.tsx` (`findZeroCrossings`, `computeYDomain`) | exact — same file already has a domain-fit sibling function (`computeYDomain`) to mirror |
| `apps/web/src/components/charts/PayoffChart.tsx` (MODIFY) | component | transform/render | itself (existing `buildXScale`/`buildXTicks`/`pinMarker`/`handlePointerMove`) | exact — parameterize in place |
| `apps/web/src/lib/scenario-engine.ts` (MODIFY) | utility (pure transform) | transform | itself (`buildSpotGrid`, `SPOT_GRID_MIN/MAX`) | exact |
| `apps/web/src/screens/Analyzer.tsx` (MODIFY) | component (screen) | request-response | itself (`handlePasteAnalyze`, `isPastedId` gates) | exact |
| `apps/web/src/screens/Overview.tsx` (MODIFY) | component (screen) | transform | itself (`<PayoffChart>` call site, combined book) | exact |
| `apps/web/src/hooks/useAnalyzeCalendar.ts` (NEW) | hook | request-response | `apps/web/src/hooks/usePicker.ts` (404/no-snapshot convention) | role-match — mutation hook, mirror `useRuleSettings`/`usePicker` shape |
| `apps/web/src/lib/tos-parser.ts` (MODIFY) | utility (pure transform) | transform | itself | exact |
| `packages/contracts/src/picker.ts` (MODIFY, additive) | contracts (Zod schema) | transform | `packages/contracts/src/settings.ts` (`setRuleOverridesRequest`/`Response`, Phase 29) | exact — additive-schema precedent |
| `packages/core/src/picker/application/analyzeAdHocCalendar.ts` (NEW) | service (use-case factory) | request-response | `packages/core/src/picker/application/computePickerSnapshot.ts` | exact — same bounded context, same port-consuming use-case-factory shape |
| `apps/server/src/adapters/http/picker.routes.ts` (MODIFY — add `POST /picker/analyze`) | route (HTTP adapter) | request-response | `apps/server/src/adapters/http/settings.routes.ts` (Phase 29, Zod-validated mutation route) | exact |
| `apps/server/src/adapters/mcp/tools.ts` (MODIFY — add `analyze_ad_hoc_calendar`) | route (MCP adapter) | request-response | `registerGetPickerCandidatesTool` in same file (lines ~569-600) | exact |
| `apps/web/src/components/picker/CandidateCard.tsx` (MODIFY) | component | render | itself (`pasted &&` branches, lines 161-226) | exact — parameterize in place on `candidate.breakdown.length > 0` |

## Pattern Assignments

### `apps/web/src/lib/payoff-domain.ts` (NEW utility, transform)

**Analog:** `apps/web/src/components/charts/PayoffChart.tsx` — `findZeroCrossings` (lines 178-196) and `computeYDomain` (lines 203+)

**Zero-crossing detection to reuse verbatim, don't reinvent** (`PayoffChart.tsx:178-196`):
```typescript
function findZeroCrossings(curve: ReadonlyArray<PayoffPoint>): ReadonlyArray<number> {
  const crossings: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const curr = curve[i];
    if (prev === undefined || curr === undefined) continue;
    const a = prev.pl;
    const b = curr.pl;
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      const x = prev.spot + (curr.spot - prev.spot) * (-a / (b - a));
      crossings.push(x);
    }
  }
  return crossings.filter(
    (x, i, arr) => arr.findIndex((y) => Math.abs(y - x) < 10) === i,
  );
}
```
**Pattern to copy:** a sibling pure function in the SAME two-pass shape as `computeYDomain` (combines multiple curves/anchors into one lo/hi range with a documented rationale comment) — write `computePayoffDomain(positions, spot, params)` as a new export next to these, not a new file's worth of parallel logic. Must export `findZeroCrossings` from `PayoffChart.tsx` (or move it into `payoff-domain.ts` and import back) since both the wide-pass BE-finding step and the chart itself need it — avoid a second breakeven detector.

**Core pattern — module constants → explicit params** (`PayoffChart.tsx:126-127, 143-145`):
```typescript
const X_MIN = 6900;
const X_MAX = 7900;
function buildXScale(innerWidth: number) {
  return scaleLinear({ domain: [X_MIN, X_MAX], range: [0, innerWidth] });
}
```
Target shape: `buildXScale(innerWidth: number, domain: { min: number; max: number })`.

---

### `apps/web/src/components/charts/PayoffChart.tsx` (MODIFY — 4 real consumers, not 3)

**Analog:** itself. Four call sites of `X_MIN`/`X_MAX` verified this session, ALL must take the new domain param:

1. `buildXScale` (lines 143-145) — domain param.
2. `buildXTicks(X_MIN, X_MAX)` (called ~line 401, defined ~235-244) — already takes explicit params, just pass the new domain instead of the module constants.
3. **`pinMarker`** (lines 159-171) — GEX wall edge-pinning; currently closes over `X_MAX`/`X_MIN` directly:
```typescript
function pinMarker(name: string, value: number, xScale: (v: number) => number): PinnedMarker {
  if (value > X_MAX) {
    return { x: xScale(X_MAX), label: `${name} ${value.toFixed(0)} →`, anchorEnd: true };
  }
  if (value < X_MIN) {
    return { x: xScale(X_MIN), label: `← ${name} ${value.toFixed(0)}`, anchorEnd: false };
  }
  return { x: xScale(value), label: name, anchorEnd: false };
}
```
Must become `pinMarker(name, value, xScale, domain: {min,max})`.
4. **`handlePointerMove`** crosshair math at line ~375 (the gap RESEARCH.md flags — not in CONTEXT.md's scout list): `X_MIN + (innerX/INNER_W)*(X_MAX-X_MIN)`. Fix by inverting through the SAME `xScale` object (visx `scaleLinear` has `.invert()`) rather than re-deriving the linear interpolation — one source of truth for the domain↔pixel mapping.

**Test-call-site consumer** (Pitfall 3): `PayoffChart.test.tsx` lines ~237 (`buildXScale(INNER_W)`), ~527/545 (`pinMarker`) — every one of these must pass an explicit `{min: 6900, max: 7900}` domain going forward instead of relying on the removed module-constant default, or the tests silently stop exercising the real (now dynamic) path.

---

### `apps/web/src/lib/scenario-engine.ts` (MODIFY — data grid, not just the chart scale)

**Analog:** itself — `SPOT_GRID_MIN`/`SPOT_GRID_MAX` (lines 137-139), `buildSpotGrid` (151-157), consumed at `payoffCurve` (~410) and `expirationCurve` (~435).

**Core pattern:** same shape as `PayoffChart.tsx`'s constants — module-level `MIN`/`MAX` baked into a grid builder. Must be threaded the SAME `{min,max}` object `payoff-domain.ts` computes, called from ONE site per screen (`Analyzer.tsx`, `Overview.tsx`), not recomputed independently in each file (Pitfall 1: fixing only the chart scale without the data grid still clips the curve).

---

### `apps/web/src/screens/Analyzer.tsx` / `Overview.tsx` (MODIFY — call sites)

**Analog:** itself. `Analyzer.tsx:585-593` (combinedPositions → repriceScenario → PayoffChart `:761-780`) and `Overview.tsx:880-1160` are the two real `<PayoffChart>` JSX consumers (verified via `rg -n "<PayoffChart"` — `LifecycleChart.tsx`/`CandidateCard.tsx`/`ScenarioStrip.tsx`/`TermStructureChart.tsx`/`PayoffControls.tsx` only import sibling types). Both must call `computePayoffDomain(positions, spot, params)` and pass the result into both `repriceScenario`'s grid override and `<PayoffChart domain={...}>`. `computePayoffDomain` must accept `ReadonlyArray<AnalyzerPosition>` (N positions) from the start — `Overview.tsx`'s combined book can span multiple strikes simultaneously (Pitfall 4), so do not design the signature around Analyzer's single-candidate mental model.

**Paste flow to modify** (`Analyzer.tsx:154-164` input, `:532-546` `handlePasteAnalyze`):
```typescript
// current: no fetch — parseTosOrder() then parsedCalendarToPickerCandidate() synchronously
```
Target: `handlePasteAnalyze` calls the new `useAnalyzeCalendar()` mutation hook with the parsed legs; on 404/no-snapshot falls back to the existing `parsedCalendarToPickerCandidate` builder (unchanged, becomes the fallback-only path). `isPastedId` gate checks (lines ~306, 409, 414, 422) replaced with `candidate.breakdown.length === 0` where the "not engine-scored" note is rendered.

---

### `apps/web/src/hooks/useAnalyzeCalendar.ts` (NEW hook, request-response)

**Analog:** `apps/web/src/hooks/usePicker.ts` — the 404/no-snapshot convention (`GET /picker/candidates` → `404 {error:"no-snapshot"}` treated as a distinct non-error `null` state, not an exception). Mirror that same non-error-404 handling for `POST /api/picker/analyze`. Mirror `useRepullChains`'s mutation shape (fire POST, track loading/error state) per RESEARCH.md's recommended structure note.

---

### `packages/contracts/src/picker.ts` (MODIFY, additive)

**Analog:** `packages/contracts/src/settings.ts`'s `setRuleOverridesRequest`/`setRuleOverridesResponse` (Phase 29 precedent — additive Zod schema, `.strict()` nesting, reused verbatim by both the HTTP route and the MCP tool per MCP-02 "one schema, two adapters"). Add `analyzeAdHocCalendarRequest` (leg strike/dte/iv/debit, finite-number + positive-integer constraints matching `pickerCandidateLeg`'s existing constraints — do NOT accept client-supplied `spot`, per RESEARCH.md's threat-mitigation note) and `analyzeAdHocCalendarResponse` (wraps existing `pickerCandidate` schema).

---

### `packages/core/src/picker/application/analyzeAdHocCalendar.ts` (NEW use-case factory)

**Analog:** `packages/core/src/picker/application/computePickerSnapshot.ts` (474-543) for the port-consumption shape; `packages/core/src/picker/domain/candidate-selection.ts:370-411` for the exact per-candidate `RawCandidate` construction to mirror for a SINGLE pasted leg pair:
```typescript
// Source: candidate-selection.ts:370-411 — mirror this shape, don't reinvent it
const gF = bsmGreeks(spot, K, tf / 365, ivF, r, q, "P");
const gB = bsmGreeks(spot, K, tb / 365, ivB, r, q, "P");
const theta = (gB.theta - gF.theta) * 100;
const vega = (gB.vega - gF.vega) * 100;
const netDelta = (gB.delta - gF.delta) * 100;
const slope = ((ivB - ivF) / (tb - tf)) * 365;
const frontEvents = legSpansEvents(fe, asOfIso, events);
const backEventsAll = legSpansEvents(be, asOfIso, events);
const backEvents = backEventsAll.filter((name) => !frontEvents.includes(name));
```
**Core pattern:** build ONE `RawCandidate`, then call `scoreCalendarCandidates`/`scoreOne` (`packages/core/src/picker/domain/scoring.ts`) UNCHANGED — never a second scoring formula (`scoring.ts`'s own precedent: `scoreEventCandidates` reuses `scoreCalendarCandidates`'s weights-ablation seam, not new formula code). Apply `resolvePickerRuleConfig` (`packages/core/src/picker/domain/rule-config.ts`) for Phase 29 rule-override parity. Read gate/sizing verbatim off the latest `PickerSnapshotRow` (`readPickerSnapshot()`) — NEVER call `resolveEntryGate`/`resolveSizingTier` per-request (T-28-10 anti-pattern, see `computePickerSnapshot.ts`'s own gate-computation call site as the ONLY legitimate caller).

**Ports needed (all already exist — zero new ports/twins per architecture rule 8):** `readPickerSnapshot`, `readGexContext`, `readEconomicEvents`, `readDailySpotCloses`, `readPickerSlopeHistory`, `readRuleOverrides` — all declared in `packages/core/src/picker/application/ports.ts:230-303`, consumed today by `computePickerSnapshot.ts:474-543`.

**Error handling pattern:** `Result<T,E>` return, same as every other use-case in this bounded context — see `computePickerSnapshot.ts`'s own `Result` wiring for the idiom.

---

### `apps/server/src/adapters/http/picker.routes.ts` (MODIFY — add `POST /picker/analyze`)

**Analog:** `apps/server/src/adapters/http/settings.routes.ts` (Phase 29's `PUT /settings/rules` — the newest Zod-validated mutation-route precedent in the repo).

**Full pattern to copy** (`settings.routes.ts:41-48`):
```typescript
router.put("/settings/rules", zValidator("json", setRuleOverridesRequest), async (c) => {
  const body = c.req.valid("json");
  const result = await setRuleOverrides(toOverridesPatch(body));
  if (!result.ok) {
    return c.json({ error: "internal" }, 500);
  }
  return c.json(setRuleOverridesResponse.parse(result.value));
});
```
Target: `router.post("/picker/analyze", zValidator("json", analyzeAdHocCalendarRequest), async (c) => { ... })`. Zero business logic in the route body — Zod-parse → call use-case → map `Result` → parse through `analyzeAdHocCalendarResponse` → respond.

**404/no-snapshot convention to mirror** (`picker.routes.ts:37-40`, existing `GET /picker/candidates`):
```typescript
if (result.value === null) {
  return c.json({ error: "no-snapshot" }, 404);
}
```
RESEARCH.md's Open Question 2 recommends mirroring this exact convention for the new endpoint rather than a `200 {scored:false}` shape, for consistency with `usePicker()`'s established handling.

**Mount site:** same authenticated `apiRouter`/Bearer-token group as `/api/picker/candidates` (`main.ts` composition-root precedent, lines ~280-350) — no new unauthenticated surface (ASVS V2).

---

### `apps/server/src/adapters/mcp/tools.ts` (MODIFY — add `analyze_ad_hoc_calendar` tool)

**Analog:** `registerGetPickerCandidatesTool` in the same file (~lines 569-600):
```typescript
export function registerGetPickerCandidatesTool(
  server: McpServer,
  getPicker: ForRunningGetPicker,
): void {
  server.registerTool(
    "get_picker_candidates",
    {
      title: "Get Picker Candidates",
      description: "...",
      inputSchema: {},
    },
    async () => {
      const result = await getPicker();
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      // ... parse through pickerSnapshotResponse, return content
    },
  );
}
```
**Core pattern to copy:** `registerAnalyzeAdHocCalendarTool(server, analyzeAdHocCalendar)` — `inputSchema` MUST be the SAME Zod schema as `analyzeAdHocCalendarRequest` used by the HTTP route (MCP-02: "one schema, two adapters" — a one-sided field rename fails `bun run typecheck`). Wire in `main.ts` alongside the existing `get_picker_candidates` registration (`main.ts:296`, `:516-531`).

---

### `apps/web/src/components/picker/CandidateCard.tsx` (MODIFY — Pitfall 8)

**Analog:** itself. Current `pasted &&` branches (lines 161-183 header pill, 195-226 subline) unconditionally hide score/theta/vega/events whenever `pasted === true`, regardless of whether `candidate.breakdown` is populated:
```typescript
{pasted ? (
  <span className="... PASTED pill ...">PASTED</span>
) : (
  <span className="... text-violet">{candidate.score}</span>
)}
```
The factor bars below (lines 228-252) already render unconditionally from `candidate.breakdown` — no change needed there. **Required change:** branch on `candidate.breakdown.length > 0` (not the raw `pasted` boolean) for the score/subline display, while KEEPING the "PASTED" identification badge for provenance (RESEARCH.md's Assumption A4/recommendation). Do not touch the breakdown-bars block.

---

## Shared Patterns

### Zod-validated mutation route (HTTP + MCP, same schema)
**Source:** `apps/server/src/adapters/http/settings.routes.ts` (route) + `registerGetPickerCandidatesTool` in `apps/server/src/adapters/mcp/tools.ts` (MCP)
**Apply to:** `POST /picker/analyze` route and the new `analyze_ad_hoc_calendar` MCP tool — one `analyzeAdHocCalendarRequest`/`Response` Zod pair in `packages/contracts/src/picker.ts`, consumed verbatim by both adapters (MCP-02 discipline).

### No-recompute / read-latest-snapshot discipline (T-19-17 / T-28-10)
**Source:** `apps/server/src/adapters/http/picker.routes.ts:29-45` (never recompute the snapshot on read) and `computePickerSnapshot.ts` (gate computed ONCE per cycle, cohort-level)
**Apply to:** `analyzeAdHocCalendar` use-case — read `readPickerSnapshot().gate`/`.sizing` verbatim, never call `resolveEntryGate` per-request.

### Result<T,E> + flat error mapping
**Source:** `settings.routes.ts` / `picker.routes.ts` — `{error:"internal"}` (500) and `{error:"no-snapshot"}` (404), never DB internals leaked.
**Apply to:** the new `POST /picker/analyze` route and MCP tool error paths.

### Module-constant → explicit-param domain threading
**Source:** `PayoffChart.tsx` (chart) + `scenario-engine.ts` (data grid) — currently two independent hardcoded `6900`/`7900` pairs.
**Apply to:** both files must receive the SAME `{min,max}` object from one `computePayoffDomain` call per screen (`Analyzer.tsx`, `Overview.tsx`) — never recompute the domain twice or let one file drift from the other (Pitfall 1).

## No Analog Found

None — every file in scope has a direct, same-bounded-context or same-file analog already in the codebase (RESEARCH.md's own "Don't Hand-Roll" table confirms: scoring, gate, sizing, breakeven-finding, event-span membership, BSM greeks all already exist as pure, tested functions — this phase is wiring, not new math).

## Metadata

**Analog search scope:** `apps/web/src/components/charts/`, `apps/web/src/lib/`, `apps/web/src/screens/`, `apps/web/src/hooks/`, `apps/web/src/components/picker/`, `packages/core/src/picker/`, `packages/contracts/src/`, `apps/server/src/adapters/http/`, `apps/server/src/adapters/mcp/`
**Files scanned/read this session:** `PayoffChart.tsx`, `settings.routes.ts`, `picker.routes.ts`, `tools.ts` (MCP), `CandidateCard.tsx`, plus every file cited in `30-RESEARCH.md`'s Sources section (already read by the researcher this session)
**Pattern extraction date:** 2026-07-10
