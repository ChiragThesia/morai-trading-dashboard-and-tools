# Phase 25: Data-Quality Ops Rider - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Source:** User-locked milestone decisions + LIVE PROD FORENSICS (2026-07-09, orchestrator psql reads)

<domain>
## Phase Boundary

Two defect fixes in the existing pipeline, nothing new: (OPS-01) `snapshot-calendars` stops
writing gap rows — root cause fixed, not gap-filled after the fact; (OPS-02)
`compute-bsm-greeks` commits work in batches so a full-cohort drain survives the 900s pg-boss
handler cap without the timeout+retry dance. Sequenced before Exit Advisor so verdicts never
compute on gap rows or a partially-solved cohort.

</domain>

<decisions>
## Implementation Decisions

### PROD FORENSICS (2026-07-09 — ground truth for the planner/researcher)

**OPS-01 gap-row distribution** (`calendar_snapshots`, spot IS NULL OR 0 OR NaN):
- Jun 23-26: 100% gap rows (28/28, 6/6, 6/6, 6/6) — chain-source outage era (fixed Jul-06)
- Jun 27-30: no rows at all (worker down — separate, resolved)
- Jul 06: 8/55 gaps — the smoking gun (see below). Jul 07/08: 0/95, 0/95 — currently healthy.

**Jul-06 smoking gun (mechanism proof):**
- `leg_observations` had ZERO rows between 12:00Z and 17:30Z that day (first chain fetch
  17:30Z cboe 11,246 rows; 18:00Z schwab 7,252).
- Yet snapshot-calendars wrote 5-calendar cohorts at 14:01, 15:01, 16:00, 17:00Z: 3 calendars
  with non-zero marks (served from STALE pre-outage legs via a tolerant read), 2 calendars
  (both Nov-20/Nov-30 legs: af9923ba strike 7200, c225281e strike 7600) with spot=0,
  net_mark=0, front_iv=NaN, source='cboe', trigger='scheduled'.
- Mechanism: the snapshot use-case runs on schedule regardless of fresh-chain presence; when a
  calendar's contracts are missing from the readable window it writes ZEROS/NaN instead of
  skipping; when legs are stale it silently serves stale marks.

**OPS-02 live state:**
- 19,116 null-BSM `leg_observations` rows since Jul-07 (backlog exists right now).
- pgboss `compute-bsm-greeks` durations: 14:33, 14:10, 14:09, 10:12, 10:03, 7:44 (mm:ss) —
  brushing the 900s cap; 1 failed + 1 active at time of reading. MAX_BATCH_SIZE currently
  12000 (raised from 2000 in the newest-first fix, commit 2d41092).

### Fix requirements (USER-LOCKED via roadmap/requirements)
- OPS-01: root-cause fix in the write path — a cycle with no fresh-enough cohort for a
  calendar SKIPS that calendar's row (next cycle self-heals) rather than writing zeros. Never
  gap-fill retroactively. Complete price/greek data going forward under normal market
  conditions. Decide explicitly: staleness tolerance for "fresh enough" (Claude's discretion,
  but must be documented + tested; snapshots are 30-min RTH cadence — a tolerance around one
  cadence interval is the natural anchor).
- OPS-02: batched commits inside the handler — a full-cohort recompute completes within ONE
  handler cycle under normal chain volume (24k rows/day-ish); no 900s timeout+retry dance.
  Batch commit = progress durable per batch, so even a killed run resumes without rework.
  (Mid-RTH worker deploys kill BSM runs — 15-min retry currently re-does everything.)

### Guardrails (from incident memory — do not regress)
- Cohort LOOKBACK window semantics: never calendar-slot-group multi-source data (GEX day-2
  bug); BSM newest-first bounded read must stay newest-first (starvation fix 2d41092).
- Snapshot UPSERT: premature write must not block fuller recompute (GEX day-2 bug precedent).
- Existing dual-source (schwab+cboe) per-contract-latest dedup union semantics stay intact.
- No new tables expected. No contract changes expected (this is worker/core behavior).
- Do NOT touch journal fills/events tables (money-code boundary).

### Testing (repo rules)
- TDD red→green; regression tests reproducing the Jul-06 shape (no legs in window →
  calendar skipped, NOT zero-row) and the stale-serve shape (legs older than tolerance →
  skip + log, not silent stale marks) — deviation note: if stale-serve turns out to be
  intended behavior for some windows (e.g. AH), document and test the boundary explicitly.
- BSM batching: contract test proving batch-commit durability (kill mid-drain → committed
  batches persist) — extend leg-observations.bsm-drain.contract.test.ts patterns.

### Claude's Discretion
- Exact staleness tolerance constant + where it lives (named constant).
- Batch size for writeBsm commits (something that finishes a batch well under the cap).
- Whether snapshot-calendars logs skips as job_run metadata vs stdout (follow existing
  handler logging conventions).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### OPS-01 path
- `packages/core/src/journal/application/snapshotCalendars.ts` — the use-case (write path)
- `apps/worker/src/handlers/snapshot-calendars.ts` — handler wrapper
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — snapshot repo
- `packages/adapters/src/postgres/repos/leg-observations.ts` — the legs read the use-case does

### OPS-02 path
- `apps/worker/src/handlers/compute-bsm-greeks.ts` — handler (900s cap context)
- `packages/adapters/src/postgres/repos/leg-observations.ts` — writeBsm + drain read
- `packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` — existing drain contract tests

### Docs to update (docs-first rule)
- `docs/architecture/jobs.md` — snapshot-calendars + compute-bsm-greeks behavior rows

</canonical_refs>

<specifics>
## Specific Ideas

- Verification queries (post-deploy, orchestrator runs):
  - Gap regression: `SELECT count(*) FROM calendar_snapshots WHERE time > '<deploy>' AND (spot=0 OR spot IS NULL OR spot='NaN')` stays 0 across a chain-outage simulation window.
  - BSM: pgboss durations for compute-bsm-greeks drop well under 900s per run; null-BSM backlog drains.

</specifics>

<deferred>
## Deferred Ideas

- Retroactive gap-filling of Jun 23-26 rows — explicitly out (roadmap: "root cause fixed,
  not gap-filled after the fact").
- Silent-stall stream watchdog (Phase-12 leftover) — different subsystem.

</deferred>

---

*Phase: 25-data-quality-ops-rider*
*Context gathered: 2026-07-09 with live prod forensics*
