# Runtime Rule Overrides

A single JSONB row lets an operator edit ~20 curated trading-rule knobs at runtime, without
a redeploy. Everything else stays a compile-time constant in `packages/core`.

## Governance: this overrides T-28-11

Phase 28 (T-28-11) locked the constants file as the only visible, user-editable source of
rule truth — no hidden default, no UI config screen. Phase 29 overrides that decision, with
user approval (see `29-CONTEXT.md`, Governance override).

The constants remain the DEFAULTS. They are not deleted or hidden — every merge function
falls back to them when no override exists. The `rule_overrides` row is an explicit, visible
layer on top. The settings modal shows the effective value AND the default side by side, so
an operator always sees drift from baseline. The override is never silent.

Storage decision and swap cost: `stack-decisions.md`, D25. Table DDL: `packages/adapters/src/
postgres/schema.ts` (`ruleOverrides`) and its migration.

## The merge seam: optional-param-defaulting-to-constant

Each engine owns its own pure merge function in its own `domain/` module:

- `resolvePickerRuleConfig(overrides?)` — `packages/core/src/picker/domain/`
- `resolveExitRuleConfig(overrides?)` — `packages/core/src/exits/domain/`
- `resolveRegimeRuleConfig(overrides?)` — `packages/core/src/analytics/domain/`

No cross-context settings god-module reaches into another engine's `domain/` — that would
break architecture rule 7 (cross-context calls only through application ports). A thin
`settings` context owns storage only: it reads and writes the raw JSONB row and never
imports picker, exits, or analytics domain code.

Every function that reads a rule constant today gains an optional parameter that defaults
to that same constant — never a required parameter, never a breaking signature change. This
is the same idiom the codebase already uses for `scoring.ts`'s `weights?` ablation param.

**The contract every new override param must satisfy: omitting the param reproduces today's
live output byte-identically.** The Phase 27 backtest leakage oracle (BT-02) replays a
historical cohort and asserts it reproduces the exact recorded live `picker_snapshot` score.
A default that silently drifts from the constant it replaces breaks that oracle without any
visible error — so every new default must reference the named constant, never a fresh
numeric literal.

## Where merging happens

| Engine | Read timing | Composition root |
|---|---|---|
| Picker (candidate selection, scoring) | Worker job start, each `compute-picker` run | `apps/worker/src/main.ts` |
| Exit advisor (TAKE/STOP rungs) | Worker job start, each `compute-exit-advice` run | `apps/worker/src/main.ts` |
| Regime bands | Server request time, each `getRegimeBoard` call | `apps/server/src/main.ts` |

The overrides port is called fresh inside each use-case body, not resolved once in the
composition-root closure. This is what makes "never cache overrides across runs" automatic
— it mirrors the existing `readMacroObservations` call inside `computePickerSnapshot.ts`,
which already does a real read on every invocation.

Exit rungs are a worker-job concern, not a server-request concern: `getExitAdvice.ts` (the
HTTP GET path) re-derives P&L from an already-persisted verdict and never calls
`evaluateExit` again. Only `computeExitAdvice.ts`, invoked by the worker, consumes the
TAKE/STOP rungs. A rung change takes effect on the next `compute-exit-advice` cycle, not on
the next page load.

The picker snapshot's `ruleSet` metadata must reflect the effective values used for that
run — not the compile-time `RULE_SET_METADATA` constant. `computePickerSnapshot.ts` builds
the stamped `ruleSet` from the resolved config, so the Analyzer's methodology panel never
shows stale weights when an override is live.

## Curated knobs (runtime-editable)

**Entry/picker** (`packages/core/src/picker/domain/`):
- Delta band: `DELTA_BAND_MIN`, `DELTA_BAND_MAX` (`candidate-selection.ts`)
- DTE windows: `FRONT_DTE_MIN`, `FRONT_DTE_MAX`, `BACK_DTE_MIN_GAP`, `BACK_DTE_MAX_GAP` (`candidate-selection.ts`)
- 9 scoring weights, must sum to 100 (`rules.ts`)
- debitFit band: `DEBIT_IDEAL_MIN`, `DEBIT_IDEAL_MAX` (`rules.ts`)
- VIX ladder tier boundaries: low/normal/elevated/crisis (`entry-gate.ts`)
- `MAX_OPEN_CALENDARS` (`brakes.ts`)
- Sizing tier contracts (`sizing.ts`)

**Exit advisor** (`packages/core/src/exits/domain/exit-rules.ts`):
- TAKE rungs (+15%/+10%/+5%) and STOP rungs (−50%/−25%), each with an arm/disarm pair

**Regime bands** (`packages/core/src/analytics/domain/regime.ts`):
- VIX term-structure warn/crisis, VVIX warn/crisis, VIX9D-ratio warn/crisis, HY-OAS warn/crisis

## Excluded knobs (stay code-only)

Not exposed, by user lock: normalizers (e.g. `SLOPE_NORMALIZER`), event penalties, gexFit
credits, liquidity gate internals, fill haircut, event blackout windows, gate hysteresis
internals (`GATE_PENALTY_FLOOR_MULTIPLIER`, `GATE_BLIND_MAX_BIZDAYS`), loss cooldown, roll
windows, staleness tolerance, and exit-plan defaults baked into candidates.

## Hysteresis pairs are edited as validated pairs

TAKE and STOP rungs are arm/disarm pairs, not independent values. Validation enforces the
disarm-before-arm relationship (disarm < arm magnitude for TAKE, disarm > arm magnitude for
STOP) so an edit cannot break hysteresis. A single-sided edit — arm without its matching
disarm — is rejected at the API boundary.

## Reset-per-group semantics

A group reset (`{ group: null }` on the PUT) deletes that group's override keys from the
JSONB row. The engine's merge function then falls through to the compile-time defaults for
every knob in that group — the same result as if the row had never been written.

## Weight-sum validation

The 9 picker scoring weights must sum to exactly 100. This invariant is enforced explicitly,
not silently normalized — the API boundary rejects a PUT whose weights don't sum to 100
rather than rescaling them.
