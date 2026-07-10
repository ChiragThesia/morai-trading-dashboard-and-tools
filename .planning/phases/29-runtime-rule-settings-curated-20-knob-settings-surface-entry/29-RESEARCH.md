# Phase 29: Runtime Rule Settings - Research

**Researched:** 2026-07-09
**Domain:** Internal codebase refactor — inject a JSONB override layer between compile-time
rule constants and their consuming pure functions, across 3 bounded contexts (picker, exits,
analytics), with a settings-storage slice + HTTP/MCP surface + a web settings modal.
**Confidence:** HIGH (all findings are direct code reads of this repo; zero external
dependencies; zero new packages)

## Summary

This phase does not need any new library — every finding below is `[VERIFIED: codebase]`
(read directly from source in this session). The hard part is not the storage/API/UI shell
(those closely mirror the existing RULE-01 rule-tags feature) — it is that **most of the
curated knobs are not injectable today**. Only two seams already accept runtime overrides:
`scoring.ts`'s `weights?` ablation param (9 scoring weights — ready to use) and
`candidate-selection.ts`'s `effectiveDeltaMin?`/`backDteMinGap?`/`backDteMaxGap?` params
(partial — `DELTA_BAND_MAX`, `FRONT_DTE_MIN/MAX` are still hard-coded module constants read
directly inside `selectCandidates`). Everything else — the VIX ladder, sizing tiers,
`MAX_OPEN_CALENDARS`, `debitFit` band, exit TAKE/STOP rungs, and all 4 regime thresholds — is
a private or module-level constant with **zero parameter seam**, consumed directly inside a
pure function body. Wiring this phase means adding an optional, default-preserving parameter
to roughly a dozen functions across 5 files, without breaking the byte-identical-when-no-
override guarantee the backtest harness (Phase 27) depends on for its leakage oracle (BT-02).

**Primary recommendation:** Do NOT build one generic "settings" bounded context that reaches
into picker/exits/analytics domain internals. Instead, give **each of the three engines its
own pure `resolveXConfig(overrides?)` merge function in its own `domain/` module**, wired with
optional parameters that default to the existing constants (same pattern the codebase already
uses for `weights?`/`effectiveDeltaMin?`). A thin cross-cutting `settings` context (or just
`packages/contracts` + a `packages/adapters` repo) owns ONLY the JSONB storage + Zod validation
— it never imports picker/exits/analytics domain code, preserving the hexagon (rule 7: cross
bounded contexts only through application ports, never `domain/`). The composition root
(`apps/worker/src/main.ts`, `apps/server/src/main.ts`) threads the resolved config from a
freshly-read overrides port into each use-case's existing deps object — the "never cache
across runs" requirement is automatically satisfied because these use-cases already re-invoke
their port-function deps fresh on every call (same pattern as `readMacroObservations`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Rule override persistence (JSONB row) | Database / Storage | API / Backend | One row, Zod-validated at the adapter boundary on read+write (T-19-10 precedent) |
| Merge semantics (defaults ⊕ overrides) | API / Backend (`packages/core` domain, per-context) | — | Pure functions, no I/O — must stay hexagon-pure |
| Worker read-at-job-start (picker) | API / Backend (worker composition root) | — | `apps/worker` reads fresh via a port function each `compute-picker` run |
| Server read-at-job-start (exit rungs) | API / Backend (worker composition root, NOT server) | — | See Pitfall/Finding below — TAKE/STOP rungs are consumed by `compute-exit-advice`, a **worker job**, not a per-HTTP-request server path |
| Regime band read-at-request-time | API / Backend (server composition root) | — | `getRegimeBoard` has no persisted snapshot — it computes live per HTTP/MCP call already |
| Gear-icon settings modal | Browser / Client | — | `apps/web`, Dialog + Panel composition, TanStack Query mutation |
| Picker snapshot `ruleSet` stamping | API / Backend (`computePickerSnapshot.ts`) | — | Must switch from the compile-time `RULE_SET_METADATA` constant to an effective-value projection |

## Standard Stack

No new packages. Everything below is already installed and in use elsewhere in this repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | already installed (contracts package) | Validate the overrides JSONB blob at read+write boundary | Repo convention (T-19-10, journal-rules.ts) — every JSONB blob is Zod-parsed on write AND read |
| drizzle-orm | already installed | New `rule_overrides` table + migration | Repo convention (`packages/adapters/src/postgres/schema.ts`) |
| @tanstack/react-query | already installed (apps/web) | Settings GET query + PUT mutation, invalidate-on-success | Matches `useRuleTags.ts` exactly |
| @base-ui/react (Dialog) | already installed | Gear-icon modal | `apps/web/src/components/ui/dialog.tsx` already wraps this; used live in `Overview.tsx`'s "Exit rules ▸" trigger |
| lucide-react | ^1.21.0 (installed) | Gear icon | `[VERIFIED: package.json]` — already a web dependency |

**Installation:** none required — no `npm install` step for this phase.

## Package Legitimacy Audit

Not applicable — zero external packages introduced by this phase.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── apps/web ───────────────────────────┐
│  Shell.tsx (top bar)                                            │
│    [gear icon] → SettingsModal (Dialog, base-ui)                │
│        useRuleSettings() ──GET /api/settings/rules──┐           │
│                          ──PUT /api/settings/rules──┤           │
└──────────────────────────────────────────────────────┼──────────┘
                                                          │ JWT (authReadGroup)
┌─────────────────────────── apps/server ────────────────┼──────────┐
│  settingsRoutes (Hono)                                  │          │
│    GET  → getRuleSettingsUseCase()  ─┐                 │          │
│    PUT  → setRuleOverridesUseCase()  │                 ▼          │
│  MCP: get_rule_settings / set_rule_overrides           (raw JSONB)│
│                                        │                            │
│  getRegimeBoard (per-request) ────────┼── reads overrides.regime ──┤
│  (no worker job — live compute)       │   merges via resolveRegime │
│                                        │   Config(defaults, ovr)    │
└────────────────────────────────────────┼────────────────────────────┘
                                          │
                    packages/adapters/postgres: rule_overrides (1 row, JSONB)
                                          │
┌─────────────────────────── apps/worker ─┼────────────────────────┐
│  compute-picker job (chain-triggered)   │                        │
│    readRuleOverrides() ── fresh per run ┤                        │
│    resolvePickerRuleConfig(defaults,ovr.picker)                  │
│    → selectCandidates(..., config)  → scoreCalendarCandidates(   │
│         ..., { weights: config.weights })                        │
│    → ruleSet stamped with EFFECTIVE weights (not RULE_SET_METADATA)│
│                                                                     │
│  compute-exit-advice job (chain-triggered after picker)           │
│    readRuleOverrides() ── fresh per run                          │
│    resolveExitRuleConfig(defaults, ovr.exits)                    │
│    → evaluateExit(position, context, previousVerdict, config)    │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
packages/contracts/src/
└── rule-settings.ts          # NEW: ruleOverrides Zod schema (nested, partial, whitelisted),
                               #      getRuleSettingsResponse, setRuleOverridesRequest/Response

packages/core/src/
├── settings/                 # NEW small bounded context — storage-only, no domain merge logic
│   └── application/
│       ├── ports.ts          # ForReadingRuleOverrides, ForWritingRuleOverrides
│       ├── getRuleSettings.ts   # thin: reads raw overrides, returns as-is (no cross-context import)
│       └── setRuleOverrides.ts  # thin: validates whitelist, writes merged patch
├── picker/domain/
│   └── rule-config.ts        # NEW: PickerRuleOverrides type + resolvePickerRuleConfig(overrides?)
│                              #      (pure — only imports picker's own sibling domain consts)
├── exits/domain/
│   └── rule-config.ts        # NEW: ExitRuleOverrides type + resolveExitRuleConfig(overrides?)
└── analytics/domain/
    └── rule-config.ts        # NEW: RegimeRuleOverrides type + resolveRegimeRuleConfig(overrides?)

packages/adapters/src/
├── postgres/
│   ├── schema.ts             # + ruleOverrides pgTable
│   ├── migrations/0022_rule_overrides.sql
│   └── repos/rule-overrides.ts
└── memory/rule-overrides.ts  # in-memory twin (architecture rule 8)

apps/worker/src/main.ts       # thread readRuleOverrides + resolvePickerRuleConfig/
apps/server/src/main.ts       #   resolveExitRuleConfig/resolveRegimeRuleConfig into existing
                               #   use-case deps objects (composition root only)
apps/server/src/adapters/
├── http/settings.routes.ts   # NEW: GET/PUT /api/settings/rules
└── mcp/tools.ts              # + registerGetRuleSettingsTool / registerSetRuleOverridesTool

apps/web/src/
├── hooks/useRuleSettings.ts  # NEW: mirrors useRuleTags.ts (query + mutation + invalidate)
├── components/Shell.tsx      # + gear icon trigger, top-right
└── screens/RuleSettingsModal.tsx  # NEW: Dialog + DialogContent, 3 grouped Panels
```

### Pattern 1: Optional-param merge seam (the ONLY safe way to inject overrides into a pure fn)
**What:** Every domain function that currently reads a module-level constant directly must
gain an optional parameter that defaults to that same constant — never a required parameter,
never a breaking signature change.
**When to use:** Every one of the ~20 knobs below.
**Example (already-live precedent in this exact codebase):**
```typescript
// Source: packages/core/src/picker/application/ports.ts + scoring.ts (verified in this session)
export type ScoringParams = {
  readonly r: number;
  readonly q: number;
  readonly realizedVol20?: number | null;
  readonly slopeHistory?: ReadonlyArray<number>;
  /**
   * Ablation seam (PICK-04, T-27-03): override one or more active-rule weights. Absent/
   * undefined criteria fall back to the rules.ts constant — omitting this field entirely
   * (every live call site) reproduces today's live score/breakdown byte-identically.
   */
  readonly weights?: Partial<Record<BreakdownCriterion, number>>;
};
```
This is the exact contract every new override param in this phase must follow: **omitting the
param reproduces today's live behavior byte-identically** — required for BT-02 (backtest
leakage oracle reproduces the recorded live score).

### Pattern 2: Fresh-read-per-invocation (satisfies "never cache overrides across runs")
**What:** Add `readRuleOverrides: ForReadingRuleOverrides` to a use-case's `Deps` type and call
it inside the returned async function body (not in the composition root closure).
**When to use:** `computePickerSnapshot.ts`, `computeExitAdvice.ts`, `getRegimeBoard.ts`.
**Example:**
```typescript
// Mirrors the EXISTING readMacroObservations call inside computePickerSnapshot.ts:
// composition root (main.ts) builds the deps object ONCE at boot, but the port FUNCTION
// itself does a real DB read on every invocation — so "fresh every job run" is automatic,
// no special-case caching-bypass logic needed.
const macroResult = await deps.readMacroObservations();   // ← existing pattern, line 439
// NEW, same shape:
const overridesResult = await deps.readRuleOverrides();
const config = resolvePickerRuleConfig(overridesResult.ok ? overridesResult.value.picker : undefined);
```

### Anti-Patterns to Avoid
- **A generic cross-engine "settings" domain module that imports picker/exits/analytics
  `domain/`:** violates architecture rule 7 ("cross bounded contexts through application ports
  — never import another context's `domain/`"). Each engine keeps its own merge function.
- **Resolving/caching the merged config once in the composition root closure:** breaks the
  explicit CONTEXT.md requirement "Worker must not cache overrides across job runs — read
  fresh at each compute-picker run so a mid-day change takes effect next cycle." Always read
  inside the use-case body, not at `main.ts` top level.
- **A DB CHECK constraint or complex locking scheme for the single-row table:** this repo's own
  precedent (`broker_tokens`, keyed by `app_id`) enforces "one row per logical singleton" by
  convention (a fixed key literal), not a DB constraint. Match that — do not add novel
  single-row-enforcement machinery.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal/dialog primitive | A custom overlay/portal | `apps/web/src/components/ui/dialog.tsx` (`Dialog`/`DialogContent`/`DialogTrigger`) | Already wraps `@base-ui/react/dialog`, already used live for the "Exit rules ▸" trigger in `Overview.tsx:1205-1215` — same pattern fits the gear icon exactly |
| Form inputs | Custom number/range inputs | `apps/web/src/components/ui/input.tsx`, `slider.tsx` | Already installed shadcn primitives, unused elsewhere but present — no new dependency |
| Query/mutation plumbing | Custom fetch+state hook | `@tanstack/react-query` `useQuery`/`useMutation` + `apiFetch` from `lib/rpc.ts` | `useRuleTags.ts` is the exact template: non-optimistic, invalidate-on-success, per-key error map |
| JSONB blob validation | Manual `if` key-checking | Zod schema, `.parse()` at the adapter boundary on BOTH read and write | T-19-10 / 26-03 convention, already used for `picker_snapshot.snapshot` and `exit_verdicts.verdict` |

**Key insight:** This phase's entire shell (storage, route, MCP tool, web hook, modal) has a
near-1:1 precedent already shipped in this repo (RULE-01's rule-tags feature). The only genuinely
new work is the merge-seam plumbing into picker/exits/analytics pure functions — everything else
is "copy the RULE-01 shape."

## Runtime State Inventory

Not applicable — this is not a rename/refactor/migration phase (no renamed identifiers, no
existing runtime state to re-key). Skipped per the trigger condition.

## Common Pitfalls

### Pitfall 1: Most curated knobs have NO existing parameter seam — this is the bulk of the work
**What goes wrong:** Assuming "inject overrides" is a small diff because `weights?` already
exists. It only covers 9 of the ~20 knobs.
**Why it happens:** `weights?` (scoring.ts) and `effectiveDeltaMin?`/`backDteMinGap?`/
`backDteMaxGap?` (candidate-selection.ts) are the ONLY existing seams. Verified NOT injectable
today, each read as a bare module-level constant inside the function body:
- `candidate-selection.ts:320` — `delta > DELTA_BAND_MAX` (hard-coded, no param; `deltaMin` IS
  parametrized via `effectiveDeltaMin` but `DELTA_BAND_MAX` is not)
- `candidate-selection.ts:297` — `tf < FRONT_DTE_MIN || tf > FRONT_DTE_MAX` (zero param)
- `rules.ts` `debitFitFraction(debit)` — reads `DEBIT_IDEAL_MIN/MAX/CHEAP_FLOOR/...` directly,
  single-arg signature, zero param
- `entry-gate.ts` `VIX_LADDER` — a bare exported constant array, consumed directly by
  `resolveEntryGate`, `sizing.ts`'s `SIZING_TIERS` (built at module-load time from it), AND
  `candidate-selection.ts`'s `autoTuneTargetDelta` (via `vixLadderFloor`) — **3 files** read
  this one constant; overriding the ladder cascades to all 3
- `brakes.ts` `maxOpenTripped(openCount)` — reads `MAX_OPEN_CALENDARS` directly, single-arg
- `sizing.ts` `resolveSizingTier(vix)` — reads module-built `SIZING_TIERS` (frozen at import
  time from `DEFAULT_TIER_CONTRACTS`), single-arg — needs a rebuild-with-override path, not
  just a passed-through constant
- `exit-rules.ts` `TAKE_RUNGS`/`STOP_RUNGS` — read directly inside `evalTake`/`evalStop`
  (evaluate-exit.ts), and `evaluateExit(position, context, previousVerdict)` has NO 4th param
  today for rung overrides
- `analytics/domain/regime.ts` — all 4 threshold pairs (`VIX_TERM_STRUCTURE_WARN/_CRISIS`,
  `VVIX_WARN/_CRISIS`, `VIX9D_RATIO_WARN/_CRISIS`, `HY_OAS_WARN/_CRISIS`) are **module-private**
  `const`s, not even exported — the 4 `bandX(value)` functions are single-arg, zero param seam
**How to avoid:** Budget real task-count for ~8 signature changes across `candidate-selection.ts`,
`rules.ts`, `entry-gate.ts`, `brakes.ts`, `sizing.ts`, `evaluate-exit.ts`/`exit-rules.ts`,
`regime.ts` — each following Pattern 1 (optional param, default = current constant). This is
the majority of the phase's engineering effort, not the storage/API/UI shell.
**Warning signs:** A plan that estimates this phase as "1-2 plans" for storage+API+UI without a
dedicated plan (or several tasks) for the merge-seam signature changes is under-scoped.

### Pitfall 2: Exit rung overrides are NOT read at HTTP-request time — they're a worker-job concern
**What goes wrong:** CONTEXT.md's canonical-refs table groups `getExitAdvice`/
`computeExitAdvice` together as "read by server at request time." Only `computeExitAdvice.ts`
actually calls `evaluateExit()` (where `TAKE_RUNGS`/`STOP_RUNGS` are consumed).
`getExitAdvice.ts` (the HTTP GET path) re-joins and re-derives `pnlPct`/staleness from an
ALREADY-PERSISTED `ExitVerdictRow` — it never calls `evaluateExit` again, so it has no rungs to
override.
**Why it happens:** `computeExitAdvice.ts` lives in `packages/core/src/exits/application/` but
is invoked by `apps/worker/src/handlers/` (a **worker job**, chain-triggered right after
`compute-picker`, per `apps/worker/src/handlers/compute-picker.ts:44-48`'s
`boss.send("compute-exit-advice", ...)`), not by a server HTTP handler.
**How to avoid:** Wire `readRuleOverrides` into `ComputeExitAdviceDeps` (worker composition
root, `apps/worker/src/main.ts`), NOT into `GetExitAdviceDeps` (server composition root,
`apps/server/src/main.ts`). A rung change takes effect on the next `compute-exit-advice` cycle
(same cadence as picker), not on the next page load — document this explicitly in the UI copy
if the modal implies instant effect.
**Warning signs:** A plan that adds `readRuleOverrides` to `GetExitAdviceDeps` instead of
`ComputeExitAdviceDeps` — verify by checking which file imports `evaluate-exit.ts`.

### Pitfall 3: Regime bands are NOT worker-computed — CONTEXT.md's framing is imprecise
**What goes wrong:** Building a worker-side merge path for regime bands that never gets called.
**Why it happens:** `getRegimeBoard.ts` (`packages/core/src/analytics/application/`) has no
persisted snapshot table and no worker handler (`[VERIFIED: codebase]` — grepped both
`apps/worker/src` and `apps/server/src` for `getRegimeBoard`/`RegimeBoard`/`compute-regime`;
only `apps/server/src/main.ts` + `adapters/http/analytics.routes.ts` + `adapters/mcp/*`
reference it). It reads the latest `macro_observations` rows and computes bands **live, on
every GET /api/analytics/regime or MCP get_regime call** — server request-time only.
**How to avoid:** Wire `readRuleOverrides` into `GetRegimeBoardDeps` (server composition root
only). This is actually the SIMPLEST of the three engines to wire — no worker job, no
persisted-snapshot staleness concern, changes take effect on the very next read.
**Warning signs:** A plan mentioning a "compute-regime-board" worker job that doesn't exist.

### Pitfall 4: `RULE_SET_METADATA` is stamped verbatim into the picker snapshot today — must switch to effective values
**What goes wrong:** Shipping the override merge but leaving
`computePickerSnapshot.ts:610-617`'s `ruleSet: RULE_SET_METADATA.map(...)` untouched — the
Analyzer's methodology panel would keep showing compile-time weights even when overrides are
live, directly contradicting CONTEXT.md's explicit requirement ("Picker snapshot `ruleSet`
metadata must reflect the EFFECTIVE values used for that run").
**Why it happens:** `RULE_SET_METADATA` is a constant, not derived from the `weights` actually
passed into `scoreCalendarCandidates` at line 513-518 (currently no `weights` field is passed
at all — the ablation seam is unused in the live code path today).
**How to avoid:** Two independent changes at the same call site: (1) pass
`weights: config.weights` into `scoreCalendarCandidates`'s `ScoringParams` (currently omitted);
(2) build the stamped `ruleSet` from `RULE_SET_METADATA.map(rule => ({ ...rule, weight:
config.weights[rule.id] ?? rule.weight }))` instead of the raw constant. Both changes are
additive — `RULE_SET_METADATA` itself (and `rules.test.ts`'s sum-to-100 assertion on it) stays
untouched, since that test asserts the DEFAULTS sum to 100, not the effective/overridden set.
**Warning signs:** A plan that treats "stamp effective ruleSet" as a UI-only concern rather than
a `computePickerSnapshot.ts` change.

### Pitfall 5: Backtest determinism (BT-02) depends on every new param defaulting to today's live constant
**What goes wrong:** `packages/core/src/backtest/reuse-exports.test.ts` imports
`selectCandidates`, `scoreCalendarCandidates`, and several of the exact constants this phase
touches (`GAMMA_FRONT_DTE_MAX`, `ROLL_FRONT_DTE_MAX`, etc. — `[VERIFIED: codebase grep]`) —
the backtest harness (Phase 27) calls these SAME pure functions with NO override params, and
its own leakage-oracle test (BT-02) requires replaying a historical cohort to reproduce the
exact recorded live `picker_snapshot` score. If any new optional param's default silently
differs from the current constant (a typo, an off-by-one, a different rounding), the backtest
oracle breaks silently — a regression that would not surface until someone runs the harness.
**Why it happens:** The whole point of Pattern 1 (optional param defaulting to the existing
constant) is invisible correctness — easy to get subtly wrong (e.g. defaulting `deltaMax` to a
slightly different value than the literal `DELTA_BAND_MAX` reference it replaces).
**How to avoid:** For every new optional param, add (or extend) a unit test asserting "omitting
the param reproduces the exact same output as calling the OLD unparameterized code path" —
mirrors how `weights?` omission is already covered by every existing live-call-site test.
**Warning signs:** Any new default value written as a fresh numeric literal instead of
referencing the existing named constant (e.g. `deltaMax = -0.3` instead of `deltaMax =
DELTA_BAND_MAX`).

### Pitfall 6: Existing tests assert literal constant values — these must NOT need edits
**What goes wrong:** Touching `rules.test.ts`'s `"active score weights sum to exactly 100"`
test, `candidate-selection.test.ts`'s delta-band assertions, `brakes.test.ts`'s
`MAX_OPEN_CALENDARS` assertions, or `evaluate-exit.test.ts`'s rung assertions while adding the
override seam.
**Why it happens:** These tests import and assert against the COMPILE-TIME constants
(`RULE_SET_METADATA`, `DELTA_BAND_MIN`, `MAX_OPEN_CALENDARS`, `TAKE_RUNGS`) directly —
`[VERIFIED: codebase grep]` confirmed these constants are still referenced by
`rules.test.ts`, `candidate-selection.test.ts`, `brakes.test.ts`, `backtest/reuse-exports.test.ts`,
`exit-rules.test.ts`, `evaluate-exit.test.ts`. Since this phase's design keeps the constants as
the DEFAULTS (never deletes/renames them — CONTEXT.md's Governance override explicitly says
"the constants remain the DEFAULTS"), these tests should stay green with ZERO edits if the
optional-param pattern is followed correctly.
**How to avoid:** Treat "all pre-existing tests pass unmodified" as a hard acceptance criterion
for the merge-seam plumbing tasks — any pre-existing test that needs editing to pass is a signal
the default value diverged from the constant it replaces (see Pitfall 5).

### Pitfall 7: Worker env validation gotcha (recurring project-wide issue, not new to this phase)
**What goes wrong:** Running `bun run migrate` locally to apply the new migration fails if
`SIDECAR_URL` (and other worker-only env vars) aren't set, because `bootWorkerConfig()`
Zod-validates the FULL worker env before running the migration, even though the migration
itself only needs `DATABASE_URL`.
**Why it happens:** `apps/worker/src/migrate.ts` calls `bootWorkerConfig()` (validates ALL
worker env) before `runMigrations(config.DATABASE_URL)` — a known project-wide gotcha, already
logged in project memory (Phase 13 COT complete note) and expected to recur here.
**How to avoid:** Ensure local `.env`/shell has the full worker env set before running the
migration for this phase's new `rule_overrides` table, or use a testcontainer-applied migration
for TDD (Postgres repos rule: "testcontainers against real Postgres, SQL is never mocked").

## Code Examples

### The exact merge-seam precedent to replicate (already live)
```typescript
// Source: packages/core/src/picker/domain/scoring.ts:96-101 (verified in this session)
export type ScoringParams = {
  readonly r: number;
  readonly q: number;
  readonly realizedVol20?: number | null;
  readonly slopeHistory?: ReadonlyArray<number>;
  readonly weights?: Partial<Record<BreakdownCriterion, number>>;
};
// ...consumed inside scoreOne() at line 116-124:
const wSlope = params.weights?.slope ?? WEIGHT_SLOPE;
const wFwdEdge = params.weights?.fwdEdge ?? WEIGHT_FWD_EDGE;
// ...ETC — every override param follows: params.override?.field ?? CONSTANT
```

### The exact single-row storage precedent to replicate
```typescript
// Source: packages/adapters/src/postgres/schema.ts:218-241 (broker_tokens, verified)
// Fixed natural-key convention for a "one logical row per key" table — no DB CHECK,
// enforced by application convention. Mirror this for rule_overrides using a fixed
// literal key (e.g. id: "default") instead of appId.
export const brokerTokens = pgTable("broker_tokens", {
  appId: text("app_id").primaryKey(),
  // ...
}).enableRLS();
```

### The exact repo pattern to replicate (postgres + memory twin, single JSONB blob)
```typescript
// Source: packages/adapters/src/postgres/repos/calendar-event-annotations.ts (verified)
// upsertAnnotation uses onConflictDoUpdate (mutable, unlike append-only picker_snapshot) —
// rule_overrides needs the SAME onConflictDoUpdate shape (settings are editable anytime,
// not append-history).
const upsertAnnotation: UpsertAnnotation = async (input) => {
  const rows = await db
    .insert(calendarEventAnnotations)
    .values({ /* ... */ })
    .onConflictDoUpdate({ target: calendarEventAnnotations.fillIdsHash, set: { /* ... */ } })
    .returning();
  // ...
};
```

### The exact route+MCP pair to replicate
```typescript
// Source: apps/server/src/adapters/http/journal-rules.routes.ts (verified) — GET/PUT pair,
// zValidator("json", requestSchema) on PUT, contract.parse() on every response.
// Source: apps/server/src/adapters/mcp/server.ts:158-165 (verified) — optional-param MCP
// tool registration, gated by `if (x !== undefined) registerXTool(server, x)`.
```

### The exact web hook + modal trigger to replicate
```typescript
// Source: apps/web/src/hooks/useRuleTags.ts (verified) — useQuery + non-optimistic mutation
// + queryClient.invalidateQueries on success + per-key error map.
// Source: apps/web/src/screens/Overview.tsx:1205-1215 (verified) — Dialog/DialogTrigger/
// DialogContent composition already live for "Exit rules ▸"; the gear icon in Shell.tsx
// follows the identical shape, just relocated to the top bar and grouped by engine.
```

## State of the Art

Not applicable — no external ecosystem shift, this is a same-repo pattern replication.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The event-calendar bucket's `EVENT_SCORE_WEIGHTS` (rules.ts, proportionally derived from the 9 primary weights) stays derived from the COMPILE-TIME `WEIGHT_*` constants, not the runtime-merged overrides — CONTEXT.md's curated knob list does not mention the event bucket at all | Standard Stack / Pattern 1 scope | Low — if wrong, the event-calendar bucket (PLAY-04) silently ignores weight overrides the primary bucket honors; a one-line follow-up (`EVENT_SCORE_WEIGHTS` derivation from `config.weights` instead of the constants) fixes it later without a migration |
| A2 | Single-row storage uses a fixed natural-key literal (mirrors `broker_tokens.appId`) rather than a boolean-PK-with-CHECK singleton trick | Recommended Project Structure / Anti-Patterns | Low — purely a naming/DDL choice, Claude's-discretion per CONTEXT.md, either works |
| A3 | `resolveEntryGate`'s hysteresis rung arm/disarm values (`VIX_BLOCK_ARM`/`VIX_PENALTY_FLOOR`/etc.) stay code-only — only the 4 `VIX_LADDER` tier BOUNDARIES (0/15/20/25) become overridable, matching CONTEXT.md's literal scope ("VIX ladder tier boundaries") | Pitfall 1 | Medium — if the user actually wants the hysteresis arm/disarm values editable too, the gate's flap-protection logic needs the same treatment; CONTEXT.md's Excluded Knobs list explicitly names "gate hysteresis internals (GATE_PENALTY_FLOOR_MULTIPLIER, GATE_BLIND_MAX_BIZDAYS)" as excluded, which supports this reading, but `VIX_BLOCK_ARM`/`VIX_PENALTY_FLOOR` themselves aren't explicitly named either way |

## Open Questions

1. **Does overriding the VIX ladder tier boundaries also change the penalty-band floor/ceiling used by `bandMultiplier` in `entry-gate.ts`?**
   - What we know: `VIX_PENALTY_FLOOR` is currently re-declared as a separate constant (`= 20`, same value as the "elevated" tier's start) rather than derived from `VIX_LADDER`, per its own comment ("Same value VIX_LADDER's 'elevated' tier starts at").
   - What's unclear: If a user overrides the ladder's elevated-tier boundary to something other than 20, should the penalty floor silently stay at 20 (drift) or track the override?
   - Recommendation: Keep them independent for this phase (ladder boundaries are curated/editable; `VIX_PENALTY_FLOOR`/`VIX_BLOCK_ARM` are excluded/code-only per CONTEXT.md) — but flag the drift possibility in the modal's copy or docs so the user understands editing the ladder tiers does NOT move the gate's penalty/block arm points.

2. **PUT semantics for "reset to defaults per group" — full-group delete vs per-key null?**
   - What we know: CONTEXT.md locks the requirement ("Reset to defaults per group = delete those override keys") but leaves the exact wire shape to Claude's discretion.
   - What's unclear: Whether the PUT contract should support `{ picker: null }` (delete the whole group) vs. requiring the client to enumerate every key to unset.
   - Recommendation: Support `{ groupName: null }` as "delete this entire group's overrides" — simplest client code (one button per group), matches CONTEXT.md's literal "per group" phrasing.

## Environment Availability

Skipped — this phase has no new external dependencies (all packages already installed; DB is
already provisioned; no new services).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace) + fast-check (property tests) + testcontainers (Postgres repos) + msw (not needed — no external HTTP in this phase) |
| Config file | root `vitest.config.ts` / workspace configs (pre-existing) |
| Quick run command | `bun run test --filter <touched-package>` (or `bunx vitest run <path>` for a single file) |
| Full suite command | `bun run test` |

### Phase Requirement → Test Map (this phase has no REQUIREMENTS.md IDs; scope is CONTEXT.md-defined)
| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|-------------|
| `resolvePickerRuleConfig` merges overrides ⊆ whitelist, idempotent, omission reproduces defaults byte-identically | unit + fast-check property | `bunx vitest run packages/core/src/picker/domain/rule-config.test.ts` | ❌ Wave 0 |
| `resolveExitRuleConfig` enforces hysteresis pair validation (disarm < arm for TAKE, disarm-magnitude < arm-magnitude for STOP) | unit + fast-check property | `bunx vitest run packages/core/src/exits/domain/rule-config.test.ts` | ❌ Wave 0 |
| `resolveRegimeRuleConfig` merges 4 threshold pairs, omission reproduces `regime.ts` defaults | unit | `bunx vitest run packages/core/src/analytics/domain/rule-config.test.ts` | ❌ Wave 0 |
| Weight-sum-to-100 invariant enforced (hard validation OR normalized — pick one) on write | unit | `bunx vitest run packages/contracts/src/rule-settings.test.ts` | ❌ Wave 0 |
| `rule_overrides` Postgres repo: upsert/read/delete-key round trip | contract test (testcontainers) | `bunx vitest run packages/adapters/src/postgres/repos/rule-overrides.contract.test.ts` | ❌ Wave 0 |
| `rule_overrides` memory twin matches Postgres repo contract | contract test | `bunx vitest run packages/adapters/src/memory/rule-overrides.contract.test.ts` | ❌ Wave 0 |
| GET/PUT `/api/settings/rules` route — auth-gated, Zod-validated, whitelist-rejects unknown keys | route test (msw not needed, direct Hono test) | `bunx vitest run apps/server/src/adapters/http/settings.routes.test.ts` | ❌ Wave 0 |
| MCP `get_rule_settings`/`set_rule_overrides` tools share the same contract | MCP test | `bunx vitest run apps/server/src/adapters/mcp/mcp.test.ts` (extend existing) | ✅ (extend existing file) |
| `computePickerSnapshot` stamps EFFECTIVE weights in `ruleSet`, not compile-time `RULE_SET_METADATA`, when overrides present | unit (extend existing) | `bunx vitest run packages/core/src/picker/application/computePickerSnapshot.test.ts` | ✅ (extend existing file) |
| `computeExitAdvice` reads overrides fresh each run; omission reproduces today's rungs byte-identically | unit (extend existing) | `bunx vitest run packages/core/src/exits/application/computeExitAdvice.test.ts` | ✅ (extend existing file) |
| Every pre-existing test (`rules.test.ts`, `candidate-selection.test.ts`, `brakes.test.ts`, `evaluate-exit.test.ts`, `backtest/reuse-exports.test.ts`) passes UNMODIFIED (Pitfall 5/6 regression gate) | full suite | `bun run test` | ✅ (regression gate, no new file) |
| `RuleSettingsModal` renders 3 groups, shows effective vs default when overridden, reset-per-group button works | component test | `bunx vitest run apps/web/src/screens/RuleSettingsModal.test.tsx` | ❌ Wave 0 |
| `useRuleSettings` hook: query + mutation + invalidate, mirrors `useRuleTags` test shape | hook test | `bunx vitest run apps/web/src/hooks/useRuleSettings.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `bunx vitest run <touched file>`
- **Per wave merge:** `bun run test` (full workspace)
- **Phase gate:** Full suite green + `bun run typecheck && bun run lint` before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/core/src/picker/domain/rule-config.test.ts` — new file, covers `resolvePickerRuleConfig`
- [ ] `packages/core/src/exits/domain/rule-config.test.ts` — new file, covers `resolveExitRuleConfig` + hysteresis pair validation
- [ ] `packages/core/src/analytics/domain/rule-config.test.ts` — new file, covers `resolveRegimeRuleConfig`
- [ ] `packages/contracts/src/rule-settings.test.ts` — new file, Zod schema + weight-sum invariant
- [ ] `packages/adapters/src/postgres/repos/rule-overrides.contract.test.ts` + `packages/adapters/src/memory/rule-overrides.contract.test.ts` — testcontainers + memory twin, mirrors `calendar-event-annotations.contract.test.ts`
- [ ] `apps/server/src/adapters/http/settings.routes.test.ts` — new file, mirrors `journal-rules.routes.test.ts`
- [ ] `apps/web/src/hooks/useRuleSettings.test.ts` + `apps/web/src/screens/RuleSettingsModal.test.tsx` — new files
- Framework install: none — Vitest/fast-check/testcontainers/msw all already configured workspace-wide

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | Existing Supabase JWT `authReadGroup` middleware (`apps/server/src/main.ts:393-395`) — mount the new settings route inside `apiRouter`, same as `journalRulesRoutes` |
| V3 Session Management | no (delegated to existing Supabase JWT infra, out of this phase's scope) | — |
| V4 Access Control | yes | Single-user system (bearer/JWT-gated only, no roles) — same posture as every other authed route in this repo; no new access-control surface |
| V5 Input Validation | yes | Zod schema on the overrides PUT body — whitelist unknown keys (reject, don't silently drop, per CONTEXT.md "invalid/unknown keys rejected at API boundary"); hysteresis pair validation (disarm < arm) enforced server-side, never trust client-computed pairs |
| V6 Cryptography | no | No secrets/tokens in this table — plain numeric knob overrides, no encryption needed (unlike `broker_tokens`) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Malformed/partial overrides object silently corrupting scoring (e.g. a weight override that breaks sum-to-100 without detection) | Tampering | Zod `.refine()` at the contract boundary enforcing the weight-sum invariant (hard-reject OR normalize — pick one per CONTEXT.md's Claude's-discretion note, document the choice) |
| Hysteresis pair inversion (disarm > arm) silently breaking the exit advisor's flap protection | Tampering | Zod `.refine()` cross-field validation on the rung pair, mirrors D-21's "OTHER-requires-note" refine precedent in `journal-rules.ts` |
| Unauthenticated write to the overrides row | Tampering / Elevation of Privilege | Route mounted inside `authReadGroup` (JWT-gated), same as every other mutating route in this repo (`journalRulesRoutes` precedent) |
| Unknown/typo'd override key silently ignored (user thinks they changed a knob, nothing happens) | Tampering (data integrity) | Zod schema REJECTS unknown keys (not `.passthrough()`) — CONTEXT.md explicitly requires this |

## Sources

### Primary (HIGH confidence — direct codebase reads this session)
- `packages/core/src/picker/domain/rules.ts`, `candidate-selection.ts`, `scoring.ts`, `entry-gate.ts`, `brakes.ts`, `sizing.ts` — full read, current constants + seams
- `packages/core/src/exits/domain/exit-rules.ts`, `evaluate-exit.ts` — full read, rung consumption
- `packages/core/src/analytics/domain/regime.ts`, `application/getRegimeBoard.ts` — full read, band function signatures + call sites
- `packages/core/src/picker/application/computePickerSnapshot.ts` — full read, `ruleSet` stamping call site
- `packages/core/src/exits/application/computeExitAdvice.ts`, `getExitAdvice.ts` — full read, confirms which use-case actually calls `evaluateExit`
- `apps/worker/src/handlers/compute-picker.ts`, `apps/worker/src/main.ts` (composition root excerpts) — confirms worker job chaining + deps wiring pattern
- `apps/server/src/main.ts`, `adapters/mcp/server.ts`, `adapters/http/journal-rules.routes.ts` — full read, route/MCP/composition-root pattern
- `packages/adapters/src/postgres/schema.ts`, `repos/calendar-event-annotations.ts`, `memory/calendar-event-annotations.ts`, migrations 0017/0021 — full read, storage pattern precedent
- `apps/web/src/components/Shell.tsx`, `components/ui/dialog.tsx`, `components/system/{Button,index}.tsx`, `hooks/useRuleTags.ts`, `hooks/useLifecycle.ts`, `screens/ExitRulesPanel.tsx`, `screens/Overview.tsx` (Dialog usage) — full read, web pattern precedent
- `.planning/phases/29-.../29-CONTEXT.md` — locked decisions, canonical refs, excluded knobs

### Secondary (MEDIUM confidence)
- none — all findings verified directly against this session's file reads, no external doc lookups were needed (zero new dependencies, zero external APIs)

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, every tool already installed and in active use
- Architecture: HIGH — every pattern cited has a live, working precedent in this exact repo read this session
- Pitfalls: HIGH — each pitfall is a direct grep/read finding (missing param seams, worker-vs-server confusion, test literal-value assertions), not speculation

**Research date:** 2026-07-09
**Valid until:** No external time pressure — internal-codebase research stays valid until the
touched files (`rules.ts`, `candidate-selection.ts`, `entry-gate.ts`, `brakes.ts`, `sizing.ts`,
`exit-rules.ts`, `evaluate-exit.ts`, `regime.ts`, `computePickerSnapshot.ts`,
`computeExitAdvice.ts`, `getRegimeBoard.ts`) are next modified by another phase.
