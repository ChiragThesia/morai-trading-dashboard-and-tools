---
slug: chain-window-narrow-regression
status: investigating
trigger: Schwab-primary chain fetch (strike_count=50, 90d lookahead — the chain-frozen-schwab-symbol fix) is too narrow. Three casualties confirmed live 2026-07-07 — GEX flip/putWall distorted (user caught putWall>flip inversion), 6/8 open-position legs unobserved (journal marks going stale/gapping during RTH), and widening a single call is impossible (502 TooBigBody at strikeCount=150). Recommended fix: dual-source (fetch CBOE alongside Schwab).
created: 2026-07-07
updated: 2026-07-07
---

# Debug Session: chain-window-narrow-regression

## Context — how we got here (do NOT re-derive; all verified live)

Two prior resolved sessions (see `.planning/debug/resolved/`):
1. **chain-frozen-schwab-symbol** — pipeline frozen 5 days; fixed via `$SPX` symbol + `strike_count=50` + `from/to` 90d in `apps/sidecar/chain_proxy.py` (commits `ac5a814`/`0c6a306`/`c321200`/`749dae7`), plus CBOE fallback on Schwab call-failure in `selectChainSource` (`packages/core/src/brokerage/application/selectChainSource.ts`).
2. **gex-schwab-bsm-null-puts** — compute-bsm-greeks starved the newest cycle; fixed newest-first bounded read, MAX_BATCH_SIZE 12000 (commit `2d41092`). LIVE-CONFIRMED 2026-07-07 13:42Z.

Those fixes WORK — chain flows, BSM covers full cohorts, GEX computes. Do not touch them except as this fix requires. THIS session is about the **fetch window being too narrow** now that Schwab is primary.

## Symptoms (all confirmed live 2026-07-07)

1. **GEX levels distorted.** First schwab-native GEX (cycle 07-07 13:30): `putWall=7455, flip=7360, callWall=7550`. User caught the smell: putWall ABOVE flip (atypical; classic regime is putWall < flip < spot < callWall). Yesterday's full-chain CBOE snapshot (07-06 17:30): `putWall=7475, flip=7495` — flip dropped 135pts overnight while walls barely moved = artifact, not market.
2. **Open-position legs unobserved.** Of 8 open legs, today's schwab cycles observe only 2:
   - MISS: `SPX 261120P07200000`, `SPXW 261130P07200000`, `SPX 261120P07600000`, `SPXW 261130P07600000` (Nov — outside 90d lookahead, ends ~Oct 5)
   - MISS: `SPXW 260831P07400000`, `SPXW 260731P07350000` (inside 90d but outside the ±~125pt strike window)
   - OK: `SPXW 260804P07400000`, `SPXW 260803P07350000`
   → journal snapshot marks for 6/8 legs go stale/gap from today onward (the exact `journal-snapshot-data-gaps` problem again, new cause).

## Root cause (confirmed)

`apps/sidecar/chain_proxy.py` fetches `get_option_chain("$SPX", from_date=today, to_date=today+90d, strike_count=50)`. strikeCount=50 ≈ ±125pts around per-expiry ATM. Live strike-coverage comparison (query below):

```
schwab latest cycle:  strikes 6900–8250 but only 104 distinct (sparse, near-ATM dense)
cboe   last cycle:    strikes 6790–8290, 299 distinct (full)
top put-OI (schwab):  7500, 7450, 7600, 7550   ← near-ATM only
top put-OI (cboe):    7000, 7300, 7200, 6800   ← the REAL put mass, entirely missing from schwab
```

Missing far-OTM put gamma → `buildProfile` zero-crossing (flip) biased low; `strikeGex` putWall = max of what was fetched. Missing >90d expiries + far strikes → open Nov/Aug/Jul legs never observed.

**Cannot widen a single call:** live probe (2026-07-07, python via `railway ssh --service sidecar`): 90d strikeCount=50 → 200/4.4MB; strikeCount=150/200/300 → **502 "Body buffer overflow" (protocol.http.TooBigBody)**. Schwab gateway limit is the binding constraint.

## Fix options

**A. Dual-source (RECOMMENDED — ponytail: reuse proven code).** Fetch BOTH Schwab and CBOE each cycle; both persist to `leg_observations` (append-only, `source`-tagged). Schwab = freshness; CBOE = breadth (covers put tail + all position legs; it carried the system for weeks). Change surface: `selectChainSource` currently picks ONE source (`packages/core/src/brokerage/application/selectChainSource.ts`, wired in `apps/worker/src/main.ts` ~line 153); make the use-case fetch both (or re-schedule the retired `fetch-cboe-chain` cron alongside). CHECK: how `readLegObsForGex` defines the "latest cycle" cohort — if cycle-time snapped, near-simultaneous schwab+cboe rows union naturally (good); if strictly max(time), GEX may still see only one source — must union within the cycle window. Also check BSM MAX_BATCH_SIZE 12000 still ≥ one dual-source cycle (~11,246 CBOE + ~3,638 Schwab ≈ 15k → may need raise; memory `morai-bsm-newest-first-fix` documents the ceiling).
**B. Multi-call Schwab scoping.** Near-term expiries wide-strike call + far expiries narrow call + per-leg quote fetches for open positions. Schwab-native but 3× moving parts, each with its own 502 budget; needs probing per-window.
**C. Hybrid**: A for now, B later if CBOE latency/quality becomes an issue.

## Constraints (repo rules — non-negotiable)

- TDD red→green: failing regression test FIRST, commit at green only, atomic per concern. `packages/core` vitest; adapters testcontainers; numerical → fast-check.
- No `any`/`as`/`!`; `Result<T,E>`; parse-don't-cast (Zod). Hexagonal: core imports shared only.
- NO prod deploys without explicit user approval (Railway `railway up --service <sidecar|worker>` per service; redeploy≠rebuild). NO prod writes; read-only DB inspection allowed via the pattern below. The auto-mode classifier blocks pg_terminate/job-triggers — ask the user rather than working around.
- RTH gates: fetch/compute jobs no-op outside 13:30–20:00Z weekdays — live verification only during RTH.
- `trigger_job` MCP enum has no fetch-schwab-chain/fetch-cot; compute-bsm-greeks IS triggerable but RTH-gated.

## Useful live-inspection pattern (read-only)

```bash
# run python+psycopg2 inside the sidecar container against prod DB
SP=<scratchpad>; cat > "$SP/q.py" <<'PY'
import os, psycopg2
c=psycopg2.connect(os.environ["DATABASE_URL"]); c.autocommit=True; cur=c.cursor()
cur.execute("...sql...")
for r in cur.fetchall(): print(r)
PY
railway ssh --service sidecar "echo $(base64 < "$SP/q.py" | tr -d '\n') | base64 -d | python3"
```

Key queries used:
- Position-leg coverage: `select contract, max(time) from leg_observations where contract = any(ARRAY[<8 OCC symbols above>]) and time > '<today 13:00Z>' group by contract`
- Strike coverage per source: `select min(ct.strike)/1000.0, max(ct.strike)/1000.0, count(distinct ct.strike) from leg_observations lo join contracts ct on ct.occ_symbol=lo.contract where lo.source=%s and lo.time=(select max(time) ... where source=%s)`
- Put-OI mass: group put OI by strike, order desc — compare schwab vs cboe.

## Verification plan (goal-backward)

1. After fix + deploy, during RTH: all 8 open-position legs observed in the latest cycle (query above → 8× OK).
2. GEX snapshot: putWall/flip computed from full-width data — flip back near CBOE-basis values (sanity: putWall < flip < spot in normal positive-gamma regime; compare against prior CBOE snapshot magnitudes).
3. Top-8 put-OI strikes visible in the GEX-input cohort include the 6800–7300 clusters.
4. Journal: snapshot-calendars cycle writes non-gap marks for Nov calendars.
5. All suites green + typecheck + lint before any deploy; worker and/or sidecar redeploy per what changed.

## Current Focus

- hypothesis: Dual-source fetch (Option A) restores breadth with minimal new code; main risks are GEX-cohort union semantics and BSM batch ceiling.
- next_action: Read `selectChainSource.ts`, `fetchChain.ts` (`makeFetchChainUseCase`), `readLegObsForGex` (postgres gex-snapshot repo) to pin the cohort semantics; then decide A vs B and write the RED test.
- tdd_checkpoint: nothing written yet — investigation handoff.

## Eliminated

- hypothesis: putWall>flip is genuine market structure here. ELIMINATED for this instance — put-OI comparison proves the far-OTM clusters (7000/7200/7300/6800) exist (CBOE) and are absent from the schwab fetch; flip moved 135pts overnight on source-switch alone.
- hypothesis: BSM/GEX math broken. ELIMINATED — both fixed and live-verified (see resolved sessions); math is correct on the data it receives.
- hypothesis: widen strikeCount in the existing single call. ELIMINATED — 150+ → 502 TooBigBody (live probe).
