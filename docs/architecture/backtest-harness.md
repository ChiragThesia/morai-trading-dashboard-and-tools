# Backtest Harness

The PICK-04 backtest replays stored market data through the live picker and exit
engines. It is a refutation tool, not a strategy optimizer.

## Form

`apps/worker/src/backtest.ts` is an operator CLI, run manually via
`bun apps/worker/src/backtest.ts --from <date> --to <date>`. It follows the
`fix-pnl-reingest.ts` / `backfill-transactions.ts` precedent: parse argv and env with
Zod, connect to Postgres, do all I/O up front, then replay in memory.

It is NOT a pg-boss job — no cadence fits a bulk historical scan inside the 900s job
cap — and NOT a server route. It needs only `DATABASE_URL`, not the full worker
config (`TOKEN_ENCRYPTION_KEY`, Schwab secrets, `SIDECAR_URL`) — it makes zero
brokerage calls.

## Three Replay Paths

**Leakage oracle (BT-02).** Replay a historical cohort's chain through the live
`selectCandidates` + `scoreCalendarCandidates` and compare the result to the stored
`picker_snapshot` row for that cohort. An exact mismatch means a lookahead or
percentile bug — the mechanism that makes leakage bugs surface automatically. Reuse
the snapshot's frozen `gex`/`events` fields; do not re-derive them.

**13-trade exit reproduction (BT-03).** Walk each closed calendar's full snapshot
history through `evaluateExit` and compare the resulting trajectory to
`calendar_events.realizedPnl` — the validated fills-ledger oracle. Direction and
rough magnitude, not cent-exact: the harness's haircut fill model approximates the
user's real fills.

**Hypothetical entry+exit (BT-04).** Replay the full stored universe, including
gate-dropped candidates, through entry and exit for every cohort since 2026-06-12.
Feeds directional attribution and leave-one-rule-out ablation.

## Point-in-Time Discipline

Every read is bounded by `observedAt <= T` for decision time T. Every distributional
statistic — percentiles, realized vol, normalizations — is computed from data
available at T, never from the full series.

Cohort enumeration reuses two existing ledgers instead of a new "distinct slot"
query: `picker_snapshot.observed_at` for the leakage oracle and hypothetical replay,
and a calendar's own `calendar_snapshots.time` sequence for the exit replay.

## Reuse Rule

The harness replays through the UNTOUCHED live domain functions:
`selectCandidates`, `scoreCalendarCandidates`, `evaluateExit`, `haircutFill`. It never
reimplements scoring or exit logic. If the harness needs a helper the live engine
doesn't expose, the engine exports it — the harness never forks the logic.

## Honesty Rule

Every reported number carries `n=`, a date range, and a coverage percentage. The
13-trade oracle is refutation-only: it can show a rule is wrong, never prove a rule
is right at that sample size. Every headline metric ships a bootstrap confidence
interval — at n=13 the interval is wide, and that width is the honest signal, not a
flaw to hide.

## Documented Caveats

**Late-solved BSM optimism.** `leg_observations` has no `bsm_solved_at` column.
A row observed at T but BSM-solved at T+15min shows its final solved value in any
read, including an as-of-T one. The leakage oracle avoids this by reusing the frozen
`picker_snapshot` fields; the hypothetical replay (BT-04) remains exposed to it. The
report flags this caveat explicitly rather than silently absorbing the optimism.

**Economic events have no discovery timestamp.** `economic_events` has no
`discoveredAt` column, so true as-of-T event knowledge is unrecoverable. The leakage
oracle sidesteps this by reusing the frozen `snapshot.events` array. The
hypothetical replay uses the CURRENT event table and flags the caveat — low risk,
since FOMC/CPI/NFP dates are published months ahead and rarely move.

## The Hard Boundary

The harness never writes weights, rule registries, or any config. Its only write is
one `backtest_runs` row per run (BT-05). No port in `packages/core/src/backtest/`
resembles `ForWriting*Rules` or `ForPersistingRuleWeights`, and no file in that tree
imports a write path into `rules.ts` or `exit-rules.ts`. Weight promotion stays
gated behind a real-trade sample the backtest cannot supply.

## Storage

`backtest_runs` (migration 0021) is append-only, mirroring `picker_snapshot` and
`exit_verdicts`: one row per run, `params` and `report` as JSONB, no update path. A
second run never overwrites the first — every run is evidence, kept forever. See
[data-model.md](data-model.md) for the column shape.
