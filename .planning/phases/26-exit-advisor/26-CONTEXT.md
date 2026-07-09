# Phase 26: Exit Advisor - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Source:** User-locked milestone kickoff decisions + REQUIREMENTS EXIT-01..10 + .planning/research/SUMMARY.md (ARCHITECTURE component 1-2)

<domain>
## Phase Boundary

Every open calendar gets ONE clear, explainable verdict each picker cycle — HOLD / TAKE
(+5/+10/+15% rung) / STOP (−25/−50%) / ROLL / EXIT-pre-event — from the user's own playbook
ladder. New `exits` bounded context (sibling to `picker`), `exit_verdicts` append-history
table, `compute-exit-advice` terminal job, HTTP route + MCP tool, Analyzer held-positions
panel. The advisor ONLY advises — never places/modifies orders (STRM-04). Requirements
EXIT-01..EXIT-10.

</domain>

<decisions>
## Implementation Decisions

### Table + keying (USER-LOCKED)
- Table name `exit_verdicts`, keyed `(observed_at, calendar_id)`, `onConflictDoNothing` —
  first-write-wins on the cohort clock, the proven `picker_snapshot` convention at
  per-calendar grain. Append-only history. Migration 0020 (next free number).

### Bounded context (USER-LOCKED, research-confirmed)
- New `exits` context sibling to `picker`, in the mould of `analytics`: reads
  position/mark/greeks/P&L from `journal`, GEX from `analytics`, events from `picker` — all
  through its OWN application ports (never a foreign `domain/` import); owns the exit-rule
  registry + `evaluateExit(position, context)` pure function; writes verdicts, never mutates
  journal. Hexagon law: core imports shared only.

### The playbook ladder (USER-LOCKED thresholds — encode EXACTLY, no re-derivation)
- TAKE rungs: +5% / +10% / +15% profit on the fill-ledger basis (verdict names the rung).
- STOP rungs: −25% / −50%.
- TERM trigger: live front−back IV inversion ≥ 0.5pp (front IV − back IV ≥ 0.005 in IV
  points) → exit signal.
- GAMMA trigger: spot > 2% off strike AND front < 7 DTE.
- EVT trigger: tier-1 event (FOMC/CPI/NFP) ≤ 3 days from front expiry → EXIT-pre-event
  (mirrors the picker's exitPlan.closeByExpiry stamp — day BEFORE the event).
- ROLL: front < 14 DTE AND spot within ±1% of strike AND profit < 15% AND no blocking event
  → suggest haircut-priced replacement front (+14–21 DTE), priced with the SAME ORATS
  66%-width fill haircut the picker uses.
- Registry mirrors `rules.ts` style: typed rows with id, kind, formula, rationale, source;
  ships to UI as ruleSet (entry-methodology symmetry, EXIT-07).

### P&L basis (USER-LOCKED — money-code boundary)
- Verdict %-P&L derives from the VALIDATED journal fill-ledger basis (openNetDebit etc.) +
  latest calendar snapshot netMark — NEVER a recomputed parallel P&L. READ-ONLY on all
  journal tables. Any change to fill/event/P&L computation itself = out of scope, stop and
  ask the user.
- No confidence percentages, no probabilities — verdict + rule id + raw metric only
  (EXIT-04; "no fabricated precision at n=13").

### Gating + hysteresis (USER-LOCKED)
- Session/staleness-gated: verdicts computed on AH marks or stale/gap snapshot rows are
  INDICATIVE (display-labeled, never actionable STOP/TAKE alerts). Phase 25's freshness gate
  means new snapshots are clean; still gate on snapshot age + marketSession.
- Hysteresis banding: arm TAKE at +5%, don't flap it off below until profit < +3%; same
  pattern for STOP rungs (documented constants). No verdict flapping cycle-to-cycle on
  noise. Exact hysteresis constants: Claude's discretion, documented + tested.

### Job + alerts (USER-LOCKED)
- `compute-exit-advice` = thin terminal pg-boss handler chained after `compute-picker`
  (single-trigger chain convention). No new cron.
- EXIT-09: only verdict CHANGES surface as alerts; STOP and EXIT-pre-event escalate
  distinctly (visual escalation in UI; no external notification system this phase unless one
  already exists — follow existing alert/badge conventions from WATCH-01).
- EXIT-10: advisor NEVER executes. No order-entry code anywhere.

### Surfaces
- HTTP `GET /api/exits` (or /analytics/exits — follow existing route family conventions) +
  MCP `get_exit_advice` answering "what should I do with my open calendars?" with the same
  verdict payloads (MCP-02 parity).
- Analyzer held-positions panel: per-calendar verdict chips + exit ruleSet rendered from the
  engine payload (EXIT-07). UI phase → needs UI-SPEC (MetricChip/Button system language,
  Analyzer conventions).

### Testing
- TDD red→green; testcontainers for the new repo + twin parity same PR (rule 8); fast-check
  for ladder/hysteresis boundary properties; distinct timestamps in fixtures (green-suite
  lesson).

### Claude's Discretion
- Exact hysteresis constants + naming.
- Verdict priority ordering when multiple rules fire simultaneously (e.g. STOP beats TAKE
  beats ROLL beats HOLD; EVT/TERM/GAMMA placement) — document the precedence ladder in the
  registry doc; research practitioner norms; encode ONE deterministic order.
- Alert surface mechanics (badge/chip conventions).
- Whether exit rules doc lives as docs/architecture/exit-rules.md mirroring picker-rules.md
  (recommended).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Patterns to mirror
- `packages/core/src/picker/` — the sibling context to mirror (domain/rules.ts registry,
  application ports, candidate-selection)
- `packages/adapters/src/postgres/repos/picker-snapshot.ts` — the idempotency convention
  (observed_at keying, onConflictDoNothing)
- `apps/worker/src/handlers/compute-picker.ts` — terminal chained handler pattern
- `docs/architecture/picker-rules.md` — the registry-doc format to mirror
- `packages/core/src/journal/` — P&L ledger read surface (openNetDebit, fill ledger)
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — latest-snapshot read
- `apps/server/src/adapters/mcp/tools.ts` + `apps/server/src/adapters/http/` — surface patterns
- `apps/web/src/screens/Analyzer.tsx` — target screen + scorecard/methodology panel patterns

### Requirements + research
- `.planning/REQUIREMENTS.md` EXIT-01..10 (exact trigger thresholds live there)
- `.planning/research/SUMMARY.md` — architecture components 1-2, pitfalls 5-6 (flapping,
  AH/gap gating), FEATURES exit-advisor rows
- `docs/architecture/jobs.md` — job chain to extend

</canonical_refs>

<specifics>
## Specific Ideas

- Verdict payload idea: { calendarId, observedAt, verdict, rung?, ruleId, metric: {name,
  value, threshold}, indicative: boolean, marketSession, pnlPct, basis: {openNetDebit,
  netMark}, roll?: {suggestedFrontExpiry, estDebit} } — Zod both ways.
- Migration 0020_exit_verdicts.sql.
- Priority question for researcher: practitioner-documented verdict precedence (risk
  triggers before profit-taking).

</specifics>

<deferred>
## Deferred Ideas

- Auto roll-order construction (order-entry boundary) — permanent defer.
- Tick-level re-evaluation — contradicts STRM-04 + 30-min cadence.
- External notifications (push/email) — only if an existing surface exists; else defer.
- Backtest of exit rules → Phase 27.

</deferred>

---

*Phase: 26-exit-advisor*
*Context gathered: 2026-07-09 from user-locked milestone decisions*
