# Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 20-stream-watchdog-event-snapshot-strategy-rules
**Areas discussed:** WATCH-01 badge model, SNAP-01 detect + trigger, RULE-01 taxonomy, RULE-01 attach + capture UX (+ follow-on rounds: cold-start, provenance, adapter surface, multiplicity, gating/direction, backfill, STALLED affordance, sequencing, UI-SPEC scope, STALLED tone, OTHER value, review view)

---

## WATCH-01 — Badge state model

| Option | Description | Selected |
|--------|-------------|----------|
| QUIET = market closed | LIVE=RTH+ticks; QUIET=outside RTH/weekend/holiday (benign); STALLED=RTH ticks frozen OR transport dead (folded) | ✓ |
| QUIET = RTH idle tape | Distinct healthy-but-idle RTH state; STALLED only when heartbeat also gone | |
| 4 states (add DISCONNECTED) | Keep transport-disconnect visible as its own 4th state | |

**User's choice:** QUIET = market closed
**Notes:** At ~1/sec SPX cadence an "RTH but no ticks" moment ≈ something broken; folding transport-dead + silent-stall into one STALLED is the honest, requirement-matching read (3 states).

## WATCH-01 — Stall threshold

| Option | Description | Selected |
|--------|-------------|----------|
| ~20s | 20× the ~1/sec cadence — unmistakable stall, near-zero false positives | ✓ |
| ~10s | Faster warn, closer to jitter, flap risk | |
| ~60s | Very conservative, a full minute of frozen data shows LIVE first | |

**User's choice:** ~20s
**Notes:** Tunable constant; ticks resume → instant flip back to LIVE.

## WATCH-01 — Client RTH source

| Option | Description | Selected |
|--------|-------------|----------|
| Replicate Intl check in web | ~8-line America/New_York check client-side, zero deps | |
| Server sends RTH/market state | Add market-open + RTH flag to the stream (ping/reconcile) | ✓ |
| You decide | Pragmatic client-side check, escalate if holidays unreliable | |

**User's choice:** Server sends RTH/market state
**Notes:** Client authoritative-from-server; heartbeat does double duty (transport liveness + RTH truth). Additive to contract + sidecar/server fan-out; wires the ignored client `ping`.

## SNAP-01 — Detection locus

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side (headless) | Detect where ticks flow server-side, ad-hoc boss.send | ✓ |
| Browser-side | Detect on the SSE tick client renders, POST to enqueue | |
| You decide | Reliable server-side; research pins exact process | |

**User's choice:** Server-side (headless)
**Notes:** A journaling feature must not depend on a tab being open.

## SNAP-01 — Move metric

| Option | Description | Selected |
|--------|-------------|----------|
| % over rolling window | ≥~1% within ~5min; catches fast spikes not slow drift | ✓ |
| % deviation from last snapshot | vs spot at last capture; misses spike-and-return | |
| Absolute points | ≥N pts; meaning drifts with index level | |

**User's choice:** % over rolling window
**Notes:** Exact %/window = tunable constants for research.

## SNAP-01 — Debounce

| Option | Description | Selected |
|--------|-------------|----------|
| Cooldown vs any snapshot | Suppress if ANY snapshot (scheduled/supplemental) in last ~15min | ✓ |
| Cooldown vs supplemental only | ~15min counting only prior supplementals | |
| You decide | Conservative, vs last snapshot of any kind | |

**User's choice:** Cooldown vs any snapshot
**Notes:** At most one supplemental between 30-min scheduled runs.

## RULE-01 — Enum shape

| Option | Description | Selected |
|--------|-------------|----------|
| 3 enums keyed to event type | ENTER/EXIT/ROLL each attach to OPEN/CLOSE/ROLL | ✓ |
| One flat rule enum | Single vocabulary on any event | |
| Category + specific (2-level) | Coarse category + specific rule | |

**User's choice:** 3 enums keyed to event type
**Notes:** Mirrors the existing OPEN/CLOSE/ROLL model; prevents nonsense combos.

## RULE-01 — Rule vocabulary source

| Option | Description | Selected |
|--------|-------------|----------|
| Research proposes, you trim | Starter set from calendar_spread + trade_management KB, user edits before lock | ✓ |
| You dictate now | User lists exact values now | |
| Point to a doc | Source enum from a named trading-plan doc | |

**User's choice:** Research proposes, you trim
**Notes:** KB files become canonical refs.

## RULE-01 — Attach point

| Option | Description | Selected |
|--------|-------------|----------|
| calendar_events (per-event) | One rule-tag per event, typed to event | ✓ |
| calendars (per-position) | One entry-rule on the position row | |
| Both | Position-level + per-event | |

**User's choice:** calendar_events (per-event)
**Notes:** This IS "which rule fired" per discrete action; aligns 1:1 with the 3-enums decision.

## RULE-01 — Persistence across rebuild

| Option | Description | Selected |
|--------|-------------|----------|
| Separate annotations table | Keyed by fillIdsHash; rebuild never touches it; saves entryThesis too | ✓ |
| Preserve across rebuild | Snapshot annotations by fillIdsHash before delete, re-apply after | |
| You decide | Cleaner separation; research confirms orphan handling | |

**User's choice:** Separate annotations table
**Notes:** rebuildJournal is delete-then-reinsert → a column on calendar_events is wiped every rebuild (latent entryThesis data-loss bug). Orphan-on-hash-change = log.

## RULE-01 — Capture UX

| Option | Description | Selected |
|--------|-------------|----------|
| Per-event dropdown, editable anytime | Phase enum per event in Journal thesis·review panel, OTHER escape, free-text retained | ✓ |
| Forced at event time | Required at first review, read-only after | |
| You decide | Low-friction editable dropdown | |

**User's choice:** Per-event dropdown, editable anytime
**Notes:** Exit rule only known at close → no forced-at-open.

## RULE-01 — Cold-start grace (WATCH-01 edge)

| Option | Description | Selected |
|--------|-------------|----------|
| Grace, then STALLED | Neutral "connecting" until first tick (→LIVE) or ~20s (→STALLED) | ✓ |
| STALLED immediately | Red from load until first tick | |
| LIVE optimistically | Assume LIVE on connect — reintroduces the lie | |

**User's choice:** Grace, then STALLED
**Notes:** No false red on page load.

## SNAP-01 — Snapshot provenance

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — trigger-reason field | Nullable marker (scheduled default vs event-move), non-destructive | ✓ |
| No — indistinguishable | Supplementals look identical to scheduled | |
| You decide | Low-cost provenance marker | |

**User's choice:** Yes — trigger-reason field

## RULE-01 — Adapter surface

| Option | Description | Selected |
|--------|-------------|----------|
| HTTP route + MCP tool | Both; MCP lets Claude Code set/query rule tags (§9) | ✓ |
| HTTP route only | Web-only, skip MCP tool | |
| You decide | Follow §9, route + MCP together | |

**User's choice:** HTTP route + MCP tool

## RULE-01 — Single vs multi rule per event

| Option | Description | Selected |
|--------|-------------|----------|
| Single rule per event | One enum value per event | |
| Multiple rules per event | Multi-select → array/join; annotation holds a set | ✓ |

**User's choice:** Multiple rules per event
**Notes:** Route/MCP contract list-shaped.

## SNAP-01 — Gating + direction

| Option | Description | Selected |
|--------|-------------|----------|
| RTH-gated, both directions | Skip off-hours (job no-ops anyway); trigger on abs % either way | ✓ |
| Always-on, both directions | Detect 24/7; off-hours enqueues no-op jobs | |
| You decide | RTH-gated, abs % either direction | |

**User's choice:** RTH-gated, both directions

## RULE-01 — Backfill

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort migrate | Copy surviving entryThesis into annotations table | |
| Start fresh | Ship annotations table empty | ✓ |
| You decide | Cheap copy if any non-null, else empty | |

**User's choice:** Start fresh
**Notes:** rebuild-null bug makes surviving entryThesis near-moot.

## WATCH-01 — STALLED affordance

| Option | Description | Selected |
|--------|-------------|----------|
| Informational only | Status + tooltip; rely on auto backoff | |
| Manual reconnect action | Force immediate fresh-ticket reconnect | ✓ |
| You decide | Informational, revisit if backoff feels long | |

**User's choice:** Manual reconnect action
**Notes:** Must cancel pending backoff timer to avoid double-connects.

## Build/ship sequencing

| Option | Description | Selected |
|--------|-------------|----------|
| Cheapest-first, one phase ship | WATCH→SNAP→RULE, independently landable, single deploy | |
| Ship each independently | Three separate prod ships within the phase | ✓ |
| You decide | Cheapest-first, single end-of-phase ship | |

**User's choice:** Ship each independently
**Notes:** Order still WATCH-01 → SNAP-01 → RULE-01, per-feature deploy + UAT.

## UI-SPEC scope

| Option | Description | Selected |
|--------|-------------|----------|
| Fold into plan-phase | Capture UI decisions inline, skip separate UI-SPEC | |
| Run /gsd-ui-phase 20 | Full UI-SPEC design contract before planning | ✓ |
| You decide | Fold in given small scope | |

**User's choice:** Run /gsd-ui-phase 20
**Notes:** Badge + Journal rule UI both touch UI.

## WATCH-01 — STALLED visual intensity

| Option | Description | Selected |
|--------|-------------|----------|
| Alarming red | Clear red/error, "data is frozen" | |
| Amber warning | Calmer, consistent with today's STALE amber | |
| Defer to UI-SPEC | Note intent, let UI-SPEC pick the token | ✓ |

**User's choice:** Defer to UI-SPEC
**Notes:** Intent locked — STALLED must read louder than benign staleness.

## RULE-01 — OTHER value behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Require note on OTHER | Conditional-required free-text when OTHER chosen | ✓ |
| Bare OTHER allowed | No note required | |
| You decide | Require note when OTHER, else optional | |

**User's choice:** Require note on OTHER

## RULE-01 — Rule tag in review view

| Option | Description | Selected |
|--------|-------------|----------|
| Show in timeline + edit | Render inline in Journal read view AND editable | ✓ |
| Edit-only | Visible only in the dropdown | |

**User's choice:** Show in timeline + edit

---

## Claude's Discretion

- Enum DB representation (recommend `text` + Zod over rigid Postgres native enum).
- Exact tunable constants (WATCH stall ~20s; SNAP move %, rolling window, cooldown ~15min).
- Server-side detector placement + SPX spot tick source.
- Port shapes, memory-twin parity, MCP tool signature, Journal panel placement.
- STALLED visual token (deferred to UI-SPEC with locked intent).

## Deferred Ideas

None — discussion stayed within phase scope. RULE-02 (rule-fired → outcome report) already in
REQUIREMENTS.md Future Requirements; not this phase.
