# Exit Rule Ladder

The exit advisor scores every open SPX calendar with ONE typed rule registry:
`packages/core/src/exits/domain/exit-rules.ts`. Every rule is a row — id, kind, formula,
rationale, source. The registry ships to the UI as `exitsResponse.ruleSet`, so the Analyzer
held-positions panel renders the engine's actual table, never a copy (EXIT-07,
entry-methodology symmetry with [picker-rules.md](picker-rules.md)).

The advisor is read-only. It never places or modifies an order (STRM-04, EXIT-10) — see
"Read-only boundary" below.

## Rule kinds

- **trigger** — a risk or structural condition that fires an actionable verdict (STOP, EVT,
  GAMMA, TERM).
- **profit-take** — a P&L rung that fires TAKE.
- **roll** — a constructive-continuation condition that fires ROLL.
- **hold** — the default when nothing else fires.

## The seven rule rows (USER-LOCKED thresholds — encoded exactly, no re-derivation)

| id | kind | Condition | Verdict |
|---|---|---|---|
| `stop` | trigger | P&L ≤ −25% or ≤ −50% of the fill-ledger debit | STOP (rung named) |
| `evt` | trigger | Tier-1 event (FOMC/CPI/NFP) ≤3 days from front expiry | EXIT_PRE_EVENT |
| `gamma` | trigger | Spot > 2% off strike AND front DTE < 7 | STOP |
| `term` | trigger | Front IV − back IV ≥ 0.5pp (≥0.005 IV points) | STOP |
| `take` | profit-take | P&L ≥ +5%, +10%, or +15% of the fill-ledger debit | TAKE (rung named) |
| `roll` | roll | Front DTE < 14 AND spot within ±1% of strike AND profit < 15% AND no blocking event | ROLL |
| `hold` | hold | No rule above fired | HOLD |

P&L is the fill-ledger basis (`(netMark − openNetDebit) / openNetDebit`) — never a
recomputed parallel P&L (see "P&L basis" below).

## Precedence order

Evaluate top to bottom, first match wins:

**STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD**

One line per rung:

1. **STOP** — capital preservation is non-negotiable and time-critical. Standard risk-order
   practice treats a stop as urgent; it fires before a patient profit target even when both
   conditions are live in the same cycle.
2. **EXIT-pre-event (EVT)** — a tier-1 event ≤3 days from front expiry is a fixed calendar
   date, not a noise-driven trigger. It mirrors the picker's own `exitPlan.closeByExpiry`
   discipline — a hard, pre-computed date — so it runs ahead of the noisier continuous
   triggers below it.
3. **GAMMA** — pin/whipsaw risk in the final DTE window compounds fastest of the remaining
   triggers; a single session's move near expiry can erase weeks of theta gain.
4. **TERM** — front−back IV inversion means the calendar's entry edge is gone. It is a
   slower-moving structural signal than GAMMA's DTE-driven urgency.
5. **TAKE** (highest qualifying rung first: +15% > +10% > +5%) — profit-taking is patient by
   nature; it runs after every risk-driven trigger above it.
6. **ROLL** — a constructive continuation, evaluated only once nothing more urgent fired.
7. **HOLD** — default, no rule fired.

Encoded as `EXIT_PRECEDENCE: ReadonlyArray<ExitRuleId>` in `exit-rules.ts`, a reviewable
array — never an implicit if/else chain order.

## Hysteresis (arm/disarm bands)

Every numeric rung arms at its trigger value and disarms only once the metric crosses back
past a looser band — no flapping cycle to cycle on noise (EXIT-05). Dates (EVT) need no
hysteresis; a calendar date does not flap.

| Rung | Arm at | Disarm below/above |
|---|---|---|
| TAKE +5% | ≥ +5.0% | < +3.0% |
| TAKE +10% | ≥ +10.0% | < +8.0% |
| TAKE +15% | ≥ +15.0% | < +13.0% |
| STOP −25% | ≤ −25.0% | > −23.0% |
| STOP −50% | ≤ −50.0% | > −48.0% |
| TERM (0.5pp inversion) | ≥ 0.005 | < 0.003 |
| GAMMA (2% off strike) | > 2.0% | < 1.5% |
| EVT | date-based | n/a — no hysteresis |

`evaluateExit` takes the previous cycle's verdict as an explicit third argument
(`evaluateExit(position, context, previousVerdict)`) so the hysteresis band has state to
compare against. The previous verdict is read from the exits context's own `exit_verdicts`
table — the newest row for that calendar.

## P&L basis

Verdict P&L derives from the validated journal fill-ledger basis (`openNetDebit`) plus the
latest calendar snapshot's `netMark` — never a recomputed parallel P&L. The exits context is
read-only on every journal table.

No confidence percentages, no probabilities. A verdict always carries a rule id and a raw
metric — never fabricated precision (EXIT-04).

## Read-only boundary

The advisor only advises. It never places or modifies a broker order (STRM-04, EXIT-10). The
exits context's `application/ports.ts` never imports or declares anything resembling
`ForPlacingOrder` — there is no order-placement port anywhere in this repo today.

## How to add a rule

1. Add a row to the exit rule registry in `packages/core/src/exits/domain/exit-rules.ts`
   with `kind`, `rationale`, and `source` filled in.
2. Add the row's id to `EXIT_PRECEDENCE` at the position that matches its urgency relative to
   the existing rows.
3. Wire any new inputs through `MarketContext` or `HeldPosition` (new driven ports need
   memory twins + contract tests in the same PR — architecture rule 8).
4. Tests: add a boundary test for the rule's arm/disarm thresholds (fast-check for numerical
   rules) and a precedence test proving the new row sits where intended.
