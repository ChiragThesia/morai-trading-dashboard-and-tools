# Project Research Summary

**Project:** Morai — Trading Dashboard & Tools · milestone v1.3 "Picker Intelligence"
**Domain:** Single-user, self-hosted SPX calendar-spread trading system — adding a held-position exit advisor, an options backtest harness (PICK-04), and a personal-playbook rule port onto an existing hexagonal Bun/TS pipeline
**Researched:** 2026-07-09
**Confidence:** HIGH

## Executive Summary

v1.3 does not build a new system. It bolts three *inference layers* onto a data pipeline that already ships everything they need: a validated journal P&L ledger, live greeks, term structure, GEX walls, an economic-events adapter, a 9-rule entry picker, and a dual-source (Schwab+CBOE) chain corpus since 2026-06-12. All four research streams converge on the same conclusion: **zero new dependencies, three additive derived-read features, and one hard statistical ceiling that reframes what the backtest is allowed to be.** The exit advisor evaluates open calendars each cycle into a single verdict (HOLD/TAKE/STOP/ROLL/EXIT-pre-event) from the user's own playbook ladder; the backtest replays stored chains through the *exact same* pure rule functions; the playbook port adds two market-level VIX crisis gates plus anti-criteria and sizing tiers.

The single most important finding — woven through FEATURES and PITFALLS — is the **n=13 sample-size wall.** The corpus is 13 validated closed calendars inside one ~6-week volatility regime, less than half the ~30-trade bare statistical floor, and the trades are correlated (one trader, one instrument). This makes per-rule weight optimization *dishonest by construction*: 9 free weights fit to 13 correlated points is overfitting formalized. The backtest must therefore be a **refutation and mechanics-validation tool, never a weight-fitter.** It reproduces the 13 known outcomes deterministically (no lookahead), reports directional per-rule attribution stamped `n=13`, and defers all automated promote/demote until n≥30 real closed trades. The milestone brief's phrase "promote/demote weights with evidence" resolves to "a human promotes when a real sample exists," not an optimizer.

The recommended approach is a clean, opinionated build order that every file independently confirms and refines: **VIX3M ingestion first and alone** (one array entry — because `macro_observations` has no backfill, every un-ingested day is permanently lost history), a **data-quality ops rider** before or alongside the two inference features (the pipeline carries ~74% gap rows in some windows and a BSM drain that can exceed the 900s handler cap — defects that turn from cosmetic into *confident wrong trade verdicts* once an advisor reads them), then the **exit advisor** (headline value, all data already flows), then the **backtest** (needs exit rules to exist before it can validate them), then the **playbook gates** (consume the accumulating VIX3M history and the backtest evidence). The chief risk is not building the features — it is inheriting the pipeline's silent data gaps into confident wrong answers, mitigated by session/gap gating, hysteresis, point-in-time replay, and the free `picker_snapshot`-reproduction oracle.

## Key Findings

### Recommended Stack

**Zero new dependencies.** All three features are built from capabilities the repo already ships (see `.planning/research/STACK.md`). The one external unknown — the FRED series id for the 3-month VIX — is **live-verified as `VXVCLS`** (HTTP 200, daily, current to 2026-07-07 = 19.01), and adding it is a one-line change to the existing `DEFAULT_FRED_SERIES_IDS` constant, not code. Backtest replay and per-rule metrics are ~15-30 lines of pure TS reusing the in-repo `percentileRank` helper and the `realizedVol` stdev pattern, property-tested with the already-installed fast-check. Two small new append-history tables follow the established `picker_snapshot` idempotency convention.

**Core technologies (all existing, locked):**
- **FRED HTTP adapter (in-repo, parameterized)** — fetch any series by id, raw value, no fallback — adding VIX3M needs zero adapter change, just `"VXVCLS"` in the series list
- **Drizzle ORM + Zod** — two new append-history tables (exit verdicts, backtest runs) + idempotent migrations (0018+); JSONB blobs Zod-parsed on write AND read at the adapter edge
- **pg-boss** — the exit advisor is a new terminal handler on the existing single-trigger chain (`…→compute-picker→compute-exit-advice`); the backtest is deliberately NOT a job
- **Own picker engine (`scoreCalendarCandidates`, pure)** — the backtest *replays* stored chains through this same engine; exit rules extend the same typed gate/score registry pattern
- **fast-check + testcontainers** — required for the numeric backtest kernel (correlation invariants) and the new repo tables (SQL never mocked)

### Expected Features

See `.planning/research/FEATURES.md`. Every backtest number must carry `n=13` and its date range — this is a hard constraint, not a caution.

**Must have (table stakes):**
- **Live P&L per open calendar + one clear verdict** (HOLD/TAKE/STOP/ROLL/EXIT-pre-event) with the firing rule and its raw metric shown — reuse the validated journal P&L ledger, don't recompute
- **Deterministic, point-in-time replay loop** (chain@T → engine → walk forward → exit verdict → realized P&L) that reproduces the 13-trade oracle's direction/magnitude — the honest, achievable backtest win
- **Fill-haircut on BOTH entry and exit** (one shared fill function) — ranking on mid overstates edge; the exit side is the more dangerous half because it decides the ladder
- **VIX3M ingestion + two market-level crisis gates** (VIX<25; VIX/VIX3M<0.95) — applied once at market level, never per-candidate

**Should have (competitive differentiators):**
- **Playbook-encoded verdict registry** — the user's own ladder (+5/+10/+15% takes, −25/−50% stops, EVT≤3d, TERM inversion, GAMMA, roll) auto-evaluated every cycle — no retail tool does per-position verdicts from a personal playbook
- **Per-rule DIRECTIONAL attribution + leave-one-out ablation** — "did high-scoring trades beat low-scoring ones?" reported as a sign + `n`, never a coefficient; reveals redundant rules cheaply even at n=13
- **TERM-inversion exit trigger from live term structure** — no retail tool watches front−back IV inversion as an exit signal
- **Sizing tiers by VIX regime** — discrete user-set tiers (NOT a derived optimum)

**Defer (blocked on data or boundary):**
- **Automated weight promotion/demotion from the backtest** — defer until ≥30 real closed trades; at n=13 the evidence does not exist
- **Auto-execution of exits/rolls** — crosses the read-only boundary (STRM-04); Morai advises, the human executes. The single most important boundary to hold
- **Kelly / optimal-f sizing, Sharpe on 13 trades, a backtesting DSL, ML regime-classification** — all fabricated rigor or scope creep at this sample size / user count

### Architecture Approach

See `.planning/research/ARCHITECTURE.md`. All three features are **additive derived-reads** — none touches the journal's fills→events→P&L source-of-truth path, none mutates a position, none changes an existing context's `domain/`. That is what keeps the hexagon law satisfied throughout.

**Major components:**
1. **`exits` bounded context (NEW)** — sibling to `picker`, in the mould of `analytics`: reads position/mark/greeks/P&L from `journal`, GEX from `analytics`, events from `picker` — all through its own application ports (never a foreign `domain/` import); owns the exit-rule registry and `evaluateExit(position, context)` pure function; writes verdicts, never mutates journal
2. **`exit_verdicts` table + `compute-exit-advice` job (NEW)** — append-only, keyed `(observed_at, calendar_id)`, `onConflictDoNothing` first-write-wins on the cohort clock (the proven `picker_snapshot` convention at per-calendar grain); a thin terminal pg-boss handler after `compute-picker`
3. **Backtest as an operator CLI (NEW)** — `apps/worker/src/backtest.ts`, following the `fix-pnl-reingest.ts` precedent — NOT a pg-boss job (no cadence; the 900s cap fights a bulk history scan) and NOT a server route; it does all I/O up front, then replays history through the untouched pure `selectCandidates`/`scoreCalendarCandidates`/`evaluateExit`; only the reusable predictive-power kernel lives in `packages/core/src/backtest/domain/`
4. **VIX3M ingestion (MODIFIED, one array entry)** — lands `VXVCLS` into `macro_observations`; a later macro→picker read port surfaces VIX + VIX3M to the crisis gates

### Critical Pitfalls

See `.planning/research/PITFALLS.md`. The unifying theme: **these features convert silent data gaps into confident wrong answers.**

1. **Overfitting 9 weights to 13 correlated trades** — treat PICK-04 as a refutation tool: change one variable at a time, leave-one-out only, bootstrap CI on every metric (the CI is enormous and showing it is the honest antidote), never auto-write weights (guarded by the weight-sum-100 test)
2. **In-sample percentile / normalization leakage** — every distributional statistic must be point-in-time (`observedAt ≤ decision-cohort time`); exploit the free oracle: prod writes `picker_snapshot` rows live, so replaying a historical cohort **must reproduce the recorded score exactly** — a mismatch is a hard test failure that catches most leaks cheaply
3. **Look-ahead via late-solved BSM and dual-source cohort union** — replay per 30-min slot with the same per-contract-latest deduped union the live readers use (`readLegObsForGex`); either record a `bsm_solved_at` or explicitly flag the residual optimism
4. **Fill-model divergence (exit at mid)** — one shared haircut fill function on both legs, calibrated against the 13 real fills; report P&L as a mid→haircut range, never a single number
5. **Exit-verdict + regime-gate flapping** — hysteresis/banding (arm TAKE at +5%, downgrade below +3%; block VIX above 26, re-open below 24); the codebase already retired the `term-inversion`/`event-blackout` hard gates for deleting trades with edge — lean toward a penalty band over a cliff
6. **Acting on stale/AH/gap marks** — session- and gap-aware advisor; verdicts on AH/spot=0/NULL-greek cohorts are display-only ("indicative, RTH will confirm"), never actionable STOP/TAKE

## Implications for Roadmap

Based on the research, the suggested phase structure. All four files independently confirm this order; ARCHITECTURE and PITFALLS refine it by splitting VIX3M to the front and surfacing an ops rider. (NOTE: the user added a regime/breadth BOARD requirement set after research — MACRO-02/03 + BOARD-01..03 in REQUIREMENTS.md — which slots naturally with the macro-ingestion and playbook work.)

### Phase 1: VIX3M Ingestion (`VXVCLS`)
**Rationale:** Must go **first and alone** — `macro_observations` has no backfill, so every day without ingestion is permanently lost VIX3M history that both the crisis gates and their eventual backtest need. Trivially small and isolated.
**Delivers:** `VXVCLS` landing daily in `macro_observations` (one array entry + memory-twin seed + contract-test row).
**Addresses:** FEATURES "VIX3M series ingestion" table-stakes prerequisite.
**Avoids:** PITFALLS Anti-Pattern 5 (deferring VIX3M until the gates are built).

### Phase 2: Data-Quality Ops Rider
**Rationale:** The pipeline carries known defects — ~74% gap rows (spot=0/NaN) in some snapshot windows, a BSM drain that can exceed the 900s cap leaving `compute-picker` firing on a partially-solved cohort, first-write-wins rows that can freeze a partial write over a fuller recompute. Both inference features inherit these directly; a data bug becomes a wrong verdict or a false "this rule works." PITFALLS says this must land **before or alongside** the exit advisor and backtest.
**Delivers:** Snapshot-gap fix, batched `writeBsm`, completeness-gated `compute-picker` snapshot.
**Uses:** Existing `snapshot-calendars`, `compute-bsm-greeks`, cohort-union read semantics.
**Avoids:** PITFALLS 7, 12, and the BSM-cap / first-write-wins traps at the source.

### Phase 3: Exit Advisor
**Rationale:** The milestone headline and the fastest to ship — ~90% of its data already flows (P&L ledger, greeks, term structure, events, GEX). It closes the trade loop the user watches daily AND provides the exit rules the backtest needs.
**Delivers:** `exits` bounded context + `evaluateExit` registry (the playbook ladder as typed rows) + `exit_verdicts` table/repo/twin + `compute-exit-advice` terminal job + `GET /api/exits` route + `get_exit_advice` MCP tool + Analyzer held-positions panel rendering the ruleSet.
**Implements:** ARCHITECTURE component 1 & 2 (derived-read `exits` context, cohort-clock idempotency).
**Addresses:** FEATURES exit-advisor table-stakes + differentiators (verdict registry, TERM trigger, laddered TAKE).
**Avoids:** PITFALLS 6 (flapping → hysteresis), 7 (AH/gap → session gating), 8 (P&L basis → reuse the validated journal ledger + oracle), 9 (unfillable exits → liquidity gate on current legs).

### Phase 4: PICK-04 Backtest Harness
**Rationale:** Depends on **both** the entry domain (exists) and the exit domain (Phase 3) so it can validate both. This is the highest-risk phase for *methodology* correctness, but the pitfalls are exhaustively documented.
**Delivers:** Operator CLI (`apps/worker/src/backtest.ts`) + pure predictive-power kernel (`packages/core/src/backtest/domain/`, fast-check tested) + `backtest_runs` JSONB report table; deterministic no-lookahead replay reproducing the 13 oracle outcomes, directional per-rule attribution + leave-one-out ablation, every number stamped `n=13` + date range + coverage %.
**Uses:** STACK pure-TS metrics reusing `percentileRank`; replay through the existing engine (no framework).
**Avoids:** PITFALLS 1 (overfit → refutation-only, LOO, CI), 2 (leakage → point-in-time + `picker_snapshot` reproduction), 3 (late-BSM/union), 4 (fill divergence → shared haircut + calibration), 5 (survivorship → replay full universe incl. rejected strikes), 12 (gap-row poisoning → gap filter + coverage report).

### Phase 5: Playbook Crisis Gates + Anti-Criteria + Sizing
**Rationale:** Lands last — it consumes the VIX3M history accumulating since Phase 1 and is best informed by Phase 4's backtest evidence. Anti-criteria (max open, loss cooldown) reuse the open-position + realized-P&L state the exit advisor establishes.
**Delivers:** VIX<25 and VIX/VIX3M<0.95 market-level gates (the deferred `picker-rules.md` rows) + a new macro→picker read port + anti-criteria gates + discrete VIX-regime sizing tiers; optionally the event-calendar bucket and `autoTuneTargetDelta` (most-optional, time-box and drop first).
**Addresses:** FEATURES playbook-port table-stakes + differentiators.
**Avoids:** PITFALLS 10 (EOD FRED lag → treat as a daily regime filter, stamp the as-of date, decide fail-open vs fail-closed explicitly), 11 (gate flapping → hysteresis band, penalty over cliff — inherit the retired-gate scar).

### Phase Ordering Rationale

- **Dependency-forced:** the backtest cannot replay exits without an exit-rule registry, so Exit Advisor strictly precedes Backtest. This fixes Exit → Backtest → Playbook, exactly as PROJECT.md sequences it (confirmed by all four files).
- **Data-accretion-forced:** VIX3M moves to the very front because there is no backfill — it must start accreting before its consumers exist.
- **Data-quality-forced:** the ops rider precedes (or parallels) the inference features because both inherit the pipeline's gap/BSM/first-write-wins defects, and a silent data bug becomes a confident wrong answer once an advisor reads it.
- **Value-forced:** Exit Advisor is both the fastest to ship (data already flows) and the highest core value (closes the daily trade loop), so it leads the inference work.

### Research Flags

Phases likely needing deeper research or an explicit decision during planning:
- **Phase 4 (Backtest):** highest methodology risk. Research is already deep (PITFALLS covers leakage, survivorship, fill-model, gap-poisoning, sample-size exhaustively), so this is a **careful-planning** flag, not a research-gap flag. The one open technical decision: record a `bsm_solved_at` column vs flag the residual optimism.
- **Phase 5 (Playbook gates):** one genuine open decision — **fail-open vs fail-closed** on missing VIX3M (a crisis gate failing closed blocks all entries on missing data; fail-open risks trading blind into a spike). Must be decided and documented during planning.
- **Phase 2 (Ops rider):** scope decision — confirm during planning whether the snapshot-gap fix is in-scope for v1.3 or a separate concern (PITFALLS says it must land before/with, but the milestone brief frames v1.3 as the three inference features).
- **Regime board (user-added BOARD-01..03 + MACRO-02/03):** needs its own indicator-evidence research pass (RSP:SPY, VIX9D/VIX, VVIX/VIX, FRED movement series) at phase planning — each indicator admitted only with documented evidence, mirroring picker-rules.md discipline.

Phases with standard patterns (skip research-phase):
- **Phase 1 (VIX3M):** one array entry into an already-parameterized adapter; live-verified series id. Fully specified.
- **Phase 3 (Exit Advisor):** mirrors the existing `picker` context and `picker_snapshot` idempotency verbatim; ARCHITECTURE gives the full port/table/route inventory. Well-documented pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new deps; FRED `VXVCLS` live-verified 2026-07-09 (HTTP 200, current); all reused helpers read directly in-repo |
| Features | MEDIUM-HIGH | Exit-management and backtest-honesty norms well-sourced and cross-checked; thresholds are the user's own already-validated playbook, not re-derived; the n=13 wall is peer-reviewed statistical consensus |
| Architecture | HIGH | Grounded in the actual codebase (`picker`/`journal`/`analytics` contexts, `picker_snapshot` repo, `fix-pnl-reingest`/`backfill-transactions` CLI precedent, the pg-boss chain) — an internal-fit question, not a survey |
| Pitfalls | HIGH | Canonical quant/backtest pitfalls web-grounded; system-specific pitfalls drawn from this repo's architecture docs and incident history (journal-P&L fix, GEX premature-UPSERT, ~74% gap rows) |

**Overall confidence:** HIGH

### Gaps to Address

- **FRED series id discrepancy (resolve to `VXVCLS`):** STACK.md live-verified the correct FRED id is **`VXVCLS`** (HTTP 200, current); `VIX3M`/`VIX3MCLS`/`VXV` all 404. FEATURES.md and ARCHITECTURE.md still write `VIXCLS3M` (the CBOE ticker / an assumed id, not the FRED id). **The roadmap and Phase 1 plan must use `VXVCLS`** — using `VIXCLS3M` fails with a 404. Treat STACK.md's live verification as authoritative.
- **Table naming to reconcile:** STACK.md calls the exit table `exit_advisories`; ARCHITECTURE.md calls it `exit_verdicts`. Pick one at planning — `exit_verdicts` is the more codebase-grounded name (ARCHITECTURE read the actual `picker_snapshot` grain). Cosmetic, but fix before the migration is written.
- **`bsm_solved_at` column:** decide during Phase 4 planning whether to add a solve-timestamp column (reconstructable as-of-solved set) or explicitly flag the residual late-BSM optimism and keep it out of the "proven" column.
- **Fail-open vs fail-closed on missing VIX3M:** an explicit Phase 5 planning decision, must be documented.
- **Ops-rider scoping:** confirm at planning whether the snapshot-gap/BSM fix is a v1.3 phase or a parallel ops track — PITFALLS requires it before/with the inference features either way.

## Sources

### Primary (HIGH confidence)
- FRED `fredgraph.csv?id=VXVCLS` — direct fetch 2026-07-09: HTTP 200, 4852 daily rows, current to 2026-07-07 (19.01), still updating; `VIX3M`/`VIX3MCLS`/`VXV` all HTTP 404 — authoritative, verified
- Codebase read directly 2026-07-09: `packages/core/src/{picker,journal,analytics}/**`, `packages/adapters/src/postgres/repos/picker-snapshot.ts` + `picker-chain.ts`, `journal/application/fetchMacroSeries.ts`, `packages/shared/src/percentile-rank.ts`, `packages/core/src/picker/domain/realized-vol.ts`, `apps/worker/src/{fix-pnl-reingest,backfill-transactions,handlers/compute-picker}.ts`
- Repo docs: `docs/architecture/{hexagonal-ddd,jobs,picker-rules,stack-decisions}.md`, `.claude/rules/architecture-boundaries.md`, `.planning/PROJECT.md`
- Bailey, Borwein, López de Prado & Zhu — *The Probability of Backtest Overfitting* (SSRN 2326253) — 30/100/200–500 sample floors, Deflated Sharpe Ratio, PBO
- Incident history (project memory): journal-P&L fill-ledger fix (−$319,850 oracle), GEX premature-UPSERT / BSM-starvation NULL greeks, snapshot ~74% gap rows

### Secondary (MEDIUM confidence)
- Exit-management norms (50%/21-DTE dual rule, P&L-per-day-in-trade, roll at 7 DTE): tastytrade, Option Alpha, OptionsTradingIQ, daystoexpiry.com
- VIX term structure (VIX/VIX3M<1.0 = contango ~80% of time; backwardation avg 3.3 days / median 1 day): VolRadar, Raven Quant
- Backtest pitfalls taxonomy (look-ahead, survivorship 1–3%/yr inflation, overfitting): StarQube, LuxAlgo, Portfolio Optimization Book §8.2, Hedge Fund Alpha, BacktestBase
- Exit/position-management UX (OptionStrat payoff+probability, tos Position Statement, LX/SX labels): OptionStrat, thinkorswim learning center

### Tertiary (LOW confidence)
- Per-rule attribution / signal-quality methodology (predictive-power + PnL-contribution decomposition, ablation, interpretation stability): macrosynergy.com + ML-backtest literature — directional guidance, not tiny-sample-specific

---
*Research completed: 2026-07-09*
*Ready for roadmap: yes*
