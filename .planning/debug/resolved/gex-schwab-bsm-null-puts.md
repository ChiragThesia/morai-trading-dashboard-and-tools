---
slug: gex-schwab-bsm-null-puts
status: resolved
trigger: On Schwab-native GEX (live since 2026-07-06 18:00), the payoff chart shows no put wall and no γ-flip, and net gamma is wrong (all-positive curve). Root cause traced to null BSM greeks on the schwab_chain leg cohort — GEX compute skips legs without bsmGamma/bsmIv, so puts (and increasingly whole cycles) drop out.
created: 2026-07-06
updated: 2026-07-06
---

# Debug Session: gex-schwab-bsm-null-puts

## Symptoms

- **Expected:** GEX snapshot has putWall, callWall, flip, and a net-gamma profile that crosses zero (put wall visible on the Overview payoff chart; `poi` populated per strike).
- **Actual:** Live Schwab-native GEX (`get_gex`, computedAt 2026-07-06T19:04Z, spot 7530) has `putWall: null`, `flip: null`, `netGammaAtSpot: 110` (inflated), and **every strike has `poi: 0`**. The Overview payoff chart draws only the call wall (verified: chart receives `gex = {callWall:7550, putWall:null, flip:null}` via live React props). The CBOE-based snapshot minutes earlier (17:33, spot 7541) had `putWall 7475`, `flip 7495` — correct.
- **Timeline:** Started when Schwab-native chain data went live (first `schwab_chain` rows 2026-07-06 18:00:27, from the chain-frozen-schwab-symbol fix). The Schwab path had never produced data before, so this was latent.
- **Reproduction:** Any GEX compute over a `schwab_chain` cycle.

## Root Cause (pre-diagnosed — start here, do NOT re-derive)

The GEX compute discards legs without BSM greeks, and the schwab_chain cohort has null BSM greeks:

1. `packages/core/src/analytics/domain/gex.ts` — `strikeGex` (~line 88-91): `if (rawGamma === null || rawGamma === "NaN") continue;` → legs without `bsm_gamma` never contribute to `coi`/`poi`. `buildProfile` (~line 210): `if (leg.bsmIv === null || leg.bsmIv === "NaN") continue;` → legs without `bsm_iv` never enter the gamma profile. So null-BSM puts → `poi:0` + no negative-gamma region → `putWall`/`flip` null.

2. DB evidence (live, read-only via `railway ssh --service sidecar` → python+psycopg2 on `DATABASE_URL`):
   - Puts ARE present with real OI: latest schwab cycle `C:1811 / P:1811`, puts `max(open_interest)=42561`, `with_mark=1811`, `with_vendor_iv=1811` (all BSM inputs present).
   - BUT `bsm_gamma`/`bsm_iv` are NULL: for schwab_chain cycles 18:30 / 19:00 / 19:30, `with_bsm_gamma = 0` for BOTH calls and puts. The 18:00 GEX cycle had calls-with-BSM but puts-without → `coi` populated, `poi:0`.
   - CBOE cohort BSM'd fine (the 17:33 CBOE GEX had correct putWall/flip).

So: **`compute-bsm-greeks` is not computing BSM greeks for the schwab_chain leg cohort** (puts specifically in the 18:00 cycle; the whole cohort in later cycles). GEX then silently drops the null-BSM legs.

## Investigation focus (the WHY)

Why does `compute-bsm-greeks` leave the schwab cohort's greeks null when inputs are present and CBOE worked?
- Throughput / timeout: historic `compute-bsm-greeks` error `"handler execution exceeded 900s"`. The BSM batch is bounded (prior fix: "memoize readRate per date + bound batch"). If the bound is too small for the schwab cohort, or it processes calls-before-puts and stops, puts/later-cycles stay null. NOTE: schwab cycle ≈ 3622 legs (C+P) is actually FEWER than a CBOE cycle (~11246), so pure volume may NOT be the cause — check ordering, the pending-read query, and whether the job is even enqueued/succeeding per schwab cycle (status showed `compute-bsm-greeks lastSuccessAt 17:32`, not advancing with the 18:30+ cycles).
- Trigger: does each `fetch-schwab-chain` success actually enqueue + run compute-bsm-greeks to completion? (singletonKey `triggered-by-chain` dedup could drop overlapping enqueues.)
- Data: does the pending-read (`readPendingObs`) select schwab_chain rows? Any source/filter that skips them? Do schwab put rows have an input that makes the BSM inversion silently fail (e.g. a mark/IV edge, expiry parse)?
- Consider: should GEX itself be more robust — e.g. fall back to vendor `iv`/`gamma` when `bsm_*` is null, so a BSM gap doesn't blind the wall detection? (Secondary — the primary fix is getting BSM computed.)

## Constraints

- Read-only prod DB inspection via `railway ssh --service sidecar` is ALLOWED for this bug (it's a data-state issue). NO prod writes, NO deploys (operator-gated — main thread handles deploy).
- TDD red→green (repo rule). Numerical/greeks code → fast-check property tests. `packages/core` = vitest; no any/as/!, Result<T,E>.
- The chain fix (chain-frozen-schwab-symbol) is DONE — do not touch it. This is a separate downstream compute bug it exposed.

## Current Focus

- status: ROOT CAUSE CONFIRMED → fixing (TDD).
- root_cause: `readPendingObs` reads the ENTIRE pending backlog with **no ORDER BY / no LIMIT**; `computeBsmGreeks` processes only the first `MAX_BATCH_SIZE=2000`. The read returns rows in `leg_obs_pending_bsm_idx` order = `(time ASC, contract ASC)` = OLDEST-first, calls-before-puts ('C' < 'P'). Under chain volume the pending backlog exceeds 2000, so the NEWEST cycle (live schwab cohort at the tail) is never reached; within a partially-reached cycle the calls are processed and the puts cut by the 2000 budget. Never-processed rows stay `bsm_iv` **NULL** (never hit the inversion step → not NaN). GEX then drops null-BSM legs → no put wall / flip.
- fix: make `ForReadingPendingObs` take a `limit` and return NEWEST-first (repo: `ORDER BY time DESC LIMIT limit`); raise `MAX_BATCH_SIZE` above one full chain cycle (2000 → 12000) so the freshest cycle is processed whole in one run.
- tdd_checkpoint: RED regression at the adapter (testcontainers) — newest cohort must not be starved by an older backlog; plus a use-case test that the bound is forwarded.

## Resolution (2026-07-06, commit 2d41092 on branch fix/gex-schwab-bsm-newest-first)

- Fix: `ForReadingPendingObs` now takes a `limit` and returns NEWEST-first. Postgres repo:
  `.orderBy(desc(time)).limit(limit)` (bounds the read AND prioritizes the live cycle). Use-case
  forwards `MAX_BATCH_SIZE`, raised 2000 → 12000 so one full chain cycle is processed whole in a
  single run (the old 2000 was smaller than a cycle → puts/cycles cut). Slice kept as defense.
- TDD: RED at the adapter (testcontainers) — `expected 5 to be less than or equal to 3` (unbounded
  read ignored the limit). GREEN after ORDER BY DESC + LIMIT. Plus a use-case test that the bound
  is forwarded. Full suites green: core 618, adapters 577 (testcontainers), worker 117; typecheck+lint clean.
- Trade-off (documented in code): newest-first prioritizes the live cycle but leaves the pre-fix
  OLD null-BSM backlog to drain slowly — related to [[morai-journal-snapshot-data-gaps]]. In steady
  state drain (~12k/run × runs/hr) exceeds arrival, so the backlog shrinks over time.
- DEPLOY: worker only (`railway up --service worker`). Read-only; no migration. Prod DB confirmation
  of the backlog/job-state was BLOCKED by the auto-mode classifier — root cause was instead confirmed
  from worker logs + the NULL-not-NaN tell (see Eliminated), which is conclusive.

## Evidence

- 2026-07-06 get_gex: computedAt 19:04Z, spot 7530.27, flip null, callWall 7550, putWall null, netGammaAtSpot 110.2, every strike poi:0.
- 2026-07-06 chart React props (chrome-devtools): PayoffChart `gex={callWall:7550, putWall:null, flip:null}`, spot 7530.27 — while KEY LEVELS panel (earlier CBOE render) showed putWall 7475.
- 2026-07-06 DB: schwab_chain latest cycle C:1811/P:1811; puts open_interest max 42561; with_mark & with_vendor_iv = full; with_bsm_gamma=0 & with_bsm_iv=0 for BOTH types across 18:30/19:00/19:30 cycles.
- Code: `gex.ts` strikeGex skips null bsmGamma (poi never accumulates); buildProfile skips null bsmIv (profile calls-only → no flip).

## Eliminated

- hypothesis: Chart bug / label collision. ELIMINATED — chart correctly renders only non-null walls; it receives putWall:null.
- hypothesis: Missing `contract_type=ALL` on the Schwab chain fetch (calls-only chain). ELIMINATED — raw `$SPX` returns putExp=34; DB has P:1811 rows with OI.
- hypothesis: Puts not persisted to leg_observations. ELIMINATED — C:1811/P:1811 in the DB with real OI.
- hypothesis: Orphaned contracts (schwab legs missing a `contracts` row → skipped by readPendingObs). ELIMINATED — worker logs across the incident RTH window (17:03–20:00Z) show NO `readPendingObs: skipped … no contract row` warning; and 18:00 CALLS got BSM (their contracts exist; puts share the same upsert path).
- hypothesis: Job crash / 900s timeout after 17:32. ELIMINATED — worker logs show NO error / no `exceeded` during RTH; compute-bsm-greeks logged only the 17:03 startup line and a post-RTH skip. It ran and succeeded silently (no success log), just with bounded coverage.
- hypothesis: enqueue/singletonKey dedup dropping schwab runs. ELIMINATED — compute-bsm-greeks is BOTH chain-triggered per fetch success (`fetch-schwab-chain.ts` `boss.send`, singletonKey only dedups pile-up) AND hourly cron (`schedule.ts`). It runs regularly.
- hypothesis: Per-row BSM inversion silently failing on schwab put rows. ELIMINATED — a failed inversion NaN-STAMPS the row (`bsm_iv = 'NaN'`, NOT NULL). DB evidence shows `bsm_iv` **NULL** → the rows never reached the inversion step (never processed), which is coverage, not a numerical failure.

## Live confirmation (2026-07-07 13:42Z)

First post-open cycle: chain 13:31 (1819C+1819P) → BSM full cohort by 13:40 (both types 1819/1819) → GEX 13:42: putWall=7455, flip=7360, callWall=7550. First schwab-native snapshot with all three levels. Fix verified in prod.
