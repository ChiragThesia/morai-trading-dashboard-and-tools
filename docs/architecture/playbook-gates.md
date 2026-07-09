# Playbook Gates, Brakes & Sizing

The picker's playbook-port phase adds a market-level entry gate, two anti-criteria brakes, and
VIX-tiered discrete sizing on top of the existing per-candidate rule table
([picker-rules.md](picker-rules.md)). All three share ONE evidence-per-row discipline:
value, threshold, source, rationale — no DSL, no composite fragility score
(mirrors [regime-board.md](regime-board.md)).

## Why a market-level gate, not a per-candidate one

The retired per-pair `term-inversion` gate (picker-rules.md, RETIRED 2026-07-09) read the
playbook's crisis guard literally and dropped it into `selectCandidates`'s per-strike loop —
it deleted exactly the trades with edge, because front-richness between two legs of the SAME
calendar is not the same signal as market-wide crisis vol. The entry gate in this phase fixes
the placement, not just the threshold: `resolveEntryGate` runs ONCE per
`computePickerSnapshot` cycle, over cohort-level scalars (VIX, VIX/VIX3M ratio, open-calendar
count, recent realized losses) — never inside the candidate loop. A blocked or blind cycle
overrides `candidates: []` in the final snapshot; `termStructure`/`gex`/`events` context stays
populated so the board and Analyzer keep showing why.

This plan (28-01) ships `resolveEntryGate` as a pure, tested domain function with zero wiring.
Plan 03 calls it from the use-case.

## The shared VIX ladder

One four-tier constant set (`VIX_LADDER` in `entry-gate.ts`) feeds the penalty band, the hard
block, and (Plan 04) the sizing tiers — never two overlapping band systems for the same
number.

| Tier | VIX range | Used by |
|---|---|---|
| Low | < 15 | Sizing (Plan 04) |
| Normal | 15 – 20 | Sizing (Plan 04) |
| Elevated | 20 – 25 | Penalty band floor (this plan) + sizing |
| Crisis | ≥ 25 | Hard block (this plan) + sizing (0 contracts, moot — no candidates ever emit here) |

`[ASSUMED]` — the 15/20/25 edges are Claude's discretion (28-CONTEXT.md), proposed by analogy
to volatilitybox.com's cited 15/20/30 structure, capped at 25 to align with the user-locked
hard-block boundary. Confirm at UAT alongside the sizing counts (Plan 04).

## VIX and VIX/VIX3M penalty bands

Banded, not a hard cliff — linear penalty-over-cliff (`eventAdjustment`'s existing graduated-
penalty idiom, picker-rules.md) directly avoids the retired-gate mistake above.

| Gate | Open (mult. 1.0) | Penalty band (linear 1.0 → 0.3) | Blocked |
|---|---|---|---|
| VIX (absolute) | < 20 | 20 – 25 | ≥ 25 `[USER-LOCKED]` |
| VIX/VIX3M ratio | < 0.90 | 0.90 – 0.95 | ≥ 0.95 `[USER-LOCKED]` |

Combined multiplier = `min(vixMultiplier, ratioMultiplier)` — the worse regime wins. The
multiplier scales a candidate's final `score` directly (`score = round(score * multiplier)`);
it is explicitly NOT a tenth weighted criterion (picker-rules.md's sum-100 registry stays
untouched — 28-CONTEXT.md "gates are GATES, not score weights").

The ratio penalty floor (0.90) is not a new number: it re-declares
`analytics/domain/regime.ts`'s `VIX_TERM_STRUCTURE_WARN` BY VALUE (architecture rule 7 forbids
importing another context's domain module, so `entry-gate.ts` states the literal with a comment
citing the source). The VIX absolute floor (20) has no existing in-repo precedent —
`[ASSUMED]`, confirm at UAT.

### Hysteresis (arm/disarm bands)

Every rung arms at its threshold and disarms only once the metric crosses back past a looser
band — the same no-flap convention [exit-rules.md](exit-rules.md) already documents for
STOP/TAKE/TERM/GAMMA.

| Rung | Arm at | Disarm below |
|---|---|---|
| VIX blocked | ≥ 25 `[USER-LOCKED]` | < 24 `[USER-LOCKED]` |
| VIX penalty | ≥ 20 | < 19 `[ASSUMED]` |
| Ratio blocked | ≥ 0.95 `[USER-LOCKED]` | < 0.93 `[USER-LOCKED]` |
| Ratio penalty | ≥ 0.90 | < 0.89 `[ASSUMED]` |

The discrete gate **state** (open/penalty/blocked) carries this hysteresis, self-read from the
previous cycle's persisted `picker_snapshot.gate` (Plan 03) — the same self-read-the-previous-
row convention `evaluate-exit.ts` uses for exit verdicts, no new state table. The penalty
**multiplier** is a pure continuous function of the current VIX/ratio value — it does not
inherit the state's hysteresis. A fast-check property proves no state flip for any value
sequence oscillating inside a disarm band.

## Input source — the FRED pair only

The gate reads ONLY `VIXCLS` and `VXVCLS` from `macro_observations` (both FRED EOD, same
observation cadence) — never `VIX9D`. regime-board.md's Known-limitations section already
flags why: `vix9d-vix`'s numerator (CBOE delayed quote) and denominator (FRED EOD close) come
from different observation times, and a fast intraday vol spike can inflate that ratio on a
stale denominator. The VIX/VIX3M pair has no such mismatch — both legs are FRED EOD, same lag.
`extractVixPair` stamps `asOf` as the OLDER of the two series' dates (never overstates
freshness — the same MACRO-03 convention `getRegimeBoard.ts` already applies).

## GATE BLIND — age-tolerance fail-closed (USER DECISION 1)

FRED's T-1 EOD lag is normal, expected staleness — not a fault. The gate accepts a macro
observation up to **3 business days** old. Older than that (or the series missing entirely) is
treated as MISSING data, and the gate fails CLOSED: `state: "blind"`, `entriesAllowed: false`.
This is never a silent degrade to "open" — the blind state is a fourth, visibly distinct value
alongside open/penalty/blocked, rendered loudly wherever the gate state shows (regime board,
picker snapshot).

Business-day age uses an exact Mon-Fri, NYSE-holiday-aware loop
(`packages/shared/src/nyse-holidays.ts` `isNyseHoliday`) — never a calendar-day proxy, which
under/over-counts around 3-day weekends and clustered holidays. `businessDaysSince` probes each
candidate day at noon UTC before the holiday check (not midnight): `isNyseHoliday` formats in
`America/New_York`, and a UTC-midnight instant lands in the PREVIOUS ET calendar day for 4-5
hours depending on DST — noon UTC never crosses that boundary.

## The two anti-criteria brakes (USER DECISION 2)

Both brakes are booleans computed by the use-case (Plan 02/03) and passed into the SAME
`resolveEntryGate` call as the VIX/ratio inputs — not a separate mechanism.

| Brake | Trigger | Effect |
|---|---|---|
| Max open | Open-calendar count ≥ 6 | New entries pause (VIX/ratio may be calm) |
| Loss cooldown | A calendar closes at realized loss ≥ 25% (the same STOP −25% rung basis exit-rules.md already uses) | New entries pause for 2 business days |

Either brake true forces `entriesAllowed: false` and names the tripped brake in `reasons` —
even when VIX and the ratio are both calm. A brake never sets `state` to blocked/blind (that
enum stays reserved for the VIX/ratio regime); it only overrides `entriesAllowed`.

### Deferred: sustained-trend brake

The third anti-criteria brake in the original playbook — a sustained-price-trend filter — is
**consciously deferred**, not silently dropped:

- Crisis gates (this doc) already cover vol-regime danger.
- `deltaNeutral` scoring + the GAMMA/STOP exit rungs (exit-rules.md) already cover directional
  blowthrough on an open position.
- The Phase-27 backtest corpus has n=13 trades — no honest calibration basis for a
  price-trend threshold (n≥30 gate, same bar `docs/architecture/backtest-harness.md`'s n=13
  honesty rule already enforces elsewhere).

Revivable once backtest directional-attribution at a larger n supplies evidence. Tracked here,
not in a code comment, so it survives independent of who reads the source next.

## Sizing tiers (Plan 04 detail, ladder shared here)

VIX-tiered DISCRETE contract counts — user-set, never a derived optimum (28-CONTEXT.md). The
registry lives in `picker/domain/sizing.ts` as named constants (rules.ts-style rows), shipped
on the snapshot for Analyzer display only. Proposed defaults `[ASSUMED]`, pending UAT:

| Tier | Contracts |
|---|---|
| Low (< 15) | 2 |
| Normal (15 – 20) | 2 |
| Elevated (20 – 25) | 1 |
| Crisis (≥ 25) | 0 (moot — the hard block already suppresses candidates) |

## Where to look

- [picker-rules.md](picker-rules.md) — the per-candidate rule table this gate sits above
- [exit-rules.md](exit-rules.md) — the hysteresis convention this gate's rungs mirror
- [regime-board.md](regime-board.md) — the board's admitted-indicator format and the
  `vix9d-vix` epoch-mismatch note this gate deliberately avoids
- `packages/core/src/picker/domain/entry-gate.ts` — `resolveEntryGate`, `VIX_LADDER`,
  `businessDaysSince`, `extractVixPair`
