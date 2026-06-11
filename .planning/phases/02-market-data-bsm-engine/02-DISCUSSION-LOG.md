# Phase 2: Market Data & BSM Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 2-Market Data & BSM Engine
**Areas discussed:** Dividend yield q, Solver method, DTE convention, Port vs greenfield, RTH gating, Failed-inversion marking, CBOE failure visibility, Greeks job triggering, Config surface, SPX vs SPXW roots, Greeks units, Retention, Manual trigger

---

## BSM inputs: dividend yield q

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed config q=1.3% | Zod-config constant, matches trade-advisor's working value; calibration later | ✓ |
| Calibrated (r,q) now | Least-squares calibration from manual TOS readings in Phase 2 | |
| q=0 (ignore dividends) | Simplest; SPX has real ~1.3% yield — values visibly off | |

**User's choice:** Fixed config q=1.3%
**Notes:** Calibrated (r,q) per iv-engine doc deferred until TOS readings flow (Phase 4+).

---

## IV solver method

| Option | Description | Selected |
|--------|-------------|----------|
| Newton + bisection fallback | Fast Newton with guaranteed-convergence fallback for low-vega edges | ✓ |
| Bisection only | What trade-advisor bsm.ts does; always converges, slower | |
| Newton only | Fastest; diverges on flat-vega contracts | |

**User's choice:** Newton + bisection fallback

---

## DTE / time-to-expiry convention

| Option | Description | Selected |
|--------|-------------|----------|
| Calendar days + intraday fraction | Exact minutes to settlement-aware cutoff / minutes-per-year (365.25d) | ✓ |
| Whole calendar days | T = DTE/365; theta jumps at midnight, near-expiry solves degrade | |
| Trading days / 252 | Vol-time purist; mismatches every retail platform | |

**User's choice:** Calendar days + intraday fraction
**Notes:** PM-settled → 16:00 ET cutoff; AM-settled (SPX 3rd Friday) → 09:30 ET. Resolves iv-engine doc open question #3.

---

## Port vs greenfield BSM/CBOE

| Option | Description | Selected |
|--------|-------------|----------|
| Reference, rewrite test-first | Mine bsm.ts/cboe.ts for endpoints/parse/edge cases; write fresh TDD | ✓ |
| Copy then refactor | Vendor files in, bend to hexagon; violates TDD rule | |
| Greenfield, don't read them | Clean-room; rediscovers CBOE quirks the hard way | |

**User's choice:** Reference, rewrite test-first

---

## RTH gating for fetch job

| Option | Description | Selected |
|--------|-------------|----------|
| Cron + handler self-check | ET cron fires during market hours; handler also no-ops outside RTH | ✓ |
| Cron only | Schedule expression is the single gate | |
| Handler-only gate | 24/7 cron, handler decides; log pollution | |

**User's choice:** Cron + handler self-check
**Notes:** Holiday fetches tolerated until Phase 3 holiday calendar (CAL-05).

---

## Failed-inversion row marking

| Option | Description | Selected |
|--------|-------------|----------|
| bsm_iv = 'NaN' | Postgres numeric NaN; drops row from pending partial index, no migration | ✓ |
| Status column migration | bsm_status enum; explicit but breaks no-migration expectation | |
| Leave NULL, re-scan forever | Permanent retry waste; pending-count-0 check never passes | |

**User's choice:** bsm_iv = 'NaN'
**Notes:** User asked what this was for; clarified: unsolvable marks (below intrinsic) must leave the to-do list or the job retries them forever.

---

## CBOE fetch failure visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Status shows last success + last error | lastJobRuns carries lastSuccessAt + lastErrorAt + message per job | ✓ |
| Last success only | Staleness implies failure; no error message | |
| Fail loudly: retries + dead-letter | Phase 5 job-hardening territory | |

**User's choice:** Status shows last success + last error

---

## Greeks job triggering

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch handler enqueues compute | Chained via pg-boss on successful persist + sparse fallback sweep | ✓ |
| Independent offset schedule | +2 min cron; races the fetch | |
| Single combined job | Couples failure domains; breaks SPEC acceptance separation | |

**User's choice:** Fetch handler enqueues compute

---

## Config surface

| Option | Description | Selected |
|--------|-------------|----------|
| Zod defaults, env override | Tunables in Zod schema with defaults; env overrides when set | ✓ |
| Code constants only | Changing a bound = commit + deploy | |
| All env vars, no defaults | 8+ new env vars across two services | |

**User's choice:** Zod defaults, env override

---

## SPX vs SPXW roots

| Option | Description | Selected |
|--------|-------------|----------|
| Both roots, tagged | Store SPX + SPXW within filter; contracts.root distinguishes | ✓ |
| SPXW only | Fewer rows; AM-monthly calendar legs invisible | |
| SPX only | Doesn't match weekly-calendar trading | |

**User's choice:** Both roots, tagged

---

## Greeks units/scaling

| Option | Description | Selected |
|--------|-------------|----------|
| TOS-convention display units | Theta/day, vega/vol-point, raw per-share delta/gamma; ×100 at read | ✓ |
| Pure math units | Annualized theta, vega per 1.00; conversion on every read | |
| Planner decides + documents | Risk of convention drift vs Phase 3 snapshots | |

**User's choice:** TOS-convention display units

---

## Row volume / retention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep forever, no pruning | Journal ethos; ~1M rows/yr trivial for Postgres | |
| Prune raw, keep snapshots | Saves space; destroys recompute/backtest ability | |
| Decide at Phase 6 | Defer until analytics shows real query patterns | ✓ |

**User's choice:** Decide at Phase 6
**Notes:** No pruning meanwhile; Supabase 500MB free tier is the watch-item.

---

## Manual trigger surface

| Option | Description | Selected |
|--------|-------------|----------|
| No — wait for Phase 5 trigger_job | Scheduled-only; dev convenience via direct use-case calls | ✓ |
| Yes — minimal MCP tool now | Pulls small Phase 5 slice forward | |
| HTTP-only dev endpoint | Violates MCP-02 symmetry | |

**User's choice:** No — wait for Phase 5 trigger_job

---

## Claude's Discretion

- Exact CBOE delayed-quotes URL + retry/backoff numbers (mine cboe.ts reference)
- FRED API usage (key vs no-key CSV endpoint)
- Upsert SQL shape for append-only idempotency
- Rate-row-to-observation matching rule
- Calibration fixture sources for 1e-4 greek reference tests
- pg-boss queue/job naming + payload Zod schemas

## Deferred Ideas

- (r, q) calibration against TOS readings — Phase 4+
- Retention/pruning policy — Phase 6
- Manual trigger_job surface — Phase 5
- NYSE holiday calendar — Phase 3
