# Phase 29: Runtime Rule Settings - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Source:** Interactive discussion with user (conversation, 2026-07-09) — decisions captured directly; equivalent to discuss-phase output.

<domain>
## Phase Boundary

Make the currently hard-coded trading rule thresholds adjustable at runtime through a
settings UI. Three rule engines are affected: entry/picker rules, exit advisor rules, and
analyzer regime bands. A curated subset (~20 knobs) becomes runtime-editable; everything
else stays compile-time constants in `packages/core`.

Delivers:
- Persistence for rule overrides (new table + migration)
- Core port + merge semantics (overrides over code defaults)
- API endpoints to read/update overrides
- Worker (compute-picker) and server (exit advice) read merged config at run/request time
- Gear icon in the top nav bar (`apps/web/src/components/Shell.tsx`, same bar as
  Overview/Analyzer/Journal, top right) opening a settings modal, grouped by engine,
  with reset-to-defaults per group

NOT in scope: editing rules per-calendar, rule versioning UI, backtest parameter sweeps,
exposing every constant (see Excluded Knobs).
</domain>

<decisions>
## Implementation Decisions

### Knob scope (USER LOCKED — "Curated set")
Expose ~20 high-level knobs, grouped by engine:

**Entry/picker** (all read by worker compute-picker):
- Delta band: `DELTA_BAND_MIN=-0.49`, `DELTA_BAND_MAX=-0.3` (`packages/core/src/picker/domain/candidate-selection.ts:52-53`)
- DTE windows: `FRONT_DTE_MIN=21`, `FRONT_DTE_MAX=36`, `BACK_DTE_MIN_GAP=15`, `BACK_DTE_MAX_GAP=90` (`candidate-selection.ts:60-68`)
- 9 scoring weights (must sum 100): `WEIGHT_SLOPE=10`, `WEIGHT_FWD_EDGE=25`, `WEIGHT_GEX_FIT=10`, `WEIGHT_EVENT=5`, `WEIGHT_BE_VS_EM=15`, `WEIGHT_DELTA_NEUTRAL=15`, `WEIGHT_THETA_VEGA=10`, `WEIGHT_VRP=5`, `WEIGHT_DEBIT_FIT=5` (`packages/core/src/picker/domain/rules.ts:27-43`)
- debitFit band: `DEBIT_IDEAL_MIN=3200`, `DEBIT_IDEAL_MAX=5000` (`rules.ts:44-45`)
- VIX ladder tier boundaries: 0/15/20/25 → low/normal/elevated/crisis (`packages/core/src/picker/domain/entry-gate.ts:36-41`)
- Max open calendars: `MAX_OPEN_CALENDARS=6` (`packages/core/src/picker/domain/brakes.ts:23`)
- Sizing tier contracts: `DEFAULT_TIER_CONTRACTS {low:2, normal:2, elevated:1, crisis:0}` (`packages/core/src/picker/domain/sizing.ts:36-57`)

**Exit advisor** (read by server at request time — getExitAdvice/computeExitAdvice):
- TAKE rungs: +15%/+10%/+5% with arm/disarm pairs (`packages/core/src/exits/domain/exit-rules.ts:121-125`)
- STOP rungs: −50%/−25% with arm/disarm pairs (`exit-rules.ts:128-131`)

**Analyzer regime bands** (worker computes, web displays):
- `VIX_TERM_STRUCTURE_WARN=0.9`/`_CRISIS=0.95`, `VVIX_WARN=100`/`_CRISIS=115`, `VIX9D_RATIO_WARN=1.0`/`_CRISIS=1.1`, `HY_OAS_WARN=3.0`/`_CRISIS=5.0` (`packages/core/src/analytics/domain/regime.ts`)

### Excluded knobs (USER LOCKED — stay code-only)
Normalizers (SLOPE_NORMALIZER etc.), event penalties, gexFit credits, liquidity gate
internals, fill haircut, event blackout windows, gate hysteresis internals
(GATE_PENALTY_FLOOR_MULTIPLIER, GATE_BLIND_MAX_BIZDAYS), loss cooldown, roll windows,
staleness tolerance, exit-plan defaults baked into candidates (scoring.ts:69-71).

### Storage (USER APPROVED shape)
- Single JSONB overrides row — store ONLY deltas over code defaults, not full config.
- Zod-parsed on read; invalid/unknown keys rejected at API boundary.
- Merge at consumption time: worker merges at job start (compute-picker), server merges at
  request time (exit advice). Code defaults remain the source of truth for anything unset.
- "Reset to defaults" per group = delete those override keys.

### Hysteresis pairs (USER LOCKED)
Arm/disarm pairs (TAKE/STOP rung arm+disarm) are edited as validated pairs — validation
enforces disarm < arm (for TAKE) / disarm > arm magnitude relationships so a user cannot
break hysteresis. Single-sided edits rejected.

### UI (USER LOCKED)
- Gear icon top-right in the existing top bar (`Shell.tsx`, `NAV_TABS` bar with
  Overview/Analyzer/Journal).
- Modal grouped by engine: Entry/Picker · Exit Advisor · Regime Bands.
- Reset-to-defaults per group.
- Show current effective value + default value when overridden (so user sees drift from
  baseline).
- Use shared `<Button>` primitive (`apps/web/src/components/system/Button.tsx`).

### Governance override (USER APPROVED 2026-07-09)
This phase overrides Phase 28 decision T-28-11 ("constants file is the visible,
user-editable source of truth — never a hidden default or a UI config screen"). The
constants remain the DEFAULTS; the overrides row is an explicit, visible layer on top.
Record this in phase docs.

### Claude's Discretion
- Table/column naming, migration number (next in sequence after 0021)
- Zod schema shape for the overrides object; contract naming
- Whether scoring-weight sum-to-100 is enforced as hard validation or normalized server-side (pick one, document)
- Route paths + MCP exposure (follow existing route/MCP patterns)
- How the worker fetches overrides (direct adapter read at job start — follow existing port/adapter pattern)
- Modal component structure; form state management consistent with existing web patterns
- Where merged-config resolution lives in core (pure function taking defaults + overrides)
- Audit trail: picker snapshots already stamp `ruleSet` metadata; extend if cheap, don't build new history UI
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Rule constants (source of the curated knobs + defaults)
- `packages/core/src/picker/domain/rules.ts` — scoring weights, debitFit band, RULE_SET_METADATA
- `packages/core/src/picker/domain/candidate-selection.ts` — delta band, DTE windows
- `packages/core/src/picker/domain/entry-gate.ts` — VIX ladder, gate hysteresis (ladder editable; hysteresis internals NOT)
- `packages/core/src/picker/domain/brakes.ts` — MAX_OPEN_CALENDARS
- `packages/core/src/picker/domain/sizing.ts` — sizing tiers (note T-28-11 comment at :12-13)
- `packages/core/src/picker/domain/scoring.ts` — unused `weights?` seam at :100 (SelectCandidatesParams) — ready-made injection point
- `packages/core/src/exits/domain/exit-rules.ts` — TAKE/STOP rungs, EXIT_PRECEDENCE
- `packages/core/src/analytics/domain/regime.ts` — regime warn/crisis bands

### Consumption paths (where merge must happen)
- `apps/worker/src/handlers/compute-picker.ts` → `packages/core/src/picker/application/computePickerSnapshot.ts` (worker read path)
- Exit advice use-cases in `packages/core/src/exits/application/` + server exits route (server read path)

### Patterns to follow
- `packages/adapters/src/postgres/schema.ts` — 22 existing pgTable definitions; add overrides table here
- Existing migrations `packages/adapters` 0000–0021 (next = 0022)
- Existing Hono routes in `apps/server` + MCP tool registration (follow get_cot/set_rule_tags shape for GET/PUT pair)
- `apps/web/src/components/Shell.tsx` — top bar, NAV_TABS (gear icon goes here)
- `apps/web/src/screens/ExitRulesPanel.tsx` — existing modal/panel pattern
- `apps/web/src/components/system/Button.tsx` — shared Button primitive (Phase 21)
- `.claude/rules/architecture-boundaries.md`, `.claude/rules/tdd.md`, `.claude/rules/typescript.md` — hexagon law, red→green, no any/as/!

### Architecture docs (update-first rule)
- `docs/architecture/stack-decisions.md` — new table requires doc update BEFORE implementation (workflow rule "Docs Before Code")
</canonical_refs>

<specifics>
## Specific Ideas

- Effective-config resolution must be a pure core function: `resolveRuleConfig(defaults, overrides) → RuleConfig`, unit-tested with fast-check property tests (overrides ⊆ knob whitelist, merge idempotent).
- API: GET returns { defaults, overrides, effective }; PUT accepts partial overrides, validates, returns new effective. DELETE (or PUT with nulls) clears keys for reset-per-group.
- Worker must not cache overrides across job runs — read fresh at each compute-picker run so a mid-day change takes effect next cycle.
- Picker snapshot `ruleSet` metadata must reflect the EFFECTIVE values used for that run (it already serializes rule metadata — verify overridden values flow into it, not the compile-time constants).
- Weight sum validation: the 9 scoring weights sum to 100 today; keep that invariant explicit.
</specifics>

<deferred>
## Deferred Ideas

- Per-calendar rule overrides
- Override history / versioning UI (audit beyond existing snapshot ruleSet stamps)
- Backtest parameter sweeps driven by the same overrides mechanism (natural follow-up for PICK-04 harness)
- Exposing excluded knobs (normalizers, penalties, hysteresis internals)
</deferred>

---

*Phase: 29-runtime-rule-settings*
*Context gathered: 2026-07-09 via interactive discussion (user-locked decisions recorded verbatim)*
