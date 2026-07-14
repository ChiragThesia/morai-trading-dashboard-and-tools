---
status: investigating
trigger: "self-heal-journal job doesn't heal gap rows it was built to heal (prod, 2026-07-14)"
created: 2026-07-14T00:00:00Z
updated: 2026-07-14T00:00:00Z
---

## Current Focus

hypothesis: With the slot-interval fix (455b84c) deployed, a prod-shaped self-heal run over
  a top-of-hour gap row STILL no-ops. Some seam in enumerate→resolve→heal drops the heal.
test: prod-shaped testcontainers integration test wiring REAL adapters + REAL use-cases,
  seeded to mirror c225281e exactly (mixed-root SPX/SPXW pair, 14:00:00Z gap row, 14:00:50Z
  post-BSM leg obs), run selfHealJournal at now=16:00:30Z.
expecting: if the test heals (GREEN), code is correct → bug is deploy/ops; if RED, the exact
  failing seam is the root cause.
next_action: write + run packages/adapters/src/postgres/repos/self-heal-journal.prod-repro.contract.test.ts

## Symptoms

expected: self-heal-journal hourly cron heals top-of-hour gap rows (finite marks, NaN
  calibrated IVs/greeks) once the leg-observation cohort is BSM-processed.
actual: gap rows at 14:00Z/15:00Z UNCHANGED after 15:00Z + 16:00Z cron runs, even after the
  slot-interval fix (455b84c) was deployed (worker SUCCESS 15:41:04Z) before the 16:00Z cron.
errors: none logged — handler logs NOTHING on success; prod is blind (ran/healed-0 vs
  never-ran vs errored-per-slot are indistinguishable).
reproduction: calendar c225281e (SPX 7600P, open). Rows: 13:30Z ok, 14:00Z GAP, 14:30Z ok,
  15:00Z GAP, 15:30Z ok, 16:00Z GAP. Gap rows = snapshot ran on a just-fetched not-yet-BSM'd
  cohort (top-of-hour BSM-fallback-cron collision).
started: HIST-03 self-heal shipped in phase 40; never observed to heal in prod.

## Eliminated

- hypothesis: mixed-root (SPX front / SPXW back) join fails to resolve the back leg
  evidence: resolveRootCandidates('SPX') returns ['SPX','SPXW']; the live writer wrote the
    healthy 14:30 non-gap row for the SAME pair, proving both legs resolve.
  timestamp: 2026-07-14 (static trace)

## Evidence

- timestamp: 2026-07-14
  checked: full enumerate→resolve→heal path statically
  found: trace says the 14:00 anchor is enumerated (offset -4 all week, 14:00Z within RTH),
    resolve window [14:00:00,14:30:00) captures the 14:00:50 obs, computeLegPairMetrics yields
    finite fields, isGapRow(existing)=true → UPDATE. Should heal.
  implication: the no-op is NOT explained by static reading — need the deterministic repro.

- timestamp: 2026-07-14
  checked: EDGE variant — obs moved to 13:59:30Z (just BEFORE the 14:00 anchor), all else identical
  found: `[EDGE] rowsHealed=1 honestGaps=69 14:00 frontIv=NaN` — the 14:00 gap row is NOT healed
    (frontIv stays NaN); the one heal landed on the PREVIOUS (13:30) slot. errorCount 0, nothing
    logged. This reproduces the EXACT prod symptom.
  implication: resolveLegObservationForSlot's [anchor, anchor+30min) window (455b84c) is BLIND to
    a pre-anchor observation.

- timestamp: 2026-07-14
  checked: apps/worker/src/schedule.ts cron table
  found: compute-bsm-greeks = "0 * * * *" (hourly, top of ET hour) and it CHAIN-TRIGGERS
    snapshot-calendars (which has no cron). fetch-schwab-chain = "*/30 * * * *". At the top of the
    hour the BSM cron fires and triggers a snapshot whose floored slot (S) can be paired with the
    globally-latest observation from the PREVIOUS fetch (pre-anchor), producing a top-of-hour gap
    row built from a pre-anchor obs.
  implication: the 455b84c fix traded the pre-anchor case for the post-anchor case (it was
    `at-or-before` before). Top-of-hour rows built from a pre-anchor obs are the ones the current
    window cannot re-resolve → they are never healed → the systematic :00-slot gaps that persist.

## Resolution

root_cause: >
  resolveLegObservationForSlot (packages/adapters/src/postgres/repos/leg-observations.ts:423-447)
  resolves the slot's observation from the half-open interval [slotAnchor, slotAnchor + 30min).
  The live snapshot-calendars writer floors its trigger instant to the slot boundary but pairs it
  with the globally-latest leg_observation; when the hourly compute-bsm-greeks cron ("0 * * * *")
  triggers the snapshot at the top of the hour, that latest observation can be timestamped in the
  PREVIOUS slot (pre-anchor). The window then finds nothing for that slot, so self-heal leaves the
  gap row NaN (honest-gap, errorCount 0, silent) and heals the previous slot instead — the exact
  prod symptom. The FAITHFUL repro (obs in-slot at 14:00:50Z) heals correctly, so the heal path
  itself is sound; the defect is the window's blindness to pre-anchor observations.
fix: >
  Observability (mandatory) shipped: the self-heal-journal + repair-journal-history handlers now
  log one coverage line per run so honestGaps>0 on the gap slots is visible. The window-semantics
  change is NOT shipped speculatively — widening to include pre-anchor obs risks D-04 honest-gap
  fabrication (inserting rows for empty slots from a prior slot's obs) and the verified data (obs
  in-slot) heals, so the correct fix needs the next run's logs to confirm honestGaps>0 before
  altering locked semantics.
verification: >
  3 testcontainer tests: faithful repro heals (rowsHealed>=1, errors 0, 14:00 row finite);
  characterization test proves the pre-anchor blind spot (14:00 stays NaN); handler tests assert
  the coverage log line.
files_changed:
  - packages/adapters/src/postgres/repos/self-heal-journal.prod-repro.contract.test.ts (new)
  - apps/worker/src/handlers/self-heal-journal.ts (observability)
  - apps/worker/src/handlers/repair-journal-history.ts (observability)
