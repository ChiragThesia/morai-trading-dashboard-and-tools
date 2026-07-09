# Phase 28: Playbook Gates, Anti-Criteria & Sizing - Research

**Researched:** 2026-07-09
**Domain:** Market-level risk gates + anti-criteria brakes + discrete sizing tiers + a second
candidate-selection universe, wired into an existing hexagonal picker/exits engine.
**Confidence:** HIGH (in-repo wiring — every port, pattern, and constant cited below is read
directly from the codebase) / MEDIUM (VIX-tier sizing boundaries, event-calendar mechanics —
web-verified but not backtested on this system's own data).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Crisis gates BANDED with hysteresis, penalty-over-cliff (retired-gate scar: hard cliffs
  deleted trades with edge). Board (Phase 24) shows gate state.
- VIX/VIX3M ratio for the gate: BOTH legs must be same-epoch — Phase 24's regime-board
  Known-limitations note REQUIRES the gate not consume the mixed-epoch VIX9D-style ratio;
  VIX (VIXCLS) + VIX3M (VXVCLS) are both FRED EOD — aligned. Gate reads FRED pair. (VIX ≥ 25
  leg: VIXCLS EOD — accept T-1 lag as the daily regime filter, stamp as-of, per PITFALLS 10.)
- Sizing tiers: discrete user-set contract counts per VIX regime tier — NEVER derived optimum.
- Event-calendar bucket (PLAY-04): second universe path for short-gap (3-10d) calendars
  intentionally owning an event, event-appropriate rules — separate ruleSet rows, backEventBonus
  precursor exists as experimental.
- autoTuneTargetDelta (PLAY-05): additive, only after crisis-gate infra live. Most-optional —
  time-box and drop first if phase runs long (research flag).
- New macro→picker read port (VIX/VIX3M current values into picker context).
- Weight discipline: gates are GATES (universe filters/penalties), not score weights — active
  score weights stay sum-100 untouched.

### ✅ USER DECISION 1 (2026-07-09): missing-data gate = AGE-TOLERANCE
- Gate uses the last FRED value up to **3 business days old** (T-1 lag is normal FRED
  behavior). Older than 3 business days → data treated as MISSING → gate **fails CLOSED**
  (blocks new entries) with a loud "GATE BLIND" flag on the regime board and picker snapshot.
- Never silent: the blind state is always visible where the gate state renders.

### ✅ USER DECISION 2 (2026-07-09): anti-criteria thresholds
- **Max open calendars: 6** — new entries pause when open count ≥ 6.
- **Loss cooldown: realized loss ≥ 25% → 2 business days** — any calendar closed at or
  beyond the −25% STOP rung pauses new entries for 2 business days.
- **Sustained-trend filter: DROPPED (user challenged necessity; orchestrator concurred).**
  Rationale recorded: crisis gates cover vol-regime danger; deltaNeutral scoring + GAMMA/
  STOP exits cover directional blowthrough; n=13 gives no honest calibration basis for a
  price-trend brake. Deferred — revivable when backtest directional-attribution at larger n
  supplies evidence. Document in the playbook-gates doc as a deferred row with this
  rationale (PLAY-02 delivered as two brakes, third consciously deferred — NOT silently
  dropped).

### Claude's Discretion (after the two decisions)
- Hysteresis band widths for the crisis gates (e.g. block ≥25 / re-open <24 (VIX); block
  ≥0.95 / re-open <0.93 (ratio)) — mirror exit-advisor hysteresis conventions, document + test.
- Penalty shape between calm and crisis (linear score penalty band vs single penalty step).
- VIX tier boundaries for sizing (e.g. <15 / 15-20 / 20-25 / ≥25) — user sets the CONTRACT
  COUNTS per tier; tier edges Claude proposes, user confirms at UAT.

### Deferred Ideas (OUT OF SCOPE)
- Weight promotion from backtest — n≥30 gate.
- ML regime classification — out of scope table.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAY-01 | Market-level crisis gates: VIX ≥ 25 or VIX/VIX3M ≥ 0.95, banded/penalty-over-cliff, board shows gate state | §"Gate mechanics" — insertion point (computePickerSnapshot.ts, before candidate scoring override), hysteresis state machine, reused journal `ForReadingMacroObservations` port, additive `PickerSnapshot.gate` field, `RegimeBoard.tsx` chip precedent for the board render |
| PLAY-02 | Anti-criteria brakes: max open (6), loss cooldown (−25% → 2 bizdays), sustained-trend DROPPED | §"Anti-criteria wiring" — reuse `ForListingCalendars("open")`/`ForGettingOpenCalendars`; new bulk `ForReadingRecentClosedCalendars` port for the cooldown (no existing bulk calendar_events read); same market-level gate spot as PLAY-01 |
| PLAY-03 | Sizing tiers: discrete user-set contract counts per VIX regime tier | §"Sizing tiers" — named-constant registry (rules.ts-style, `sizing.ts`), evidence-cited tier boundaries (volatilitybox.com), ships on snapshot for Analyzer display, never enforced/derived |
| PLAY-04 | Event-calendar bucket: second universe for 3-10d gap calendars owning a tier-1 event, event-appropriate rules | §"Event-calendar bucket" — thin wrapper over `selectCandidates` with an overridden gap window + `backEvents.length > 0` post-filter (the field already exists on `RawCandidate`); separate bucket-scoped ruleSet promoting `backEventBonus`; Paradigm.co forward-IV citation |
| PLAY-05 | autoTuneTargetDelta: VIX-tuned target-delta preference, additive, most-optional | §"autoTuneTargetDelta" — directional evidence only (sell further OTM at high VIX); recommend a small linear band-edge tilt or defer per the milestone's own time-box guidance |
</phase_requirements>

## Summary

This phase adds zero new npm dependencies and (with one exception) zero new HTTP/adapter
surfaces — it is almost entirely a wiring phase over infrastructure the last four phases
already built. The VIX/VIX3M pair is already ingested (`macro_observations`, MACRO-01/Phase 23)
and already has a research-cited 0.90/0.95 warn/crisis banding function
(`packages/core/src/analytics/domain/regime.ts` `bandVixTermStructure`) computed by an
already-working cross-context read (`analytics/application/getRegimeBoard.ts` importing
journal's `ForReadingMacroObservations` through `journal/index.ts` — the exact "macro→picker
read port" pattern PLAY-01 needs, already proven in this codebase). The hysteresis state
machine PLAY-01 needs (arm/disarm bands, previous-cycle self-read) is not new invention either
— `packages/core/src/exits/domain/evaluate-exit.ts` already implements exactly this shape for
seven rules and documents the convention in `docs/architecture/exit-rules.md`. The one
genuinely new piece of infrastructure is a bulk `calendar_events` read for the loss-cooldown
brake (PLAY-02) — every existing calendar-events port reads by a single `calendarId`, and the
cooldown needs "every CLOSE event across all calendars in the last N business days."　　

**Primary recommendation:** Wire the VIX/VIX3M gate and the two anti-criteria brakes as ONE
market-level "entry gate" computed once per `computePickerSnapshot` cycle (not per candidate,
not inside `selectCandidates`'s per-strike loop), using the same read-then-override pattern
the use-case already applies for `eventsContextStatus` (`zeroEventAdjustment`): compute
candidates and scores normally, then overwrite `candidates: []` in the final snapshot when any
brake is tripped, so `termStructure`/`gex`/`events` stay populated for board/Analyzer context
even while blocked. Persist the gate's own state as an additive `PickerSnapshot.gate` field,
self-read the previous cycle's gate state from the existing `ForReadingPickerSnapshot` port
(mirrors exits' `exit_verdicts` self-read) — no new "gate history" table.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| VIX/VIX3M crisis gate (read + band + hysteresis) | API/Backend (`packages/core/src/picker/application`) | Database (`macro_observations`, already exists) | Pure computation over an already-ingested series; no browser/CDN involvement — mirrors `resolveGexContextStatus`/`resolveEventsContextStatus`'s existing placement in the same use-case |
| Anti-criteria brakes (max-open, loss-cooldown) | API/Backend (`packages/core/src/picker/application`) | Database (`calendars`, `calendar_events`, both exist) | Reads journal-owned state through application ports (architecture rule 7); pure boolean/count logic, no UI or CDN role |
| Sizing tiers (contract-count registry) | API/Backend (`packages/core/src/picker/domain`) | Browser/Client (Analyzer render) | The registry is a domain-layer named-constant table (rules.ts precedent); the browser only renders the snapshot's already-resolved tier + count, never computes it |
| Event-calendar bucket (second universe) | API/Backend (`packages/core/src/picker/domain`) | — | Pure candidate-selection variant, same tier as the existing `selectCandidates` |
| Gate-state display (regime board + Analyzer) | Browser/Client (`apps/web/src/components/RegimeBoard.tsx`, Analyzer) | API/Backend (contract field) | Render-only; the backend resolves band/state, the UI never re-derives it (existing `RegimeBoard.tsx` Chip precedent) |

## Standard Stack

No new packages. Every capability in this phase is pure TypeScript domain logic plus one new
Postgres read query, using libraries and patterns already present in the monorepo (Zod for the
contract additions, Drizzle for the one new adapter query, Vitest/fast-check for tests).

**Installation:** none.

## Package Legitimacy Audit

N/A — this phase installs no new packages. Every dependency used (Zod, Drizzle, Vitest,
fast-check) is already vetted and in use elsewhere in this monorepo.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │  fetch-rates cron (existing, Phase 23/24)     │
                    │  FRED VIXCLS + VXVCLS → macro_observations    │
                    └───────────────────┬───────────────────────────┘
                                        │ (already-ingested; no new fetch)
                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ compute-picker job → makeComputePickerSnapshotUseCase (existing, Phase 19) │
│                                                                              │
│  Step 1  readChainForPicker() ────────────────► chain cohort               │
│  Step 2  resolve spot/asOf/source                                          │
│  Step 3  readGexContext() + readEconomicEvents()                           │
│  Step 3c NEW: readMacroObservations() (reused journal port) ──► VIX/VIX3M   │
│           NEW: readOpenCalendars() (reused journal port) ──► open count     │
│           NEW: readRecentClosedCalendars(2 bizdays) (NEW port) ─► cooldown  │
│  Step 3d NEW: resolveEntryGate(vix, ratio, openCount, recentLosses,         │
│               previousGateState) ─► { state, penaltyMultiplier, reasons }   │
│  Step 4  selectCandidates() [primary universe]  + scoreCalendarCandidates() │
│          NEW: selectEventCandidates() [3-10d gap, owns event] (PLAY-04)     │
│  Step 4b NEW: apply gate penaltyMultiplier to every candidate's score       │
│               (post-scoring override, mirrors existing zeroEventAdjustment) │
│  Step 5  rank + cap at PICKER_TOP_N                                        │
│  Step 6  NEW: if gate.state ∈ {blocked, blind} or a brake tripped →         │
│               candidates: [] (termStructure/gex/events STILL populated)     │
│          NEW: sizing tier + recommended contract count resolved from VIX    │
│  Step 7  persist ONE PickerSnapshotRow (asOf/observedAt = cohort time,      │
│               NEVER now()) — gate field included                            │
└───────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────┐
                    │ GET /api/picker/candidates         │
                    │ get_picker_candidates MCP tool     │
                    │ pickerSnapshotResponse (Zod)       │
                    └────────────────┬───────────────────┘
                                     ▼
        ┌──────────────────────────────────────────────────────┐
        │ apps/web: RegimeBoard.tsx (existing, add a gate chip)  │
        │           Analyzer methodology/entry panel (existing,  │
        │           renders sizing tier + event-bucket label)    │
        └──────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new directories. New files land inside the existing bounded contexts:

```
packages/core/src/picker/
├── domain/
│   ├── rules.ts                # unchanged (weight-sum-100 invariant untouched)
│   ├── candidate-selection.ts  # extend selectCandidates() with optional gap-window
│   │                            #   params; add selectEventCandidates() wrapper (PLAY-04)
│   ├── entry-gate.ts           # NEW — pure resolveEntryGate() + hysteresis constants
│   │                            #   (mirrors exits/domain/exit-rules.ts + evaluate-exit.ts)
│   ├── sizing.ts               # NEW — VIX tier boundaries + named contract-count consts
│   │                            #   (mirrors rules.ts's RULE_SET_METADATA registry style)
│   └── types.ts                # extend PickerSnapshot-adjacent types additively
├── application/
│   ├── computePickerSnapshot.ts  # thread 3 new deps: readMacroObservations,
│   │                              #   readOpenCalendars, readRecentClosedCalendars;
│   │                              #   call resolveEntryGate + apply penalty + override
│   │                              #   candidates:[] when blocked
│   └── ports.ts                  # additive PickerSnapshot.gate/sizing/eventBucket fields
packages/core/src/journal/
├── application/ports.ts          # NEW port: ForReadingRecentClosedCalendars (PLAY-02 only)
packages/adapters/src/postgres/repos/
├── calendar-events.ts            # add the bulk recent-closed-with-realizedPnl query
packages/adapters/src/memory/
├── picker-snapshot.ts            # extend in-memory twin for the new gate field (rule 8)
packages/contracts/src/
├── picker.ts                     # additive Zod fields: gate, sizing, bucket
apps/web/src/components/
├── RegimeBoard.tsx                # add ONE more chip (or a dedicated "Entry gate" tile)
```

### Pattern 1: Market-level gate computed once per cycle, never per-candidate

**What:** `resolveEntryGate` is called exactly once in `computePickerSnapshot.ts`, using cohort-
level inputs (VIX, ratio, open-calendar count, recent realized losses) — never inside
`selectCandidates`'s per-strike/per-expiry loop. It returns a single `EntryGateState`, not a
per-candidate value.
**When to use:** Any check whose inputs do not vary per candidate (market regime, portfolio-
level counts) belongs at the use-case (application) layer, evaluated once, and applied as a
post-scoring override — exactly the existing `eventsContextStatus` → `zeroEventAdjustment`
precedent (`computePickerSnapshot.ts` lines 308-310, 147-154).
**Example:**
```typescript
// Source: packages/core/src/picker/application/computePickerSnapshot.ts (existing pattern
// this phase extends — zeroEventAdjustment is the template for the new penalty override)
function zeroEventAdjustment(candidate: ScoredCandidate): ScoredCandidate {
  const breakdown = candidate.breakdown.map((entry) =>
    entry.criterion === "eventAdjustment" ? { ...entry, rawValue: 0, contribution: 0 } : entry,
  );
  const rawScore = breakdown.reduce((sum, entry) => sum + (entry.weight * entry.contribution) / 100, 0);
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));
  return { ...candidate, breakdown, score };
}
// NEW analog: applyGatePenalty(candidate, multiplier) scales `score` by multiplier WITHOUT
// touching `breakdown` — the penalty is explicitly NOT one of the 9 weighted criteria
// (user lock: "gates are GATES ... not score weights — active score weights stay sum-100
// untouched"). `score = Math.round(candidate.score * multiplier)`.
```

### Pattern 2: Hysteresis via self-read of the previous persisted cycle (no new state table)

**What:** The gate needs "was this armed last cycle" state to avoid flapping. `exits` already
solved this by reading its own append-only `exit_verdicts` table's newest row
(`ForReadingLatestVerdictsPerCalendar`) and passing it as `previousVerdict` into the pure
evaluator. The picker has the exact same shape available for free: `picker_snapshot` is already
append-only (D-06) and already has a `ForReadingPickerSnapshot` port that reads the most recent
row. Read `previousRow.snapshot.gate` as the hysteresis seed — no new table, no new port for
this piece.
**When to use:** Any new stateful (arm/disarm) rule added to an already-append-only-persisted
snapshot.
**Example:**
```typescript
// Source: packages/core/src/exits/domain/evaluate-exit.ts (the hysteresis convention to mirror)
function wasArmed(previousVerdict: PreviousVerdict, ruleId: ExitRuleId, rung: string | null): boolean {
  return previousVerdict !== null && previousVerdict.ruleId === ruleId && previousVerdict.rung === rung;
}
// evalTerm: freshArm at inversion >= TERM_INVERSION_MIN (0.005); heldArmed at
// wasArmed(...) && inversion >= TERM_INVERSION_DISARM (0.003) — the SAME two-threshold shape
// PLAY-01's VIX/ratio gate needs (arm >=25/>=0.95, disarm <24/<0.93 while previously armed).
```

### Pattern 3: Reuse the existing macro read port across bounded contexts (no new port)

**What:** `analytics/application/getRegimeBoard.ts` already imports journal's
`ForReadingMacroObservations` through `journal/index.ts` and computes `latestRowPerSeries` +
`olderDate(vixCls.date, vxvcls.date)` for the exact VIXCLS/VXVCLS pair PLAY-01 needs. The
picker's "new macro→picker read port" from CONTEXT.md is satisfied by threading this SAME
already-exported port into `ComputePickerSnapshotDeps` — not by inventing a new port type.
**When to use:** Whenever a new bounded context needs a read another context's application
layer already exposes.
**Example:**
```typescript
// Source: packages/core/src/analytics/application/getRegimeBoard.ts (existing; the pattern
// to copy verbatim into computePickerSnapshot.ts's Step 3c)
import type { ForReadingMacroObservations, MacroObservationRow } from "../../journal/index.ts";

function latestRowPerSeries(rows: ReadonlyArray<MacroObservationRow>): Map<string, MacroObservationRow> {
  const latest = new Map<string, MacroObservationRow>();
  for (const row of rows) {
    const current = latest.get(row.seriesId);
    if (current === undefined || row.date > current.date) latest.set(row.seriesId, row);
  }
  return latest;
}
// olderDate(vixCls.date, vxvcls.date) — the SAME "never overstate freshness" rule for the
// gate's own asOf stamp (MACRO-03 convention, already precedent-approved).
```
At the composition root (`apps/worker/src/main.ts`), the concrete repo instance already
exists too: `const macroObsRepo = makePostgresMacroObservationsRepo(db);` (line 202) — thread
`macroObsRepo.readMacroObservations` straight into `computePickerSnapshotUseCase`'s deps
object next to the existing `readChainForPicker`/`readGexContext` wiring (lines 569-579).
Zero new adapter code for this read.

### Pattern 4: Age-tolerance via an exact business-day loop (reuse `isNyseHoliday`)

**What:** `packages/shared/src/nyse-holidays.ts` already exports a pure `isNyseHoliday(date):
boolean` (no I/O, no imports — architecture-boundaries §2 compliant at the shared tier). Rather
than a calendar-day proxy (`age ≤ 5` calendar days ≈ 3 business days — imprecise around
3-day weekends and holidays clustered near month boundaries, e.g. Thanksgiving Thu+Fri), loop
day-by-day from the macro observation's `asOf` to the reference `now()`, counting only Mon-Fri
non-holiday days, using the SAME `Date.UTC`-on-parsed-components idiom `candidate-selection.ts`
`isoDayNumber`/`daysBetween` already establish (never a cross-timezone `Date` constructor call
— Pitfall 3). This is a ~10-line pure function, not a new dependency.
**When to use:** Any "N business days old" gate.
**Example:**
```typescript
// NEW — packages/core/src/picker/domain/entry-gate.ts, following the isoDayNumber precedent
// in candidate-selection.ts (Date.UTC on parsed ISO components, no instant-construction call)
export function businessDaysSince(asOfIso: string, nowIso: string): number {
  let count = 0;
  let cursor = isoDayNumber(asOfIso) + 1; // asOf day itself doesn't count as "stale"
  const end = isoDayNumber(nowIso);
  while (cursor <= end) {
    const d = new Date(cursor * 86_400_000);
    const weekday = d.getUTCDay(); // 0=Sun, 6=Sat
    if (weekday !== 0 && weekday !== 6 && !isNyseHoliday(d)) count += 1;
    cursor += 1;
  }
  return count;
}
// gate blind when businessDaysSince(olderAsOf, nowIso) > 3
```

### Pattern 5: Bucket-scoped ruleSet, not a second WEIGHT_* constant set on the primary registry

**What:** PLAY-04's event-calendar candidates are scored with the SAME 9 formulas
(`fwdEdge`/`slope`/`gexFit`/`beVsEm`/`deltaNeutral`/`debitFit`/`thetaVega`/`vrp`/
`eventAdjustment`) but `backEventBonus` — currently `weight: 0, status: "experimental"` in the
primary `RULE_SET_METADATA` — is promoted to `active` with a nonzero weight EXCLUSIVELY in a
second, bucket-scoped registry (its own sum-100 invariant, its own test), never mutating
`WEIGHT_*` constants the primary registry's test already locks. This is the literal reading of
CONTEXT.md's "separate ruleSet rows" instruction and keeps the "active score weights stay
sum-100 untouched" lock scoped correctly to the PRIMARY registry.
**When to use:** A second candidate universe that needs a genuinely different scoring emphasis
without touching the calibrated primary weights.

### Anti-Patterns to Avoid
- **Per-candidate crisis gate:** evaluating VIX/ratio inside `selectCandidates`'s strike loop —
  wasteful (same market-level value re-checked hundreds of times) and, per the RETIRED
  `term-inversion` per-pair gate lesson (`picker-rules.md`), historically how this exact class
  of gate accidentally became a per-candidate filter that deleted trades with edge.
- **New weighted score criterion for the penalty:** adding a 10th `WEIGHT_*` term for VIX/ratio
  penalty violates the explicit user lock (gates ≠ score weights) and would break the
  weight-sum-100 registry test.
- **Silent "assume open" on a stale/missing macro read:** the AGE-TOLERANCE decision requires
  failing CLOSED and rendering a loud GATE BLIND state — mirrors D-17's "never silent" guard-
  tagging convention already used for `gexContextStatus`/`eventsContextStatus`.
- **N+1 per-calendar `calendar_events` reads for the cooldown brake:** `ForReadingCalendarEvents`
  is scoped to one `calendarId`; looping it over every recently-closed calendar is a correct but
  needlessly chatty pattern given a bulk query is one JOIN away (Pattern below, PLAY-02).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VIX/VIX3M crisis banding thresholds | A new 0.90/0.95-style constant pair guessed from scratch | `packages/core/src/analytics/domain/regime.ts` `VIX_TERM_STRUCTURE_WARN`/`_CRISIS` (0.90/0.95) as the anchor for the gate's penalty-band boundary | Already research-cited (Phase 24, eco3min.fr/systemtrader.co) and already matches the user's own locked ≥0.95 crisis threshold exactly — reusing it as the penalty-band floor costs zero new research |
| Hysteresis state machine | A bespoke gate-specific arm/disarm implementation | `evaluate-exit.ts`'s `wasArmed`/rung-pair pattern, generalized to the gate's 2-3 states | Already tested, already documented (`docs/architecture/exit-rules.md`), already reviewed for the exact flapping failure mode this phase must avoid |
| Business-day age arithmetic | A calendar-day proxy or a date library (`date-fns`, `dayjs`) | `packages/shared/src/nyse-holidays.ts` `isNyseHoliday` + the existing `isoDayNumber` idiom | Zero new dependency; the holiday table is already maintained through 2027; a proxy risks under/over-counting around clustered holidays |
| Macro value read for the gate | A new picker-owned FRED/macro repo or duplicate fetch | Journal's existing `ForReadingMacroObservations`, reused cross-context exactly as `analytics/getRegimeBoard.ts` already does | The port, the repo, and the composition-root wiring all already exist — a new picker-owned macro port would duplicate `macro_observations` reads for no benefit |
| Open-calendar count | A new port | `ForGettingOpenCalendars` / `ForListingCalendars("open")` (journal, already exists, already reused by `exits`' `ForReadingHeldPositions`) | Single-purpose port already present; the count is `(await readOpenCalendars()).length` |

**Key insight:** This phase's entire "hand-roll" risk is in ONE place — the loss-cooldown bulk
read (PLAY-02). Everything else is reuse. Resist the temptation to also build a generic
"gate framework" or DSL; the phase's own scope explicitly excludes an ML regime classifier and
this codebase's `docs/architecture/*.md` doc set repeatedly warns against DSLs (RULE-01 guard,
picker-rules.md's registry-as-rows discipline) — a gate is a typed row + a pure function, same
as every other rule in this system.

## Common Pitfalls

### Pitfall 1: Gate flapping without a hysteresis buffer wide enough to matter
**What goes wrong:** A VIX print that oscillates around 25.0 (e.g. 24.9 → 25.1 → 24.8) flips
the gate open/blocked every cycle, spamming the board and — worse — the picker's `candidates`
array toggles empty/non-empty on noise, which looks like a bug to the user.
**Why it happens:** VIXCLS is a T-1 daily EOD print (per the user's own accepted-lag decision),
so "every cycle" in practice means "every day" — but a too-narrow disarm buffer (e.g. block
≥25/reopen <24.9) still flaps on legitimate day-to-day noise near the boundary.
**How to avoid:** Use the user-specified buffer widths (25→24 VIX, 0.95→0.93 ratio) as the
FLOOR, not the ceiling — these already give ~4% and ~2pp relative buffers respectively, in line
with `evaluate-exit.ts`'s existing GAMMA (25% relative) and TERM (40% relative) buffers. Test
with a fast-check property: for any sequence of values oscillating within the disarm band, the
gate state must never change (mirrors `exit-rules.test.ts`'s existing hysteresis property tests).
**Warning signs:** `candidates: []` appearing and disappearing across consecutive daily
snapshots without a real regime shift.

### Pitfall 2: A GATE BLIND state that silently degrades to "open"
**What goes wrong:** If the age-tolerance check is implemented as "use the last value
regardless of age" with only a soft warning, a multi-day macro-fetch outage (already a known
failure mode — see `docs/architecture/regime-board.md`'s HY OAS "brand-new series, zero
backfill" note and the general FRED-fetch-failure precedent in `fetchMacroSeries.ts`'s D-07
fail-loud design) silently lets the picker keep entering trades in what could be an unrecognized
crisis.
**Why it happens:** The natural implementation path (read latest row, use it) has no built-in
staleness check unless one is deliberately added — unlike `gexContextStatus`/
`eventsContextStatus`, which already have this guard, a NEW macro read has none by default.
**How to avoid:** Compute `businessDaysSince` unconditionally on every cycle (Pattern 4) and
fail closed (`state: "blind"`, `candidates: []`) whenever the older-of-two-dates age exceeds 3
business days — mirroring the D-17 "never silent" convention already proven for GEX/events.
**Warning signs:** `gate.state === "open"` persisting across a `macro_observations` gap the
`fetch-rates` cron's own error log already shows.

### Pitfall 3: Per-candidate vs market-level confusion
**What goes wrong:** Implementing the VIX/ratio check as a per-candidate `gate` row in
`RULE_SET_METADATA` (kind: "gate") makes it look like `net-theta-positive`/`liquidity` — but
those are genuinely per-candidate (each candidate has its own theta/liquidity), while VIX/ratio
is the SAME value for every candidate in a cohort. Treating it as a per-candidate gate risks
re-deriving the RETIRED per-pair `term-inversion` gate's exact mistake (picker-rules.md: "read
the playbook's crisis guard literally and deleted exactly the trades with edge").
**Why it happens:** `RULE_SET_METADATA`'s `kind: "gate"` enum is the most obvious place to add
"another gate" without re-reading why it's per-candidate.
**How to avoid:** Keep the entry gate OUT of `RULE_SET_METADATA` entirely — it is not a
candidate-scoring rule, it's a cohort-level pre-condition on whether `computePickerSnapshot`
emits any candidates at all. Document it in `docs/architecture/picker-rules.md` as a distinct
section (e.g. "Market-Level Entry Gate"), not a new row in the existing rule table.
**Warning signs:** A `RULE_SET_METADATA` row whose formula never references the candidate it's
attached to.

### Pitfall 4: N+1 reads for the loss-cooldown brake
**What goes wrong:** Looping `ForListingCalendars("closed")` then calling
`ForReadingCalendarEvents(calendarId)` per calendar to find CLOSE rows works but issues one
query per recently-closed calendar every picker cycle (every ~30 min).
**Why it happens:** Every EXISTING calendar-events read port is scoped to a single
`calendarId` — there is no bulk "all CLOSE events since date X" query in the codebase today.
**How to avoid:** Add ONE new port, `ForReadingRecentClosedCalendars(sinceDate)`, backed by a
single SQL JOIN (`calendars` ⋈ `calendar_events` WHERE `event_type = 'CLOSE'` AND
`calendars.closed_at >= sinceDate`) in `packages/adapters/src/postgres/repos/calendar-events.ts`
— plus its in-memory twin (architecture rule 8). This is the ONE genuinely new piece of
plumbing this phase needs; keep it exactly this narrow.
**Warning signs:** Picker compute latency growing with the number of historical closed
calendars.

### Pitfall 5: Reusing the VIX9D/VIX ratio instead of the VIX/VIX3M pair
**What goes wrong:** `docs/architecture/regime-board.md`'s "Known limitations" section already
documents that `vix9d-vix`'s numerator (CBOE delayed quote) and denominator (FRED EOD) come
from DIFFERENT observation times and explicitly says: "Phase 28 MUST NOT wire `vix9d-vix` into
a hard picker gate until both legs share an observation time."
**Why it happens:** `vix9d-vix` is already computed and displayed on the board; it would be
easy to reach for it as "the VIX ratio" without checking which one CONTEXT.md locked (the
VIX/VIX3M pair, both FRED EOD — same-epoch, no mixed-source risk).
**How to avoid:** The gate reads ONLY `VIXCLS` and `VXVCLS` from `macro_observations` — never
`VIX9D`. This is already a locked decision (CONTEXT.md), restated here as a build-time guard
this research confirms is architecturally sound (both series share the FRED EOD cadence).
**Warning signs:** A gate implementation importing `VIX9D` anywhere.

## Code Examples

### Existing hysteresis rung shape (the template for the VIX/ratio gate's 2-3 state machine)
```typescript
// Source: packages/core/src/exits/domain/exit-rules.ts (existing, unmodified this phase)
export type ExitRung = {
  readonly label: string;
  readonly arm: number;
  readonly disarm: number;
};
export const STOP_RUNGS: ReadonlyArray<ExitRung> = [
  { label: "-50%", arm: -0.5, disarm: -0.48 },
  { label: "-25%", arm: -0.25, disarm: -0.23 },
];
// NEW analog (entry-gate.ts): VIX_GATE_RUNGS / RATIO_GATE_RUNGS, same {label, arm, disarm}
// shape, arm/disarm oriented for a "higher = worse" metric instead of STOP's "lower = worse".
```

### Existing D-17 never-silent staleness pattern (the template for GATE BLIND)
```typescript
// Source: packages/core/src/picker/application/computePickerSnapshot.ts (existing, unmodified)
function resolveGexContextStatus(gexContext: GexContextForPicker | null, now: Date): "ok" | "stale" | "missing" {
  if (gexContext === null) return "missing";
  const age = now.getTime() - gexContext.computedAt.getTime();
  return age > GEX_FRESHNESS_WINDOW_MS ? "stale" : "ok";
}
// NEW analog: resolveMacroGateBlindness(olderAsOfIso, nowIso) — same three-state shape,
// business-day age instead of a millisecond window (Pattern 4).
```

### Existing bulk-read + latest-row-per-series (the template for the macro gate read)
```typescript
// Source: packages/core/src/analytics/application/getRegimeBoard.ts (existing, reused verbatim)
const vixCls = latest.get("VIXCLS");
const vxvcls = latest.get("VXVCLS");
if (vixCls !== undefined && vxvcls !== undefined) {
  const value = vixCls.value / vxvcls.value;
  if (Number.isFinite(value)) {
    // ... band + asOf = olderDate(vixCls.date, vxvcls.date)
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Per-pair term-inversion hard gate (front IV > back IV blocks entry) | Market-level VIX/VIX3M crisis gate + banded penalty | 2026-07-09 (this phase, superseding the 2026-07-09 retirement documented in picker-rules.md) | Crisis protection moves from a per-candidate gate (which deleted trades with real edge) to a cohort-level, hysteresis-banded gate that never touches per-candidate scoring math |
| Event blackout as an entry-blocking gate | `eventAdjustment` score penalty + `exitBeforeIso` hard-close stamp | 2026-07-09 (already shipped, Phase 19/26) | Precedent this phase's own penalty-band design directly follows — "penalty, not cliff" is now this codebase's established idiom for playbook risk rules |

**Deprecated/outdated:** N/A — nothing in this phase deprecates existing rows in
`RULE_SET_METADATA`; every existing score weight is untouched.

## Gate mechanics (research question 1 — file:line detail)

**Insertion point:** `packages/core/src/picker/application/computePickerSnapshot.ts`, between
existing Step 3 (read GEX + economic-events contexts, lines 275-286) and Step 4 (select +
score, lines 296-310). A new Step 3c reads `readMacroObservations`, `readOpenCalendars`, and
`readRecentClosedCalendars`, then calls a pure `resolveEntryGate` (new,
`picker/domain/entry-gate.ts`) with the previous cycle's gate state (read via the EXISTING
`readPickerSnapshot`/`ForReadingPickerSnapshot` port — self-read precedent, Pattern 2).

**One check per cohort, not per candidate:** `resolveEntryGate` is called exactly once per
`computePickerSnapshot` invocation, taking cohort-level scalars (vix, ratio, openCount,
recentLossCount) — never inside `selectCandidates`'s per-strike/per-expiry loop
(`candidate-selection.ts` lines 238-329). This is the single most important structural decision
in this phase (Pitfall 3).

**Snapshot payload flow:** `PickerSnapshot` (application/ports.ts, `packages/core/src/picker/
application/ports.ts` lines 141-175) gains an additive `gate` field:
```typescript
readonly gate: {
  readonly vix: number | null;
  readonly vix3m: number | null;
  readonly ratio: number | null;
  readonly asOf: string | null; // older of VIXCLS/VXVCLS dates (MACRO-03 convention)
  readonly state: "open" | "penalty" | "blocked" | "blind";
  readonly penaltyMultiplier: number; // 1.0 = no penalty
  readonly brakes: { readonly maxOpen: boolean; readonly cooldown: boolean; readonly cooldownUntil: string | null };
};
```
This mirrors the existing `gexContextStatus`/`eventsContextStatus` additive-field precedent
(both were added without breaking `pickerSnapshotResponse`'s Zod schema via `.default()`
fallbacks — see `packages/contracts/src/picker.ts` lines 218-221, 231-241 for the exact
pattern to copy for `gate`). `RegimeBoard.tsx` renders it as one more `Chip` (or a dedicated
tile, since it has 4 states vs the existing 3-band chips) using the SAME `BAND_CLASSES`-style
color mapping already established (`RegimeBoard.tsx` lines 27-31).

**Hysteresis constants — recommendation:**

| Gate | Arm (blocked) | Disarm (blocked→penalty) | Penalty-band floor | Disarm (penalty→open) |
|------|---------------|---------------------------|---------------------|------------------------|
| VIX (absolute) | ≥ 25 [user-locked] | < 24 [user-locked] | 20 | < 19 [ASSUMED, Claude's discretion] |
| VIX/VIX3M ratio | ≥ 0.95 [user-locked] | < 0.93 [user-locked] | 0.90 [CITED: reuses `regime.ts` `VIX_TERM_STRUCTURE_WARN`] | < 0.89 [ASSUMED, Claude's discretion] |

The ratio penalty-band floor (0.90) is NOT a new assumption — it is the EXACT existing
`VIX_TERM_STRUCTURE_WARN` constant in `analytics/domain/regime.ts` (already cited to
eco3min.fr/systemtrader.co in Phase 24's own research). The VIX absolute-level floor (20) has
no existing in-repo precedent; it is proposed by analogy to volatilitybox.com's cited 15/20/30
four-tier structure (see Sizing tiers below) and should be confirmed at UAT alongside the
sizing tier boundaries — both use the same VIX ladder for consistency (one set of named
constants, not two overlapping band systems).

## Penalty band shape (research question 2)

**Recommendation:** Linear penalty, not a step function, matching `eventAdjustment`'s existing
graduated-penalty idiom (`rules.ts` `EVENT_PENALTY` — a fractional multiplier, not a binary
gate) and directly honoring the retired-gate lesson cited in `picker-rules.md`: "the per-pair
`term-inversion` gate ... read the playbook's crisis guard literally and deleted exactly the
trades with edge."

```
VIX:    < 20        → multiplier 1.0 (open)
        20 → 25      → linear 1.0 → 0.3 (penalty band)
        ≥ 25         → candidates: [] (blocked; multiplier is moot)

Ratio:  < 0.90       → multiplier 1.0 (open)
        0.90 → 0.95  → linear 1.0 → 0.3 (penalty band)
        ≥ 0.95       → candidates: [] (blocked; multiplier is moot)

Combined multiplier = min(vixMultiplier, ratioMultiplier) — the WORSE of the two regimes wins,
applied via the Pattern-1 post-scoring override (score *= multiplier, breakdown unchanged).
```

A 0.3 floor (rather than 0.0) at the edge of the penalty band avoids a discontinuous jump right
at the blocked boundary — candidates near the cliff still rank low but don't vanish from the
list one cycle before the hard block, giving the board a visible "getting worse" signal instead
of a binary flip. `[ASSUMED]` — the 0.3 floor and the exact 20/25 VIX band width are Claude's
discretion per CONTEXT.md; propose at UAT alongside the sizing tiers.

## Age-tolerance implementation (research question 3)

Covered in Pattern 4 / Pitfall 2 above. Summary: business-day age loop using the existing
`isNyseHoliday` (`packages/shared/src/nyse-holidays.ts`) plus the `isoDayNumber` idiom already
established in `candidate-selection.ts`; `now()` injected the same way `gexContextStatus`/
`eventsContextStatus` already inject it (freshness-window bounding only, never as `asOf` —
06-06 CR-01/CR-02 precedent, restated in `computePickerSnapshot.ts`'s own docstring). GATE
BLIND state renders identically to `blocked` in terms of `candidates: []`, but with a distinct
`state: "blind"` value so the board can render a visibly different (louder) treatment.

## Anti-criteria wiring (research question 4)

**Open-calendar count:** `ForGettingOpenCalendars` (`journal/application/ports.ts` lines
100-106) or `ForListingCalendars("open")` (lines 124-130) — both already exist, both already
implemented (Postgres + in-memory). `openCount = (await readOpenCalendars()).length >= 6`.

**Realized-loss detection:** `calendar_events` rows carry `realizedPnl` populated on CLOSE
(`journal/domain/calendar-event.ts` line 46: "`realizedPnl: number | null` — D-09: NULL on
OPEN; populated on CLOSE and ROLL"). The basis for the −25% comparison is `openNetDebit`
(`Calendar.openNetDebit`, `journal/application/ports.ts` line 31) — the SAME fill-ledger basis
`exit-rules.md`'s STOP −25% rung already uses (`(netMark − openNetDebit) / openNetDebit`),
restated here as `realizedPnl / openNetDebit <= -0.25`. This is intentional design parity, not
a coincidence: a calendar that closes at or beyond the same −25% STOP rung the exit advisor
already fires on is exactly what should trip the entry-side cooldown.

**Where brakes hook:** Same market-level gate spot as PLAY-01 (Step 3c/3d of
`computePickerSnapshot.ts`) — `maxOpenBrake` and `cooldownBrake` are two more boolean inputs to
the SAME `resolveEntryGate` call, not a separate mechanism.

**Cooldown state — computed-on-read, no new table:** Confirmed FEASIBLE. `sinceDate = now() -
2 business days` (reuse Pattern 4's `businessDaysSince`, applied in reverse — count back 2
business days from `now()` to get the cutoff date), then read every CLOSE event on or after
that cutoff via the ONE new port (Pitfall 4): `ForReadingRecentClosedCalendars(sinceDate):
Promise<Result<ReadonlyArray<{calendarId: string; closedAt: Date; openNetDebit: number;
realizedPnl: number}>, StorageError>>`. `cooldownBrake = rows.some(r => r.realizedPnl / r.openNetDebit <= -0.25)`.
No new table — this is a read over EXISTING `calendars` + `calendar_events` rows, computed
fresh every cycle (matches the "computed-on-read from event history" instruction verbatim).

## Sizing tiers (research question 5, web-verified)

**VIX tier boundaries (recommended, aligned to the existing crisis-gate ladder):**

| Tier | VIX Range | Rationale |
|------|-----------|-----------|
| Low | < 15 | [CITED: volatilitybox.com] "Low Volatility: VIX below 15" |
| Normal | 15 – 20 | [CITED: volatilitybox.com] "Normal Volatility: VIX 15-20" |
| Elevated | 20 – 25 | [ASSUMED, Claude's discretion] volatilitybox.com cites 20-30 as "Elevated" but this phase caps the tier at 25 to align exactly with the already-locked hard-block boundary (PLAY-01) — sizing at ≥25 is moot since no new entries are permitted there anyway |
| Crisis | ≥ 25 | Coincides with the hard entry block (PLAY-01) — 0 contracts is trivially correct here since no candidates are ever emitted |

volatilitybox.com's own general sizing guidance for these tiers: Low 100-110% of normal size,
Normal 100%, Elevated 50-75%, Crisis 25-50% — directionally consistent with reducing size as
regime worsens, though that source's numbers are percentage-of-normal for directional futures/
equity sizing, not discrete calendar-spread contract counts, so they inform the SHAPE (monotonic
decrease) rather than the exact counts.

**Recommended default contract counts (Claude's proposal, `[ASSUMED]` — confirm at UAT):**

| Tier | Contracts | Rationale |
|------|-----------|-----------|
| Low (<15) | 2 | Baseline size at the debitFit-preferred $3.2k-5k spend (rules.ts `DEBIT_IDEAL_MIN/MAX`) — 2 contracts keeps total deployed capital in a comfortable range without over-concentrating in one calendar |
| Normal (15-20) | 2 | Same as Low — VIX 15-20 is this system's "normal" operating regime (matches `regime-board.md`'s own VVIX-warn-adjacent framing); no reduction needed until Elevated |
| Elevated (20-25) | 1 | Halved, consistent with volatilitybox.com's 50-75%-of-normal Elevated guidance, rounded to a whole contract |
| Crisis (≥25) | 0 | Matches the hard block — never a live choice since `candidates: []` already |

**Config surface:** A named-constant registry in `picker/domain/sizing.ts`, mirroring
`rules.ts`'s `RULE_SET_METADATA` style (a typed array of `{tier, vixMin, vixMax, contracts,
rationale}` rows) — user-editable source file, NOT a UI config screen (matches CONTEXT.md's
explicit "never a UI config" instruction). Shipped on the snapshot as a `sizing` field so the
Analyzer entry-plan panel renders "VIX 18.2 → Normal tier → 2 contracts" the same way it
already renders `ruleSet`/`exitPlan` from the engine, never a client-side copy.

## Event-calendar bucket (research question 6, web-verified)

[CITED: paradigm.co/blog/calendar-spread-options-strategy] confirms the underlying mechanic
already encoded in the experimental `backEventBonus` rule (`rules.ts` lines 168-171): "This
graph shows the current Forward IV of the 12/16 expiry options that include the FOMC and CPI
print" — i.e. when a scheduled macro event falls between two expiries, the LONGER-dated
(back) leg's forward-implied-vol carries a visible event premium the front leg (expiring before
the event) does not. This is exactly `backEventBonus`'s existing formula: `1 if an FOMC/CPI/NFP
date ∈ (frontExpiry, backExpiry] else 0`.

**Recommended implementation (thin wrapper, not a second engine):**
1. `candidate-selection.ts`'s `selectCandidates` already computes `backEvents` per candidate
   (`legSpansEvents(be, asOfIso, events)` minus front-leg events, lines 303-305) — this data
   already exists on every `RawCandidate`, unused by the primary universe's scoring beyond the
   experimental display-only `backEventBonus`.
2. Add a `selectEventCandidates` wrapper (same file) that calls `selectCandidates` with the
   back-leg gap window parameterized to `[3, 10]` days instead of the module-level
   `BACK_DTE_MIN_GAP`/`BACK_DTE_MAX_GAP` (15/90) — requires making the gap bounds optional
   function params with the existing constants as defaults (small, additive, non-breaking
   change to `SelectCandidatesParams`).
3. Post-filter to `candidates.filter(c => c.backEvents.length > 0)` — "owns" the event.
4. Score with a bucket-scoped registry (Pattern 5): `backEventBonus` promoted from weight-0 to
   an active weight (propose 8-10 points, `[ASSUMED]`, confirm at UAT) in a second, separate
   `EVENT_RULE_SET_METADATA` array with its OWN sum-100 invariant — the other 8 criteria's
   weights are rebalanced down proportionally within that bucket-scoped table only.
5. Tag results with a `bucket: "event-calendar"` field (additive to `PickerCandidateDomain`)
   so the Analyzer/UI can render them in a visually distinct section from the primary universe.

`eventAdjustment` (front-leg event penalty) needs NO change — by construction, this bucket's
front leg never spans the owned event (the gap-window + `(front, back]` membership already
excludes that case), so `eventAdjustment` naturally scores full credit without special-casing.

## autoTuneTargetDelta (research question 7, web-verified, thin evidence)

[CITED: earlyretirementnow.com, "Options Trading Series Part 14"] — direct quote: "If the VIX
is high at inception, you will likely sell so far out of the money that even a relatively large
move will not threaten your [positions]." This confirms the DIRECTION (higher VIX → prefer
strikes further OTM, i.e. toward the shallow/far edge of the existing `[DELTA_BAND_MIN,
DELTA_BAND_MAX]` = `[-0.49, -0.30]` band, toward -0.30) but gives no formula, no specific VIX-
to-delta mapping, and is written for 0/1-DTE index premium-selling, not 21-36 DTE calendars —
a materially different risk profile (this system's `slope`/`fwdEdge` rules already dominate
strike attractiveness; a superimposed VIX-delta tilt risks fighting those signals).

**Recommendation given the milestone's own "time-box and drop first if phase runs long"
instruction:** Evidence is directional but thin and not calendar-spread-specific. If time
permits, ship the smallest possible version: a linear tilt on the EXISTING `deltaNeutral`-
adjacent band preference (not a new weighted criterion — reuse the penalty-multiplier pattern,
Pattern 1) that nudges the effective delta-band edge from -0.49 toward -0.30 as VIX rises
through the SAME 15-25 ladder already established for sizing/penalty. If time does not permit,
defer entirely — PLAY-05 is explicitly marked most-optional in both REQUIREMENTS.md and
CONTEXT.md, and this research found no calendar-spread-specific numeric evidence strong enough
to justify a locked formula. `[ASSUMED]` throughout this section.

## BT evidence (research question 8)

The Phase-27 backtest harness (`27-06-SUMMARY.md`) is feature-complete but has NOT been run
against live/target data — "Not yet done (explicitly out of this plan's scope): running `bun
run migrate` against a real target DB, and running the CLI ... against live data. The
orchestrator owns both post-merge." No calibrated tier boundaries or gate thresholds are
available from backtest output yet. Treat `apps/worker/src/backtest.ts` as a FUTURE calibration
input for the VIX tier/penalty-band boundaries proposed here (`--report-only` mode can validate
proposed thresholds against the 13-trade oracle once run), not a blocker for this phase's
initial ship — consistent with BT-05's own "harness never writes weights, output is directional
evidence a human reads" design.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | VIX absolute-level penalty-band floor = 20, disarm at 19 | Gate mechanics | Penalty band too wide/narrow relative to user intent; low risk — Claude's discretion explicitly granted, UAT-confirmable |
| A2 | Ratio penalty-band disarm at 0.89 (below the CITED 0.90 floor) | Gate mechanics | Minor hysteresis-width miscalibration; low risk, easily adjusted post-UAT |
| A3 | 0.3 penalty floor (not 0.0) at the edge of both penalty bands | Penalty band shape | If wrong, candidates near the crisis boundary rank slightly higher/lower than intended; no correctness risk, purely a ranking-taste question |
| A4 | Sizing tiers: 2/2/1/0 contracts per tier | Sizing tiers | User explicitly confirms this at UAT per CONTEXT.md ("user confirms at UAT") — zero risk of silent wrong-sizing since the config is a visible named-constant file, not a hidden default |
| A5 | Event-calendar bucket `backEventBonus` weight = 8-10 points in the bucket-scoped registry | Event-calendar bucket | If too high, event-owning candidates could crowd out otherwise-better structures within that bucket; low risk since it's a NEW, separate universe that doesn't touch the primary ranking |
| A6 | autoTuneTargetDelta direction (higher VIX → prefer shallower/further-OTM band edge) | autoTuneTargetDelta | Evidence is directional-only from 0/1-DTE literature, not calendar-specific; recommend deferring or shipping as a minimal, easily-reverted tilt given the milestone's own time-box permission to drop it |
| A7 | VIX tier boundaries 15/20/25 (vs volatilitybox.com's cited 15/20/30) | Sizing tiers | The 30→25 cap is a deliberate, documented deviation to align with the already-locked hard-block boundary, not an error — but if the user actually wants a wider Elevated band before Crisis sizing kicks in, this would need revisiting |

**If this table is empty:** N/A — see rows above; every entry here is either explicitly
UAT-gated by CONTEXT.md or a low-blast-radius discretion call already flagged for confirmation.

## Open Questions (RESOLVED)

| # | Question | Resolution | Decided |
|---|----------|------------|---------|
| Q1 | How should the picker handle a missing/stale macro read (VIXCLS/VXVCLS gap)? | AGE-TOLERANCE: accept up to 3 business days old; beyond that, GATE BLIND (fails closed, loud board flag) | CONTEXT.md USER DECISION 1, 2026-07-09 |
| Q2 | What are the anti-criteria brake thresholds (max-open, cooldown, trend filter)? | Max open = 6; loss cooldown = realized loss ≥25% → 2 business days; sustained-trend filter DROPPED (no calibration basis at n=13, revivable later) | CONTEXT.md USER DECISION 2, 2026-07-09 |
| Q3 | Does the picker need a brand-new macro→picker read port, or can it reuse existing infrastructure? | REUSE — journal's `ForReadingMacroObservations` is already cross-context-consumed by `analytics/getRegimeBoard.ts`; the picker threads the SAME port into its own deps, no new port type | This research, confirmed via `analytics/application/getRegimeBoard.ts` + `apps/worker/src/main.ts` line 202 wiring |
| Q4 | Is a new port needed anywhere in this phase? | YES — exactly ONE: `ForReadingRecentClosedCalendars(sinceDate)` for the loss-cooldown bulk read (no existing bulk `calendar_events` query exists; every current port is scoped to one `calendarId`) | This research, confirmed via `rg` audit of `journal/application/ports.ts` and `packages/adapters/src/postgres/repos/calendar-events.ts` |

**Still open (deferred to planning/UAT, not blocking):**
- Exact penalty-band floor/disarm values (A1, A2) — Claude's discretion, propose + confirm.
- Exact sizing contract counts (A4) — user confirms at UAT per CONTEXT.md.
- Exact event-calendar bucket weight for `backEventBonus` (A5) — propose + confirm.
- Whether PLAY-05 ships this phase or is dropped per the milestone's own time-box permission.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing monorepo-wide config, `vitest.config.ts` at repo root) |
| Config file | `vitest.config.ts` |
| Quick run command | `bun run test -- picker exits` (targeted; matches existing `*.test.ts` co-location convention) |
| Full suite command | `bun run test` (2621+ tests per 27-06-SUMMARY.md's last full-suite count) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAY-01 | VIX≥25 or ratio≥0.95 blocks new entries (candidates:[]); hysteresis never flaps within the disarm band | unit + fast-check | `bun run test -- entry-gate.test.ts` | ❌ Wave 0 (new file: `packages/core/src/picker/domain/entry-gate.test.ts`) |
| PLAY-01 | GATE BLIND fires when macro data > 3 business days stale; never silently defaults to open | unit | `bun run test -- entry-gate.test.ts` | ❌ Wave 0 (same file) |
| PLAY-01 | Gate state persists on `PickerSnapshot.gate` and round-trips through `pickerSnapshotResponse` Zod schema | unit | `bun run test -- computePickerSnapshot.test.ts` | ✅ existing file, extend |
| PLAY-02 | Max-open brake trips at open count ≥ 6 | unit | `bun run test -- entry-gate.test.ts` | ❌ Wave 0 (same file) |
| PLAY-02 | Loss-cooldown brake trips for 2 business days after a ≥25% realized loss close | unit | `bun run test -- entry-gate.test.ts` | ❌ Wave 0 (same file) |
| PLAY-02 | `ForReadingRecentClosedCalendars` returns correct rows against a real Postgres schema | integration (testcontainers) | `bun run test -- calendar-events.contract.test.ts` | ✅ existing contract-test file, extend (per tdd.md: "Postgres repos → testcontainers against real Postgres. SQL is never mocked.") |
| PLAY-03 | Sizing tier resolves the correct contract count for a given VIX value at each tier boundary | unit + fast-check | `bun run test -- sizing.test.ts` | ❌ Wave 0 (new file: `packages/core/src/picker/domain/sizing.test.ts`) |
| PLAY-04 | `selectEventCandidates` emits only candidates with `backEvents.length > 0` within the [3,10]d gap window | unit | `bun run test -- candidate-selection.test.ts` | ✅ existing file, extend |
| PLAY-04 | Bucket-scoped ruleSet weights sum to 100 (mirrors the primary registry's existing invariant test) | unit | `bun run test -- rules.test.ts` (or a new `event-rules.test.ts`) | ❌ Wave 0 (new registry needs its own invariant test) |
| PLAY-05 | (if shipped) VIX-tuned delta tilt never pushes the effective band outside `[DELTA_BAND_MIN, DELTA_BAND_MAX]` | unit | `bun run test -- entry-gate.test.ts` or `candidate-selection.test.ts` | ❌ Wave 0 (depends on PLAY-05 ship/defer decision) |

### Sampling Rate
- **Per task commit:** `bun run test -- <touched-file>.test.ts` (existing repo convention, see
  every prior phase's SUMMARY.md task-commit pattern).
- **Per wave merge:** `bun run test` (full suite).
- **Phase gate:** Full suite green before `/gsd-verify-work` (existing project convention,
  `.claude/rules/tdd.md`).

### Wave 0 Gaps
- [ ] `packages/core/src/picker/domain/entry-gate.test.ts` — covers PLAY-01, PLAY-02
- [ ] `packages/core/src/picker/domain/sizing.test.ts` — covers PLAY-03
- [ ] `packages/adapters/src/postgres/repos/calendar-events.contract.test.ts` — extend for
      `ForReadingRecentClosedCalendars` (PLAY-02)
- [ ] `packages/adapters/src/memory/picker-snapshot.ts` — extend in-memory twin for the new
      `gate`/`sizing`/`bucket` fields (architecture rule 8 — same PR as the port change)
- Framework install: none — Vitest/fast-check/testcontainers already fully configured.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | Yes | Gate state is computed SERVER-SIDE ONLY, in `computePickerSnapshot.ts`; there is no client-writable gate input anywhere — the browser only ever renders `PickerSnapshotResponse.gate`, never supplies or overrides it (mirrors the existing "engine is the sole scoring authority" invariant already stated for `RULE_SET_METADATA`) |
| V2 Authentication | No | This phase adds no new authenticated surface; existing route/MCP auth (unchanged) covers the extended `pickerSnapshotResponse` payload |
| V3 Session Management | No | No session-affecting behavior added |
| V4 Access Control | No | Read-only advisory data, same access model as the existing picker/exits endpoints |
| V5 Input Validation | Yes | `pickerSnapshotResponse`'s Zod schema gains `gate`/`sizing`/`bucket` fields with `.default()` fallbacks (same pattern as the existing `ruleSet`/`gateDrops` additive fields) so OLD stored snapshot rows still parse — never a breaking schema change (matches every prior additive-field precedent in `packages/contracts/src/picker.ts`) |
| V6 Cryptography | No | No new secrets, tokens, or cryptographic material |
| V7 Error Handling & Logging | Yes | A macro-read failure or a `StorageError` from `ForReadingRecentClosedCalendars` must propagate as `err(...)` through the existing `Result<T,E>` chain — NEVER silently swallowed into a default-open gate state (Pitfall 2); this is the phase's single highest-consequence error-handling requirement |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Gate silently defaults to "open" on a data-read failure, masking a real crisis | Tampering (of risk state, via omission) | Fail-closed design (Pitfall 2): any read error or staleness beyond 3 business days forces `state: "blocked"`/`"blind"`, never `"open"` by default — same discipline the exits context already applies to `indicative`/`escalate` gating around NaN/stale marks (`evaluate-exit.ts` lines 236-249) |
| A future client-supplied override of gate state (e.g. a query param to "force open") | Elevation of Privilege | No such input exists in this design and none should be added — the gate is 100% server-computed, matching the STRM-04 read-only-advisor precedent already enforced structurally for the exits context (no `ForPlacingOrder`-shaped port exists anywhere in the repo, and this phase must not introduce an equivalent "force gate" port) |
| Repudiation of why the picker blocked entries on a given day | Repudiation | The append-only `picker_snapshot` history (D-06, unchanged) already persists the gate's full reasoning (`vix`/`ratio`/`asOf`/`state`/`brakes`) on every cycle — no separate audit log needed; this is the same "gateDrops — no silent caps" discipline already established for the primary universe's liquidity/net-theta gates |

## Sources

### Primary (HIGH confidence)
- `packages/core/src/picker/application/computePickerSnapshot.ts` — the exact use-case this
  phase extends (D-17 never-silent pattern, zeroEventAdjustment post-scoring override template)
- `packages/core/src/exits/domain/evaluate-exit.ts` + `exit-rules.ts` — the hysteresis
  convention this phase mirrors, plus `docs/architecture/exit-rules.md`'s documented band table
- `packages/core/src/analytics/application/getRegimeBoard.ts` + `packages/core/src/analytics/
  domain/regime.ts` — the exact macro-read + banding pattern this phase reuses, including the
  0.90/0.95 VIX/VIX3M constants already cited to eco3min.fr/systemtrader.co (Phase 24)
- `packages/core/src/picker/domain/candidate-selection.ts` + `rules.ts` — the universe/scoring
  machinery PLAY-04 extends, including the already-computed `backEvents` field and the
  experimental `backEventBonus` rule
- `packages/core/src/journal/application/ports.ts` (`Calendar`, `ForGettingOpenCalendars`,
  `ForListingCalendars`, `ForReadingCalendarEvents`) + `packages/core/src/journal/domain/
  calendar-event.ts` (`realizedPnl`) — the anti-criteria data sources
- `packages/shared/src/nyse-holidays.ts` + `rth-window.ts` — the business-day arithmetic base
- `apps/worker/src/main.ts` (lines 202, 569-579) — the composition-root wiring proving the
  macro repo instance already exists and is ready to thread into a new dep
- `.planning/phases/27-pick-04-backtest-harness/27-06-SUMMARY.md` — confirms the backtest
  harness is feature-complete but not yet run against live data (no calibration numbers yet)

### Secondary (MEDIUM confidence)
- [volatilitybox.com — Volatility Regimes Explained](https://volatilitybox.com/research/volatility-regimes-explained/) — VIX tier boundaries (<15/15-20/20-30/>30) and directional sizing-percentage guidance, WebSearch/WebFetch-verified quote
- [paradigm.co — Calendar Spread Options Strategy](https://www.paradigm.co/blog/calendar-spread-options-strategy) — forward-IV-including-FOMC/CPI quote directly supporting the `backEventBonus` mechanic
- [earlyretirementnow.com — Options Trading Series Part 14](https://earlyretirementnow.com/2026/01/30/options-trading-series-part-14-year-2025-review/) — "sell so far out of the money" VIX-inception quote for PLAY-05's directional evidence

### Tertiary (LOW confidence)
- WebSearch summary snippets referencing "VIX 16-25 volatility risk premium widest, 16-delta
  45 DTE, convert to iron condor above 25" — could NOT be traced to a single verifiably-fetched
  source page; NOT cited as fact anywhere above, flagged here only as a search artifact to avoid
  accidentally re-surfacing as if verified
- [harbourfrontquant.substack.com — Using the VIX for Position Sizing](https://harbourfrontquant.substack.com/p/using-the-vix-for-position-sizing) — confirms VIX-managed sizing generally outperforms realized-vol-based sizing but supplies no concrete numeric thresholds; used only as weak corroborating context, not a cited numeric source

## Metadata

**Confidence breakdown:**
- Standard stack / wiring (gate insertion point, port reuse, hysteresis pattern): HIGH — every
  claim is a direct file:line read from the current codebase, not training-data inference.
- Sizing tier boundaries / penalty-band widths: MEDIUM — evidence-cited general VIX-tier
  conventions, adapted (not directly transcribed) to this system's own already-locked crisis
  boundary; flagged `[ASSUMED]` for UAT confirmation per CONTEXT.md's own instruction.
- PLAY-04 event-calendar mechanics: MEDIUM — one strong direct citation (Paradigm.co) matching
  the ALREADY-EXISTING `backEventBonus` formula; implementation approach is a code-reuse
  argument (HIGH confidence) layered on that MEDIUM-confidence mechanic citation.
- PLAY-05 autoTuneTargetDelta: LOW — directional evidence only, from a materially different
  (0/1-DTE) trading style; explicitly flagged as the most-optional, most-deferrable requirement,
  consistent with the milestone's own guidance.

**Research date:** 2026-07-09
**Valid until:** 2026-08-08 (30 days — stable in-repo architecture; the web-verified sizing/
event-bucket evidence should be re-checked if PLAY-03/04 UAT reveals the proposed boundaries
don't match the user's actual TOS-tested priors, the same discipline `regime-board.md` already
documents for its own indicator set).
