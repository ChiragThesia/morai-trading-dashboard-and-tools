# Phase 32: Rule Settings Modal v2 - Research

**Researched:** 2026-07-10
**Domain:** Internal codebase — settings UI explainers + a server-side dry-run preview endpoint over the existing picker/exits/regime engines
**Confidence:** HIGH

## Summary

This phase touches zero new libraries and zero new external services — it is a pure
internal-codebase composition exercise. The codebase already has every piece needed: the
Phase-30 ad-hoc dry-run pattern (`analyzeAdHocCalendar.ts`) proves bounded, never-persisting,
never-chain-reading compute is a solved problem here; the picker/exits/regime engines already
separate "pure resolve/score function" from "I/O read," so a preview is almost always "call the
same pure function with a staged config object" rather than new business logic; and the web app
already imports `@morai/core` directly (contrary to a stale CLAUDE.md line — see Finding 3
below), so no server-side proxy is needed for pure band functions.

The single most important finding is that **not all 20 knobs are equally previewable**. Nine of
them (the picker score weights) are a pure re-weighting of numbers already stored on every
candidate — literally free, no I/O. Two (`debitIdealMin/Max`) need one more stored field
(`debit`) that's already on every candidate — still free. Four (`vixLadder` boundaries) and one
(`maxOpenCalendars`) drive the entry gate/sizing, which the codebase already resolves from a
handful of scalars stored directly on the snapshot's `gate` object — cheap, no chain read. But
six knobs (`deltaBandMin/Max`, `frontDteMin/Max`, `backDteMinGap/Max`) change *which candidates
exist in the universe*, not just their scores — and the stored snapshot only contains the
already-selected top-N candidates, never the full band-scanned population or the drop counts by
band. These six **cannot be honestly previewed from stored data alone**; the CONTEXT-mandated
"never re-read the chain" constraint means the only honest options are (a) an explicit
"affects picker universe on next compute cycle" note, or (b) a scope decision to add a bounded
chain re-read specifically for these six (a bigger, likely out-of-budget, addition). This
research recommends (a).

Exit preview is cheaper than CONTEXT's own risk framing suggests: only TAKE/STOP rung values are
overridable (verified against the contract — no other exit knob is editable), `evaluateExit` is
already a pure function taking config as its 4th argument, and the server already composes every
read port `computeExitAdvice`/`getExitAdvice` need (`readHeldPositions`,
`readLatestSnapshotPerOpenCalendar`, `readLatestVerdictsPerCalendar`, `readEconomicEvents`) in
`apps/server/src/main.ts` today. A live re-evaluation of every open position's TAKE/STOP verdict
against staged rungs is proportionate and cheap (bounded by open-calendar count, already
single-digit in this codebase's live book) — **not** disproportionate, contrary to CONTEXT's
hedge. Recommend building it, not falling back to the static note.

**Primary recommendation:** Build one `POST /api/settings/rules/preview` endpoint (+ MCP twin)
that branches per staged group: picker weights/debitFit/vixLadder/maxOpenCalendars/sizingContracts
re-score from the stored snapshot's own fields (cheap); picker band/DTE knobs get an honest
"affects next compute cycle" note (no chain read); exits re-run `evaluateExit` per open position
with staged TAKE/STOP rungs (cheap, ports already composed server-side); regime re-bands current
indicator values client-side by importing `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`/
`bandHyOas` directly from `@morai/core` (already an allowed import per eslint boundaries — no
new server round-trip needed). Explainer copy lives in one typed registry
(`packages/contracts/src/rule-explainers.ts` or a new `rule-explainers.ts` colocated with
`rule-settings.ts`) keyed by the same dotted knob paths `RuleSettingsModal.tsx`'s existing
`flattenNumeric`/`lookupLeaf` machinery already walks.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Knob explainer copy (registry) | API / Backend (contracts pkg) | Web (renders it) | Single source of truth per rule 9/hexagon law; contracts is importable by both web and core-adjacent adapters, matching the existing `rule-settings.ts` precedent |
| Picker score-only preview (weights, debitFit) | API / Backend (core use-case) | — | Reuses `resolvePickerRuleConfig` + stored candidate fields; must live behind a port per hexagon law, never duplicated in the browser |
| Picker gate/sizing preview (vixLadder, maxOpenCalendars) | API / Backend (core use-case) | — | Needs a fresh `readOpenCalendars`/`readRecentClosedCalendars` read (cheap DB read) plus `resolveEntryGate`/`resolveSizingTier`, both core-only pure functions |
| Picker universe-membership knobs (deltaBand/frontDte/backDteGap) | API / Backend (honest-note only) | — | Cannot be honestly scored from stored data; a real preview needs `readChainForPicker`, explicitly excluded by CONTEXT's "never recompute the chain" precedent (T-19-17/T-28-10 lineage) |
| Exit TAKE/STOP preview | API / Backend (core use-case) | — | `evaluateExit` is pure and already takes `config`; ports already composed in `apps/server/src/main.ts` |
| Regime band preview | Browser / Client | API / Backend (fallback) | `bandVixTermStructure` etc. are pure, zero-import functions; apps/web already depends on `@morai/core` (Phase 17-01 precedent) — no round-trip needed for a value already on screen |
| Modal explainer rendering (captions/popovers) | Browser / Client | — | Pure UI; reuses the existing `components/ui/tooltip.tsx` primitive |

## Package Legitimacy Audit

Not applicable — this phase adds zero new npm dependencies. Every primitive needed (Tooltip,
Dialog, Button, Panel) already exists in `apps/web/src/components/`; every compute primitive
needed (`resolvePickerRuleConfig`, `resolveEntryGate`, `resolveSizingTier`, `evaluateExit`,
`bandVixTermStructure` family) already exists in `packages/core`.

## Standard Stack

No new libraries. Existing stack reused: Hono (+zValidator) for the route, Zod for the preview
request/response contract, `@tanstack/react-query` for the mutation (mirrors
`useAnalyzeCalendar.ts`'s non-optimistic pattern), `@base-ui/react` Tooltip (already vendored at
`apps/web/src/components/ui/tooltip.tsx`, currently unused for info-icons — this phase is its
first consumer).

**Installation:** none required.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────── apps/web ────────────────────────────────┐
│  RuleSettingsModal.tsx                                                   │
│    ├─ per-knob caption/popover  ← rule-explainers.ts registry (contracts)│
│    ├─ staged draft state (existing flatten/unflatten machinery)          │
│    ├─ "Preview" button (explicit click, no keystroke spam — CONTEXT)     │
│    │     │                                                                │
│    │     ├─ regime group: bandVixTermStructure/bandVvix/... ─────────────┼─┐
│    │     │   (pure fns from @morai/core, current values already on screen)│ │ client-side,
│    │     │                                                                │ │ no request
│    │     └─ picker/exits groups: POST /api/settings/rules/preview ───────┼─┼──┐
│    └─ Save (unchanged v1 PUT flow)                                       │ │  │
└────────────────────────────────────────────────────────────────────────┘ │  │
                                                                              │  │
┌──────────────────────────── apps/server ───────────────────────────────┐  │  │
│  settings.routes.ts: POST /settings/rules/preview  ◄───────────────────┼──┼──┘
│    zValidator(previewRuleOverridesRequest) → previewRuleOverrides() ────┤  │
│                          │                                              │  │
│    ┌─────────────────────┼──────────────────────────────────────┐      │  │
│    │ picker branch        │ exits branch                          │      │  │
│    │ readPickerSnapshot() │ readHeldPositions()                   │      │  │
│    │  → re-score stored   │ readLatestSnapshotPerOpenCalendar()   │      │  │
│    │    candidates with   │ readLatestVerdictsPerCalendar()       │      │  │
│    │    staged weights/   │ readEconomicEvents()                  │      │  │
│    │    debitFit (pure)   │  → evaluateExit(...staged config) per │      │  │
│    │  OR                  │    open position (pure)               │      │  │
│    │  readOpenCalendars() │                                        │      │  │
│    │  readRecentClosed…() │                                        │      │  │
│    │   → resolveEntryGate/│                                        │      │  │
│    │     resolveSizingTier│                                        │      │  │
│    │    with staged ladder│                                        │      │  │
│    │  OR (band/DTE knobs) │                                        │      │  │
│    │   → honest note only,│                                        │      │  │
│    │     no chain read    │                                        │      │  │
│    └───────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/contracts/src/
├── rule-settings.ts        # existing — unchanged
├── rule-explainers.ts      # NEW — typed registry, keyed by dotted knob path
└── rule-preview.ts         # NEW — previewRuleOverridesRequest/Response Zod schemas

packages/core/src/
├── picker/application/
│   └── previewPickerRuleOverrides.ts   # NEW — score-only + gate/sizing preview branches
├── exits/application/
│   └── previewExitRuleOverrides.ts     # NEW — evaluateExit re-run per open position
└── settings/application/
    └── ports.ts             # extend with ForPreviewingXxx types if a single combined
                              #   preview use-case is preferred (planner's call)

apps/server/src/adapters/
├── http/settings.routes.ts # extend — POST /settings/rules/preview
└── mcp/tools.ts             # extend — registerPreviewRuleOverridesTool

apps/web/src/
├── screens/RuleSettingsModal.tsx   # extend — captions/popovers + Preview button + delta table
└── hooks/useRuleSettingsPreview.ts # NEW — mirrors useAnalyzeCalendar.ts's mutation shape
```

### Pattern 1: Score-only re-weighting (zero I/O beyond the stored snapshot)

**What:** For weights + debitFit knobs, the stored `PickerCandidateDomain.breakdown` array
already carries every criterion's `rawValue`/`contribution`. A new score is
`clamp(round(sum(weight * contribution) / 100))` — no recomputation of `rawValue` needed for the
9 weight knobs. `debitFit`'s `contribution` DOES need recomputing (it depends on the staged
`debitIdealMin/Max` band, not just its weight) — but its only input, `debit`, is already stored
on `PickerCandidateDomain.debit`.

**When to use:** Staged `picker.weights.*`, `picker.debitIdealMin`, `picker.debitIdealMax`.

**Example:**
```typescript
// Source: packages/core/src/picker/domain/scoring.ts scoreOne() (existing formula, verbatim)
// rawScore = sum(weight * contribution) / 100, then clamp(round(...))
// debitFrac must be recomputed via debitFitFraction(candidate.debit, stagedBand) — rules.ts
// export — everything else in the breakdown is reused as-is (rawValue/contribution unchanged).
```

### Pattern 2: Gate/sizing preview from stored gate scalars, not a fresh macro read

**What:** `PickerGate` already stores `{vix, vix3m, ratio, asOf}` verbatim. Reconstruct a
2-row `MacroSeriesRow[]` (`VIXCLS`=vix, `VXVCLS`=vix3m, both dated `asOf`) and call
`resolveEntryGate({rows, nowIso, maxOpenBrake, cooldownBrake, previousState, vixLadder: staged})`.
`extractVixPair` will recompute `ratio = vix/vix3m`, which reproduces the stored ratio exactly
(same division). `maxOpenBrake`/`cooldownBrake` need one fresh cheap read each
(`readOpenCalendars`, `readRecentClosedCalendars` — both already-existing ports, bounded to the
current book size, not the option chain). `resolveSizingTier(gate.vix, {ladder: staged, contracts: staged})`
is a pure lookup needing nothing else.

**When to use:** Staged `picker.vixLadder.*`, `picker.maxOpenCalendars`, `picker.sizingContracts.*`.

**Example:**
```typescript
// Source: packages/core/src/picker/application/computePickerSnapshot.ts toEntryGateState()
// (currently module-private — must be exported for preview reuse, or duplicated;
// exporting is the smaller diff and matches the 30-04 precedent of exporting
// isPickerRuleOverrides/applyGatePenalty/toPickerCandidateDomain specifically for cross-use-case reuse).
```

### Pattern 3: Exit TAKE/STOP preview — full evaluateExit re-run, not a shortcut

**What:** `evaluateExit(position, context, previousVerdict, config)` is already pure and takes
`config` as an explicit 4th parameter (`resolveExitRuleConfig(overrides)` builds it). The exact
same 4 reads `computeExitAdvice.ts` and `getExitAdvice.ts` already perform
(`readHeldPositions`, `readLatestSnapshotPerOpenCalendar`, `readLatestVerdictsPerCalendar`,
`readEconomicEvents`) are already composed in `apps/server/src/main.ts` (both use-cases are
wired server-side, not worker-only). A preview loops over open positions exactly like
`computeExitAdvice.ts` does, but with `config = resolveExitRuleConfig(stagedTakeStopOverrides)`
and **never persists**.

**When to use:** Staged `exits.take.*`, `exits.stop.*` (the only two overridable exit groups —
GAMMA/TERM/EVT/ROLL thresholds have no override fields in the contract at all).

**Example:**
```typescript
// Source: packages/core/src/exits/application/computeExitAdvice.ts (read order + loop body)
// and packages/core/src/exits/domain/evaluate-exit.ts evaluateExit() signature.
// Preview differs from computeExitAdvice only in: (1) config comes from staged overrides,
// not the persisted overrides row, (2) no persistExitVerdict call, (3) diff old vs new verdict.
```

### Pattern 4: Regime band preview — client-side pure function call, not a server round-trip

**What:** `bandVixTermStructure(ratio, thresholds?)`, `bandVvix(level, thresholds?)`,
`bandVix9dRatio(ratio, thresholds?)`, `bandHyOas(percent, thresholds?)` are all pure,
zero-import functions in `packages/core/src/analytics/domain/regime.ts`, each already accepting
an optional `{warn, crisis}` override. `apps/web` already lists `@morai/core` as a dependency
(`apps/web/package.json`) and already imports from it directly (`invertIv`, Phase 17-01 — see
Finding 3). The current indicator values are already rendered on the Overview regime board, so
importing these 4 functions client-side and calling them with the staged thresholds needs zero
new endpoint, zero duplicated band logic, and zero contracts/core export gymnastics.

**When to use:** Staged `regime.*Warn`/`regime.*Crisis` (all 8 fields).

### Anti-Patterns to Avoid

- **Re-implementing `debitFitFraction`/`scoreOne`'s weighted-sum formula in the route or web
  layer:** the formula already exists in `rules.ts`/`scoring.ts` — a second copy is exactly the
  "hand-copies rot" failure CONTEXT explicitly calls out for the regime case, and the same risk
  applies to picker scoring.
- **Silently widening the preview to include a chain re-read for band/DTE knobs "since it's
  right there":** CONTEXT is explicit that the picker preview pattern is Phase-30's
  never-recompute-the-chain dry-run; a chain read is a different, larger feature (full
  what-if re-selection) that changes the phase's compute-cost profile and wasn't scoped or
  research-validated here.
- **Building a generic "diff engine" over arbitrary nested JSON:** the six knob groups have six
  genuinely different preview mechanics (pure re-score, gate/sizing recompute, universe note,
  exit re-eval, client-side band, none). A one-size-fits-all diff abstraction would hide these
  real differences and violate the "no unrequested abstraction" default for this codebase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Popover/info-icon UI | A custom hover/focus popover component | `apps/web/src/components/ui/tooltip.tsx` (`@base-ui/react/tooltip`, already vendored, currently unused) | Already installed, already styled to the app's design tokens (see `cn`/Tailwind classes in the file); zero new dependency |
| Weighted score recompute | A second scoring formula in the route/preview layer | `scoreOne`'s weighted-sum reduction (`sum(weight*contribution)/100`, `scoring.ts` line ~231) | Byte-parity risk — CONTEXT explicitly requires the preview and the real engine never diverge |
| Gate/sizing recompute | A hand-rolled VIX-tier lookup in the preview route | `resolveEntryGate` + `resolveSizingTier` (both already accept override params) | Both already support the exact override shape the contract stores; this is precisely what 29-04/29-10 built them for |
| Regime banding | A duplicated warn/crisis if-ladder in the web layer | `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`/`bandHyOas` imported from `@morai/core` | Pure, zero-import, already parameterized with an optional threshold override — the exact CONTEXT-mandated "tiny pure shared function via contracts/core export" |

**Key insight:** Every preview mechanic this phase needs is already a named, exported (or
one-line-away-from-exported), pure function somewhere in `packages/core`. The entire phase is
plumbing + a copy registry, not new domain logic — which is exactly the shape of every prior
Phase-29/30 runtime-rule-settings plan.

## Common Pitfalls

### Pitfall 1: Assuming "re-score the snapshot" covers all 12 picker knobs
**What goes wrong:** A planner reads CONTEXT's "re-score the latest stored snapshot cohort with
staged overrides" line and builds one preview code path for all `picker.*` fields, including
`deltaBandMin/Max`/`frontDteMin/Max`/`backDteMinGap/Max`.
**Why it happens:** The stored `PickerSnapshot.candidates` array looks complete, but it is only
the top-N *survivors* of `selectCandidates` at the CURRENT band — candidates that a widened or
narrowed band would add or drop were never computed or stored (and `gateDrops` only counts
`liquidity`/`netTheta`/`termInverted`/`eventBlackout` drops, not band/DTE-window exclusions).
**How to avoid:** Branch explicitly: 9 weights + `debitIdealMin/Max` + `vixLadder.*` +
`maxOpenCalendars` + `sizingContracts.*` = score/gate/sizing re-derivable from stored data.
`deltaBandMin/Max`/`frontDteMin/Max`/`backDteMinGap/Max` = universe-membership, honest-note only.
**Warning signs:** A preview response that claims to show "candidates that would enter/leave the
universe" for a band-width change but is actually just re-scoring the same 8 stored candidates —
this is a silently wrong preview, worse than no preview.

### Pitfall 2: Trusting the stale CLAUDE.md "web imports contracts only" line
**What goes wrong:** A planner defers regime-band preview to the server "because web can only
import contracts" and builds an unneeded round-trip endpoint.
**Why it happens:** `CLAUDE.md`'s architecture table literally says `apps/web/ → contracts only`,
labeled "(deferred)". This is stale — web has shipped and depends on `@morai/core` since
Phase 17-01 (`invertIv` import), and `eslint.config.js`'s `boundaries/dependencies` rule
explicitly allows `{ from: "apps", allow: [..., "core", ...] }` with **no carve-out narrowing it
to a specific file** (contrast with the `core-rule-tags` narrow carve-out for `contracts`, which
IS scoped to one file). `apps/web/package.json` lists `@morai/core` as a direct dependency today.
**How to avoid:** Trust the eslint config + package.json + Phase 17-01 precedent over the stale
CLAUDE.md prose; import the regime band functions directly into the web app. Flag the CLAUDE.md
line as due for a docs-hygiene fix (out of this phase's scope, but worth a one-line follow-up
note) per `workflow.md`'s "code that contradicts docs is a bug in one of them — reconcile."
**Warning signs:** A code-review comment citing "web imports contracts only" as a blocker for a
`@morai/core` import that already has three other consumers in `apps/web/src`.

### Pitfall 3: Building the exit preview as a "static note" without checking if a live one is cheap
**What goes wrong:** CONTEXT hedges "if disproportionate, ship the honest static note" — a
planner reads that as permission to skip the live preview by default, when the actual
proportionality check (only 2 overridable groups, pure evaluator, already-composed ports, open
calendars is a single-digit count) comes out cheap.
**How to avoid:** Do the proportionality check explicitly (this research already did it — see
Pattern 3) before defaulting to the static note. The static note is the fallback for when the
check fails, not the default.
**Warning signs:** A plan that ships the static note without a line explaining why the live
re-eval was rejected.

### Pitfall 4: The vacuous-test lesson (recurred 5+ times in this project's history per STATE.md)
**What goes wrong:** An "explainer registry completeness" test is written against a hand-copied
list of knob paths instead of importing the real `ruleOverrides`/`ruleConfig` Zod shape and
deriving the path list from it — the test passes even after a knob is silently missing an
explainer entry, because both the test's expected list and the registry drifted together.
**How to avoid:** Derive the completeness check FROM `pickerConfig`/`exitsConfig`/`regimeConfig`
(the real Zod shapes in `rule-settings.ts`) via the SAME `flattenNumeric`-style walk
`RuleSettingsModal.tsx` already uses to render rows — not a separately maintained literal array.
**Warning signs:** A test file that defines its own `const ALL_KNOB_PATHS = [...]` literal
instead of deriving it from the schema or from `flattenNumeric(sampleConfig)`.

### Pitfall 5: Preview endpoint must never leak into a Save side-effect
**What goes wrong:** The preview reuses `computeExitAdvice`'s loop body so closely that a
persist call gets copy-pasted along with it.
**How to avoid:** The preview use-case must have zero `persistExitVerdict`/`persistPickerSnapshot`
dependency in its type signature — not just "unused at runtime," but structurally absent
(matches `analyzeAdHocCalendar.ts`'s T-19-17 precedent: "this use-case never persists" is
enforced by the deps type never including a persist port).

## Code Examples

### Score-only re-weighting (Pattern 1)
```typescript
// Source: packages/core/src/picker/domain/scoring.ts (existing, verbatim reference)
const rawScore =
  wSlope * slopeFraction + wFwdEdge * fwdEdgeFraction + wGexFit * gexFit +
  wEvent * eventFraction + wBeVsEm * beVsEmFraction + wDeltaNeutral * deltaFraction +
  wThetaVega * thetaVegaFrac + wVrp * vrpFrac + wDebitFit * debitFrac;
const score = Math.min(100, Math.max(0, Math.round(rawScore)));
// Preview equivalent operates on the STORED breakdown's contribution values directly:
// newScore = clamp(round(sum(stagedWeight[c.criterion] * c.contribution) / 100))
// — no candidate.frontLeg/backLeg/spot access needed for the 9 weight knobs.
```

### Gate/sizing reconstruction from stored scalars (Pattern 2)
```typescript
// Source: packages/core/src/picker/domain/entry-gate.ts extractVixPair + resolveEntryGate
const rows: MacroSeriesRow[] = [
  { seriesId: "VIXCLS", date: snapshot.gate.asOf ?? "", value: snapshot.gate.vix ?? 0 },
  { seriesId: "VXVCLS", date: snapshot.gate.asOf ?? "", value: snapshot.gate.vix3m ?? 0 },
];
// resolveEntryGate({ rows, nowIso, maxOpenBrake, cooldownBrake, previousState: null, vixLadder: staged })
```

### Exit preview loop shape (Pattern 3)
```typescript
// Source: packages/core/src/exits/application/computeExitAdvice.ts (read order, adapted)
// for (const position of openPositions) {
//   const snapshot = snapshotByCalendar.get(position.calendarId);
//   if (snapshot === undefined) continue;
//   const context: MarketContext = { ...same fields computeExitAdvice builds..., rollChain: { candidates: [] } };
//   const staged = evaluateExit(position, context, previousVerdict, resolveExitRuleConfig(stagedOverrides));
//   const current = evaluateExit(position, context, previousVerdict, resolveExitRuleConfig(currentOverrides));
//   // diff staged.verdict/rung vs current.verdict/rung
// }
```

## State of the Art

Not applicable — no external library/ecosystem shift involved. The only "state of the art" shift
relevant here is internal: Phase 30 (2026-07-09) established the "bounded dry-run, byte-parity
with the real engine, never persists" pattern this phase extends from picker-only to
picker+exits+regime.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A dedicated `packages/contracts/src/rule-explainers.ts` file (vs. inlining the registry in the web app) is the right location for the explainer copy | Recommended Project Structure | Low — if wrong, the planner just colocates it in `apps/web/src/lib/` instead; either satisfies "one typed registry," and moving it later is a mechanical file move, not a design change |
| A2 | Open-calendar count stays small enough (single digits, per `MAX_OPEN_CALENDARS = 6` and the codebase's live book) that a full per-position `evaluateExit` re-run twice (staged + current) per preview click is cheap | Pattern 3 / Pitfall 3 | Low — `MAX_OPEN_CALENDARS` is itself a hard brake at 6; even a generous multiple of that is trivial CPU work, no measured risk found |

**If this table is empty:** N/A — 2 low-risk assumptions logged above, both structural/scale
judgments rather than domain-fact claims; neither needs a locked user decision to proceed.

## Open Questions

1. **Should the preview endpoint be one combined use-case or three (picker/exits/regime)?**
   - What we know: the three groups have entirely disjoint I/O and compute paths (Pattern
     1/2 vs Pattern 3 vs Pattern 4-client-side); `settings.routes.ts` already routes a single
     PUT across all three groups via one `ruleOverrides` body.
   - What's unclear: whether the wire contract should accept a partial `RuleOverrides`-shaped
     body and branch internally (mirrors the existing PUT), or three separate endpoints.
   - Recommendation: one endpoint (`POST /api/settings/rules/preview`) accepting the same
     `ruleOverrides`-shaped partial body as PUT, branching internally per group — matches the
     existing PUT's shape exactly, one contract schema, one MCP tool. Regime never needs a
     server round-trip at all (Pattern 4), so the route only actually branches picker/exits.

2. **Does the picker preview response need per-candidate old-vs-new score deltas, or just
   aggregate counts (in/out of top-N, gate before/after)?**
   - What we know: CONTEXT specifies "candidate count in/out, top-N score changes, gate state
     change if any" — this reads as both aggregate AND per-candidate top-movers.
   - What's unclear: exact wire shape (left to Claude's Discretion per CONTEXT: "Delta
     presentation").
   - Recommendation: return the full re-scored candidate list (same shape as
     `PickerCandidateDomain`, minus fields that can't change) plus old score inline per
     candidate — cheapest correct shape, `RuleSettingsModal.tsx`/a new delta table computes the
     diff view client-side. Avoids inventing a second wire shape.

## Environment Availability

Not applicable — no external tool/service/runtime dependency. This phase is pure in-repo
TypeScript across existing packages (`contracts`, `core`, `server`, `web`), using the existing
Bun/Vitest toolchain already installed and verified working in this repo.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.8 (root `package.json`) |
| Config file | per-package `vitest.config.ts` (no root config found — each package/app owns its own) |
| Quick run command | `bun run test -- <path/to/file>.test.ts` |
| Full suite command | `bun run test` (root `vitest run`, workspace-wide) |

### Phase Requirements → Test Map

This phase has no `REQUIREMENTS.md` IDs yet assigned (CONTEXT.md is the sole spec source); the
map below is keyed by the CONTEXT.md decision areas instead.

| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|--------------------|--------------|
| Weight-only re-score matches `scoreOne`'s formula exactly (byte-parity, empty staged == current) | unit + fast-check property | `bun run test -- packages/core/src/picker/application/previewPickerRuleOverrides.test.ts` | ❌ Wave 0 |
| debitFit re-score uses `debitFitFraction` (not a re-derived copy) | unit | same file as above | ❌ Wave 0 |
| Gate/sizing preview reproduces `resolveEntryGate`/`resolveSizingTier` given the stored gate scalars, staged ladder override empty == current gate | unit | same file as above | ❌ Wave 0 |
| Band/DTE-window knobs return the honest "affects next cycle" note, never a fabricated candidate diff | unit | same file as above | ❌ Wave 0 |
| Exit preview: staged TAKE/STOP re-eval matches `evaluateExit` given identical config (byte-parity) | unit + fast-check property | `bun run test -- packages/core/src/exits/application/previewExitRuleOverrides.test.ts` | ❌ Wave 0 |
| Exit preview never calls `persistExitVerdict` (deps type structurally excludes it) | typecheck (compile-time), not a runtime test | `bun run typecheck` | n/a — enforced by types |
| Explainer registry has an entry for every knob path in `ruleConfig` (real-shape-derived, not a hand list — Pitfall 4) | unit | `bun run test -- packages/contracts/src/rule-explainers.test.ts` | ❌ Wave 0 |
| Preview route: 200 for a valid partial body, byte-parity for an empty-overrides preview vs the current effective config | contract/integration | `bun run test -- apps/server/src/adapters/http/settings.routes.test.ts` | route file exists; new test cases needed |
| MCP `preview_rule_overrides` tool: same schema/behavior as the HTTP route (MCP-02 parity) | integration | `bun run test -- apps/server/src/adapters/mcp/tools.test.ts` | file exists; new test cases needed |
| Modal renders a caption/popover for every rendered knob row | component | `bun run test -- apps/web/src/screens/RuleSettingsModal.test.tsx` | file exists; new test cases needed |
| Regime client-side preview matches `bandVixTermStructure`/etc. given the same thresholds (no duplicated band logic) | component/unit | same file as above | new test cases needed |

### Sampling Rate
- **Per task commit:** targeted `bun run test -- <touched file>.test.ts`
- **Per wave merge:** `bun run test` (full workspace suite)
- **Phase gate:** full suite green + `bun run typecheck` + `bun run lint` before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/core/src/picker/application/previewPickerRuleOverrides.test.ts` — new use-case, new file
- [ ] `packages/core/src/exits/application/previewExitRuleOverrides.test.ts` — new use-case, new file
- [ ] `packages/contracts/src/rule-explainers.test.ts` — new registry + completeness test
- [ ] Export `toEntryGateState`/`toPickerGate` from `computePickerSnapshot.ts` (currently
      module-private) — needed by the new picker preview use-case per Pattern 2; a one-line
      `export` addition plus updating any test that imports the file, not a new test file itself

*(Framework already installed and configured; no install step needed.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited, unchanged) | Preview route mounts inside the same `authReadGroup`/Bearer-JWT-gated router as the existing `/api/settings/rules` PUT (`settings.routes.ts` convention) |
| V3 Session Management | no | No new session concept introduced |
| V4 Access Control | yes (inherited, unchanged) | Same single-operator Bearer-token gate as every other mutating settings route — preview is read-only (never persists) but still requires auth per this codebase's existing "everything behind the Bearer gate" posture |
| V5 Input Validation | yes | New `previewRuleOverridesRequest` Zod schema, `.strict()` at every level, reusing the SAME `ruleOverrides` shape/refinements (weight-sum-100, hysteresis-pair validity) as the existing PUT contract — never a looser preview-only schema |
| V6 Cryptography | no | Not applicable |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Preview endpoint used as a free-form "what-if the chain looked different" oracle by sending huge/absurd staged values | Denial of Service (resource exhaustion) | Same Zod bounds as the existing `ruleOverrides` contract (numbers only, no array-size-driven cost); preview is bounded by stored-snapshot/open-calendar-count, not user-controlled iteration count, so no new DoS surface vs. the existing PUT |
| A staged-preview accidentally persisting a verdict/snapshot row (state leak from a read-only endpoint) | Tampering | Structural exclusion: preview use-case deps type has zero persist port, mirrors `analyzeAdHocCalendar.ts`'s T-19-17 pattern exactly |
| Preview response leaking DB/storage error internals | Information Disclosure | Same flat `{error:"internal"}` mapping convention as every other route in `settings.routes.ts`/`picker.routes.ts` (T-19-16/T-29-16/T-30-16 precedent) |

## Sources

### Primary (HIGH confidence)
- `packages/contracts/src/rule-settings.ts` — the exact knob whitelist/shape (read in full)
- `packages/core/src/picker/application/analyzeAdHocCalendar.ts` + `computePickerSnapshot.ts` — the Phase-30 dry-run precedent + the compute-picker read/score/gate pipeline (read in full)
- `packages/core/src/picker/domain/{types,scoring,rule-config,entry-gate,sizing}.ts` — exact score/gate/sizing formulas and their override seams (read in full)
- `packages/core/src/exits/{application/computeExitAdvice.ts,application/getExitAdvice.ts,application/ports.ts,domain/evaluate-exit.ts,domain/exit-rules.ts}` — exact exit-evaluator inputs/outputs and existing server-side port composition (read in full)
- `packages/core/src/analytics/domain/regime.ts` — pure band functions with existing threshold-override params (read in full)
- `apps/server/src/adapters/http/{picker,settings}.routes.ts` + `apps/server/src/adapters/mcp/tools.ts` (relevant sections) — exact route/MCP twin conventions to mirror
- `apps/web/src/screens/RuleSettingsModal.tsx` + `apps/web/src/hooks/useRuleSettings.ts` — exact v1 rendering/mutation shape this phase extends
- `apps/web/package.json`, `eslint.config.js` — direct verification that `apps/web` already depends on and is allowed to import `@morai/core`
- `.planning/STATE.md` (Phase 17-01 decision log) — historical confirmation of the first `apps/web → @morai/core` import (`invertIv`)

### Secondary (MEDIUM confidence)
- None — every claim in this research was verified by reading the actual source file, not inferred from search results (this is a zero-external-dependency internal-codebase phase).

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, every primitive confirmed present by direct file read
- Architecture: HIGH — every pattern traced to an existing, currently-running code path (not inferred)
- Pitfalls: HIGH — pitfalls 1/3/4 are derived directly from reading the actual stored-data shape and the actual `evaluateExit` signature, not speculation

**Research date:** 2026-07-10
**Valid until:** 30 days (internal codebase, stable — only invalidated by a Phase-33+ change to the rule-settings contract shape or the picker/exits domain modules this research reads)
