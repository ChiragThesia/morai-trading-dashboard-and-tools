# Phase 25: Data-Quality Ops Rider - Research

**Researched:** 2026-07-09
**Domain:** Existing pipeline defect fixes — journal snapshot write-path (OPS-01) and BSM batch-compute durability (OPS-02). In-repo code-path diagnosis only; no new stack.
**Confidence:** HIGH (both root causes verified by direct code read + prod forensics already in CONTEXT.md; the pg-boss 900s cap and retry defaults verified against the installed dependency's source)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**PROD FORENSICS (2026-07-09 — ground truth for the planner/researcher)**

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

### Deferred Ideas (OUT OF SCOPE)
- Retroactive gap-filling of Jun 23-26 rows — explicitly out (roadmap: "root cause fixed,
  not gap-filled after the fact").
- Silent-stall stream watchdog (Phase-12 leftover) — different subsystem.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | snapshot-calendars stops writing gap rows (zero/NaN) when a calendar has no fresh-enough leg data; skips the calendar for that cycle instead | Root cause traced to `resolveLegSnapshot` (no staleness bound at all) + `buildSnapshotRow` (defaults marks to 0 on null leg). Fix architecture below adds a `time`-aware freshness gate in the use-case, before `buildSnapshotRow` is called. |
| OPS-02 | compute-bsm-greeks commits work in batches so a full-cohort drain survives the 900s pg-boss handler cap without the timeout+retry dance | Root cause traced to `makeComputeBsmGreeksUseCase`'s single read-solve-ALL-write-once shape (one `writeBsm` transaction at the very end). Fix architecture below restructures to a batch loop with a wall-clock budget, using existing ports unchanged. |

</phase_requirements>

## Summary

Both defects are **in the write path shape, not the read/compute algorithms** — neither fix touches BSM math, IV inversion, dual-source chain-fetch, or the newest-first drain ordering (all explicitly guarded by CONTEXT). OPS-01's root cause is that `resolveLegSnapshot` (`packages/adapters/src/postgres/repos/calendar-snapshots.ts:169-184`) does a plain `ORDER BY time DESC LIMIT 1` with **no staleness bound whatsoever**, and `LegSnapshot` (`packages/core/src/journal/application/ports.ts:176-188`) doesn't even carry the observation's `time` — so the use-case has no way to know how old a "resolved" leg is. This single gap produces both observed symptoms: a contract with *any* historical observation gets served forever no matter how stale (Jul-06's 3 non-zero calendars), and a contract with *zero* historical observations resolves to `null`, which `buildSnapshotRow` (`packages/core/src/journal/application/snapshotCalendars.ts:79-106`) defaults to `mark: 0` / `spot: 0` (Jul-06's 2 zero-row calendars). The fix is one root cause, not two: thread `time` through `LegSnapshot`, and gate on it in the use-case before persisting.

OPS-02's root cause is that `makeComputeBsmGreeksUseCase` (`packages/core/src/journal/application/computeBsmGreeks.ts:86-206`) reads up to 24,000 pending rows once, solves the entire batch in a single JS loop, and calls `writeBsm` exactly **once at the end** — which itself wraps every row in one Postgres transaction (`packages/adapters/src/postgres/repos/leg-observations.ts:227-256`). A kill anywhere in that run (worker redeploy, OOM, or the 900s pg-boss `expire_seconds` default itself) commits **zero** rows. The observed solve rate (~14-20 rows/sec, from CONTEXT's 12,000-rows-in-10-to-14-min durations) means a full 24k-row cohort can take 20-28 minutes of pure CPU — already past the 900s cap in the worst case, which is exactly why 1 run failed and several brushed 14:33. The fix restructures the same use-case into a batch loop: read→solve→write in ~800-row increments, each `writeBsm` call independently durable, with a wall-clock budget that voluntarily exits (returning `ok`) before the 900s cap rather than letting pg-boss kill it.

**Primary recommendation:** OPS-01 — add a `time: Date` field to `LegSnapshot`, populate it from the existing `legObservations.time` column already in scope at both read sites, and gate `snapshotCalendars`'s per-calendar loop on `now - leg.time <= 45min` before calling `buildSnapshotRow`/`persistSnapshot`; skip (continue loop, `console.warn`) on missing or stale legs. OPS-02 — restructure `makeComputeBsmGreeksUseCase`'s single pass into a `while` loop over `COMMIT_BATCH_SIZE=800`-row batches bounded by a `700_000ms` wall-clock budget, returning `ok(undefined)` early (not an error) when the budget is hit with rows still pending — the next chain-trigger (30-min cadence) or hourly cron picks up the remainder because `readPendingObs`'s `bsm_iv IS NULL` predicate naturally excludes already-committed rows.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Leg freshness gate (OPS-01) | Core (application use-case: `snapshotCalendars.ts`) | Adapters (Postgres repo supplies `time`) | Freshness is a business rule (D-06-adjacent), pure `Date` arithmetic, no I/O — belongs in the hexagon per architecture-boundaries.md §2. The repo's only job is exposing the column that already exists. |
| BSM batch-commit loop (OPS-02) | Core (application use-case: `computeBsmGreeks.ts`) | Adapters (existing `ForReadingPendingObs`/`ForWritingBsmResults` ports, unchanged signatures) | The loop-until-drained-or-budget-exhausted control flow is business logic (bounded work per run); no new port needed — both ports already support being called repeatedly. |
| pg-boss job-expiry / retry timing | Adapters (`apps/worker/src/schedule.ts`, pg-boss library defaults) | — | `expire_seconds`/`retry_limit` are infra config, confined to the composition-root scheduling file per architecture-boundaries.md §3; this phase does NOT need to touch them — the batch+budget redesign makes the job finish before the cap fires, so the existing 900s/retry_limit=2 defaults become irrelevant rather than needing an override. |
| Docs (jobs.md) | Docs | — | `docs/architecture/jobs.md` has two pre-existing stale lines this phase's behavior change makes worse to leave uncorrected (see Pitfall 4) — docs-first rule requires updating before/with the code change. |

## Standard Stack

No new libraries. Both fixes are internal control-flow restructures using ports/adapters that already exist (`ForReadingPendingObs`, `ForWritingBsmResults`, `ForResolvingLegSnapshot`, `ForPersistingSnapshot`). Zero new dependencies — matches the CONTEXT guardrail ("No new tables expected. No contract changes expected").

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none — pure TS control flow) | — | — | — |

### Package Legitimacy Audit

Not applicable — this phase installs no new packages. `npm view`/registry checks skipped; no `package.json` diff expected in either PLAN.

## Architecture Patterns

### System Architecture Diagram — OPS-01 (freshness gate)

```
fetch-schwab-chain (cron, */30 * 24/7)
        │ writes leg_observations (time, contract, mark, underlying_price, bsm_* NULL)
        ▼
compute-bsm-greeks (chain-triggered)
        │ solves bsm_* columns in place (same rows, same time)
        ▼ boss.send("snapshot-calendars")
snapshot-calendars handler   ── isWithinRth(now) && !isNyseHoliday(now)? ──► NO → skip journal write entirely (existing gate, unchanged)
        │ YES
        ▼
snapshotCalendars use-case (packages/core)
  for each open calendar:
        │
        ├─► resolveLegs(front)  ─┐
        ├─► resolveLegs(back)   ─┤   Postgres: contracts JOIN → latest leg_observations row
        │                        │   (ORDER BY time DESC LIMIT 1 — NO staleness bound today)
        ▼                        ▼
  ┌─────────────────────────────────────────────┐
  │  NEW: freshness gate (OPS-01)                 │
  │  front/back resolved AND                      │
  │  now - leg.time <= SNAPSHOT_LEG_STALENESS_MS? │
  └─────────────────────────────────────────────┘
        │ NO (missing OR stale)         │ YES (both legs fresh)
        ▼                                ▼
  skip calendar this cycle        buildSnapshotRow (D-05/D-06 unchanged)
  console.warn(calendarId,              │
    reason)                             ▼
  continue loop                   persistSnapshot → calendar_snapshots
  (self-heals next cycle,               (onConflictDoNothing, composite PK)
   no row written for this time)
```

### System Architecture Diagram — OPS-02 (batch-commit drain)

```
fetch-schwab-chain / fetch-cboe-chain (every fetch cycle)
        │ inserts ~15k new (time, contract) rows, bsm_iv NULL
        ▼ boss.send("compute-bsm-greeks", singletonKey:"triggered-by-chain")
compute-bsm-greeks handler (thin adapter, unchanged)
        ▼
computeBsmGreeks use-case (packages/core) — REDESIGNED:

  budgetDeadline = now() + BSM_TIME_BUDGET_MS
  loop:
    ┌─────────────────────────────────────────────┐
    │ now() >= budgetDeadline? ──► YES ──► return ok(undefined)  [voluntary early exit,
    │        │ NO                                     remaining rows wait for next          │
    │        ▼                                        chain-trigger/cron — no pg-boss        │
    │ readPending(COMMIT_BATCH_SIZE)                   failure, no retry dance]              │
    │        │                                     │
    │  empty? ──► YES ──► return ok(undefined)  [fully drained]
    │        │ NO                                 │
    │        ▼                                     │
    │ solve batch (invertIv + bsmGreeks,            │
    │   readRate memoized per date — unchanged)     │
    │        ▼                                      │
    │ writeBsm(batch writes)  ── ONE transaction,    │
    │   COMMITTED — durable checkpoint               │
    │   (kill here loses at most this batch,          │
    │    not the whole run)                            │
    └────────────┴──────────────────────────────────┘
        repeat
```

### Recommended Project Structure

No new files/folders. Both fixes are edits to existing files:

```
packages/core/src/journal/application/
├── ports.ts                  # OPS-01: add `time: Date` to LegSnapshot
├── snapshotCalendars.ts      # OPS-01: freshness gate + skip-loop; new exported constant
├── computeBsmGreeks.ts       # OPS-02: batch-commit loop; new exported constants
└── computeBsmGreeks.test.ts  # OPS-02: new RED tests (budget exit, batch durability)

packages/adapters/src/postgres/repos/
├── calendar-snapshots.ts     # OPS-01: select+return `time` in resolveLegSnapshot
└── leg-observations.ts       # OPS-01: select+return `time` in getLatestLegObs (same LegSnapshot type)

packages/adapters/src/memory/
├── calendar-snapshots.ts     # OPS-01: twin parity (architecture-boundaries.md §8)
└── leg-observations.ts       # OPS-01: twin parity

docs/architecture/jobs.md     # both: behavior-row updates + 2 pre-existing stale-line fixes
```

### Pattern 1: Freshness gate lives in the use-case, not the repo

**What:** The staleness check is pure `Date` arithmetic (`now.getTime() - leg.time.getTime() > TOLERANCE_MS`) — no SQL `WHERE time > ...` filter in the repo. The repo's `resolveLegSnapshot` keeps its existing "latest row, whatever its age" semantics unchanged; it now just also returns that row's `time`.
**When to use:** Any time "is this data fresh enough to act on" is a business decision (tolerance value, skip-vs-fallback policy) rather than a storage concern.
**Why here specifically:** `packages/core` must stay pure (architecture-boundaries.md §2) — pushing a staleness `WHERE` clause into the repo would still need the tolerance constant threaded from core anyway (it's a domain concept: "how much cadence drift is acceptable"), so keeping the whole decision in the use-case is both simpler and correct per the dependency law.
**Example:**
```typescript
// packages/core/src/journal/application/snapshotCalendars.ts (new)
export const SNAPSHOT_LEG_STALENESS_TOLERANCE_MS = 45 * 60 * 1000; // 45 min = 1.5x the 30-min chain cadence

function isLegFresh(leg: LegSnapshot | null, now: Date): leg is LegSnapshot {
  if (leg === null) return false;
  return now.getTime() - leg.time.getTime() <= SNAPSHOT_LEG_STALENESS_TOLERANCE_MS;
}
```

### Pattern 2: Batch-commit loop replaces single-shot read-all/write-once

**What:** Instead of one `readPending(MAX_BATCH_SIZE)` → solve everything → one `writeBsm`, loop: `readPending(COMMIT_BATCH_SIZE)` → solve that slice → `writeBsm` that slice → check budget → repeat.
**When to use:** Any drain-style job whose total backlog can exceed what fits in the platform's handler-timeout window, where partial progress has value.
**Why here specifically:** `readPendingObs`'s `WHERE bsm_iv IS NULL AND mark IS NOT NULL` predicate (`packages/adapters/src/postgres/repos/leg-observations.ts:139`) makes each batch naturally exclude already-solved rows — no offset/cursor bookkeeping needed. Combined with each `writeBsm` call being its own transaction, this gives free, correct resumability.
**Example:**
```typescript
// packages/core/src/journal/application/computeBsmGreeks.ts (redesigned)
export const COMMIT_BATCH_SIZE = 800;
export const BSM_TIME_BUDGET_MS = 700_000; // ~11.7 min; leaves ~3 min margin under pg-boss's 900s expire_seconds default

export function makeComputeBsmGreeksUseCase(deps: {...}): () => Promise<Result<void, StorageError>> {
  return async (): Promise<Result<void, StorageError>> => {
    const deadline = deps.now().getTime() + BSM_TIME_BUDGET_MS;
    const rateCache = new Map<string, number>();

    while (deps.now().getTime() < deadline) {
      const pendingResult = await deps.readPending(COMMIT_BATCH_SIZE);
      if (!pendingResult.ok) return err(pendingResult.error);
      if (pendingResult.value.length === 0) return ok(undefined); // fully drained

      const writes = solveBatch(pendingResult.value, rateCache, deps); // existing per-row logic, unchanged

      if (writes.length > 0) {
        const writeResult = await deps.writeBsm(writes); // durable checkpoint
        if (!writeResult.ok) return err(writeResult.error);
      }
    }
    return ok(undefined); // budget exhausted, not an error — next trigger continues
  };
}
```

### Anti-Patterns to Avoid
- **Reading `MAX_BATCH_SIZE=24000` up front, then chunking only the write:** does not help — the CPU-bound solve loop between read and write is what actually eats wall-clock time; chunking only the transaction still leaves one giant uninterruptible solve loop that can still exceed 900s with zero durable progress until it finishes.
- **A SQL `WHERE time > now() - interval` in `resolveLegSnapshot`:** moves a business-tolerance decision into the adapter and duplicates the constant on both sides if core ever needs to reason about it (e.g., for the skip-reason log message). Keep the repo dumb; keep the decision in core.
- **Gap-filling Jun 23-26 zero rows retroactively:** explicitly deferred/out-of-scope per CONTEXT — do not touch historical rows.
- **Raising `expireInSeconds` on the `compute-bsm-greeks` queue to "fix" the timeout:** treats the symptom, not the root cause; CONTEXT explicitly wants "no 900s timeout+retry dance," i.e., the job should finish (or gracefully checkpoint) well inside the existing cap, not get a bigger cap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting a killed/expired pg-boss job | Custom heartbeat/lock table | pg-boss's existing `expire_seconds` (900s default) + `retry_limit` (2, default, unmodified) | Already verified present and correctly configured (see Pitfall 5) — the batch redesign makes the job finish before this fires in the common case; no need to duplicate pg-boss's own liveness tracking. |
| "Resume from where I left off" bookkeeping (cursor, offset, checkpoint table) | A new `bsm_drain_progress` table or in-job cursor | The existing partial index predicate `bsm_iv IS NULL AND mark IS NOT NULL` (`leg_obs_pending_bsm_idx`) | Every already-written batch naturally drops out of the next `readPending` call — this is already how `T-02-15`'s idempotent-rerun property works today; batching doesn't need new state, just more frequent commits. |

**Key insight:** Both fixes are almost entirely about *when* to persist and *when* to stop*, not what to compute. Resist the urge to add new tables, cursors, or config knobs — the existing ports and predicates already carry everything needed once the loop shape changes.

## Common Pitfalls

### Pitfall 1: `LegSnapshot` has no `time` field today — this is the actual root cause, not a side detail
**What goes wrong:** Without `time`, the use-case cannot distinguish "just-observed" from "observed three days ago" — both look identical (`LegSnapshot | null`).
**Why it happens:** `ports.ts:176-188` never needed `time` before because nothing downstream cared about leg freshness — `buildSnapshotRow` only reads `mark`/`bsmIv`/greeks/`underlyingPrice`.
**How to avoid:** Add `readonly time: Date` to `LegSnapshot`. This is a **shared type** — `ForResolvingLegSnapshot` (calendar-snapshots.ts) and `ForReadingLatestLegObs`/`getLatestLegObs` (leg-observations.ts) both return `LegSnapshot`, so both Postgres call sites need the column added to their `select`, and both memory twins need parity updates (architecture-boundaries.md §8). `getLatestLegObs`'s memory twin already has `latest.time` available on `ObservationRow` — trivial one-line add. The Postgres `getLatestLegObs` select needs `time: legObservations.time` added alongside the existing columns.
**Warning signs:** A regression test seeding a `LegSnapshot` literal without `time` will fail to compile once the field is required — that's the intended forcing function; every construction site must be updated (see file list in Pattern 1/2's "Recommended Project Structure").

### Pitfall 2: The RTH gate already fully excludes AH from `calendar_snapshots` — no AH exception needed
**What goes wrong (if assumed otherwise):** CONTEXT's testing note flags a "deviation" risk: "if stale-serve turns out to be intended behavior for some windows (e.g. AH), document and test the boundary explicitly." Building an AH carve-out into the freshness gate would be unnecessary complexity.
**Why it's actually a non-issue:** `apps/worker/src/handlers/snapshot-calendars.ts:46-52` gates the ENTIRE journal write (`snapshotCalendarsUseCase` call) behind `isWithinRth(now) && !isNyseHoliday(now)` — when false, it `console.warn`s and skips the use-case call outright; only the downstream `compute-analytics` enqueue still fires (chain stays 24/7 per the CAL-05 narrowed gate). `isWithinRth` (`packages/shared/src/rth-window.ts:14-58`) is Mon-Fri 09:30-16:00 ET only — there is no AH/weekend code path that reaches `snapshotCalendars`'s persist call at all.
**How to avoid:** Confirm the Jul-06 incident times (14:01-17:00Z ≈ 10:01 AM-1:00 PM ET) fall inside RTH — they do. This means **any** staleness beyond tolerance observed during an RTH-gated write is always a defect, never intended AH behavior. The freshness gate needs no time-of-day branching — a single tolerance constant suffices. Skip the "document the AH boundary" testing note from CONTEXT as N/A (confirmed by reading the actual gate, not assumed) — but do write one explicit regression test asserting this (RTH-gated call + stale leg → skip), so the "N/A" is proven, not just asserted in prose.
**Warning signs:** If a future change moves the RTH gate or narrows it further, re-verify this assumption — the freshness-gate design depends on "every `snapshotCalendars` call under test is implicitly RTH-context" holding.

### Pitfall 3: `MAX_BATCH_SIZE=24000` was never actually a *time* bound — it was a *cycle-completeness* bound
**What goes wrong:** Assuming that shrinking `MAX_BATCH_SIZE` alone (without restructuring to batched commits) fixes OPS-02.
**Why it happens:** The `2026-07-01` incident (RC#1, cited in `computeBsmGreeks.ts:14-18`) that set `MAX_BATCH_SIZE` was about *starving the newest cohort* (oldest-first + too-small bound), not about wall-clock duration. The current value (24000) was sized to "exceed one full dual-source cycle" (~15k rows) for coverage correctness, with no consideration of the 900s cap.
**How to avoid:** Keep the *read bound per batch* small (`COMMIT_BATCH_SIZE=800`, see arithmetic below) but do NOT reduce total achievable throughput — the `while` loop still processes as many batches as the time budget allows, and newest-first ordering (`ORDER BY time DESC`, unchanged) still guarantees the freshest cohort is attempted first within a run. Do not touch `ORDER BY time DESC` — CONTEXT explicitly guards this (2d41092 starvation fix).
**Warning signs:** A batch size so large it single-handedly risks the per-batch write transaction growing unwieldy, or so small that DB round-trip overhead (readPending + readRate’s cache-miss query) starts to dominate.

### Pitfall 4: `docs/architecture/jobs.md` has two pre-existing stale facts this phase's fix intersects
**What goes wrong:** Leaving these uncorrected while updating the same doc for the OPS-01/OPS-02 behavior change would compound confusion for the next engineer reading the table.
**Specifics found (verified against `apps/worker/src/schedule.ts`):**
1. `jobs.md:26` documents `compute-bsm-greeks` as `every 1 min (drains pending)`. The actual schedule (`schedule.ts:157-162`) is `0 * * * *` (hourly, sparse fallback) — the primary trigger is chain-triggered (`fetch-schwab-chain`/`fetch-cboe-chain` on success), not a 1-minute cron. This is unrelated to OPS-02's fix but sits in the exact row this phase's behavior note needs to update — fix both in the same edit.
2. `jobs.md:305` documents `Retries: default retryLimit: 5, exponential backoff`. The actual pg-boss v12.18.3 `QUEUE_DEFAULTS` (verified by reading `node_modules/.bun/pg-boss@12.18.3/node_modules/pg-boss/dist/plans.js:24-33`) is `retry_limit: 2, retry_backoff: false, retry_delay: 0` — no override exists anywhere in `schedule.ts`. This is directly relevant to explaining the "15-min retry" behavior CONTEXT describes (see Pitfall 5) and should be corrected while documenting the OPS-02 fix.
**How to avoid:** Include both corrections in the `docs/architecture/jobs.md` edit task, scoped narrowly (2-line fixes), not a full doc rewrite.

### Pitfall 5: The "15-min pg-boss retry" is `expire_seconds` (900s), not a scheduled retry interval — confirms why batching (not a bigger cap) is the fix
**What goes wrong:** Assuming there's a configurable "15-min retry delay" to tune.
**Why it happens / verified mechanism:** pg-boss v12's `QUEUE_DEFAULTS.expire_seconds = FIFTEEN_MINUTES` (900s) is the time pg-boss waits before concluding a job stuck in `active` state (e.g., its worker process was killed) is dead and marking it failed/eligible-for-retry. Nothing in `schedule.ts` overrides `expireInSeconds` for `compute-bsm-greeks`, so it runs on this default. `retry_delay: 0` means the retry (up to `retry_limit: 2` times) fires essentially immediately once pg-boss's maintenance cycle detects the expiry — so "15 min" is entirely the detection latency, not a deliberate backoff.
**How to avoid:** Don't try to shorten `expireInSeconds` to detect failures faster (that would make legitimate long solves fail prematurely) or lengthen it to avoid expiry (that hides the problem and lets a single mega-run block progress even longer). The batch+budget redesign sidesteps this mechanism entirely by having the job voluntarily return `ok` before 900s, in the common case — `expire_seconds`/`retry_limit` become a safety net for genuine crashes, not the normal-path completion mechanism.
**Warning signs:** If post-fix durations still brush 900s, the budget constant (`BSM_TIME_BUDGET_MS`) or batch size needs retuning — see Sampling Rate below for the verification query.

### Pitfall 6: A separate, out-of-scope bug found while reading the read path — `readJournal` silently drops `schwab_chain`-sourced rows
**What goes wrong:** `mapSnapshotRow` (`packages/adapters/src/postgres/repos/calendar-snapshots.ts:330-363`) does `if (row.source !== "cboe") return null;` before mapping — meaning `readJournal` (the read path backing the journal UI/API) silently **excludes every `calendar_snapshots` row persisted with `source: "schwab_chain"`**, logging a `console.warn` that says "unknown source" even though `schwab_chain` is a valid, typed value of `SnapshotRow.source` (`ports.ts:224`: `"cboe" | "schwab_chain"`). The inline comment claims `SnapshotRow.source is typed as the literal "cboe"` — that comment is itself stale relative to the actual type.
**Why flagged here, not fixed here:** This is NOT one of OPS-01/OPS-02 — CONTEXT scopes this phase to exactly those two defects ("Two defect fixes in the existing pipeline, nothing new"). Fixing it would silently expand phase scope.
**Recommendation:** Surface this to the user as a candidate follow-up ticket (separate from OPS-01/OPS-02); do not fold it into either plan. Flagging per workflow.md's "conflicts → surface, don't silently pick."

## Code Examples

### OPS-01 — `resolveLegSnapshot`'s existing (unbounded) read, for reference
```typescript
// packages/adapters/src/postgres/repos/calendar-snapshots.ts:169-184 (current, verified)
const obsRows = await db
  .select({
    mark: legObservations.mark,
    underlyingPrice: legObservations.underlyingPrice,
    iv: legObservations.iv,
    bsmIv: legObservations.bsmIv,
    bsmDelta: legObservations.bsmDelta,
    bsmGamma: legObservations.bsmGamma,
    bsmTheta: legObservations.bsmTheta,
    bsmVega: legObservations.bsmVega,
    source: legObservations.source,
    // OPS-01 fix: add `time: legObservations.time,` here
  })
  .from(legObservations)
  .where(eq(legObservations.contract, occSymbolRaw))
  .orderBy(desc(legObservations.time))
  .limit(1);
```

### OPS-01 — `buildSnapshotRow`'s existing zero-default (the visible symptom, unchanged by this fix — it becomes unreachable for stale/missing legs once the gate runs first)
```typescript
// packages/core/src/journal/application/snapshotCalendars.ts:79-82 (current, verified)
const frontMark = front?.mark ?? 0;
const backMark = back?.mark ?? 0;
const netMark = backMark - frontMark;
```

### OPS-02 — the existing single-shot shape being replaced
```typescript
// packages/core/src/journal/application/computeBsmGreeks.ts:89-101, 196-202 (current, verified)
const pendingResult = await deps.readPending(MAX_BATCH_SIZE); // reads up to 24000 rows, ONCE
// ... solve loop over the entire batch in memory, no I/O checkpoints ...
if (writes.length > 0) {
  const writeResult = await deps.writeBsm(writes); // ONE write call for everything, at the very end
  if (!writeResult.ok) return err(writeResult.error);
}
```

### OPS-02 — `writeBsmResults` is already transactional per call (confirms batching gives free durability)
```typescript
// packages/adapters/src/postgres/repos/leg-observations.ts:227-256 (current, verified)
await db.transaction(async (tx) => {
  for (const write of writes) {
    await tx.update(legObservations).set({ bsmIv: write.bsmIv, /* ... */ })
      .where(and(eq(legObservations.time, write.time), eq(legObservations.contract, write.contract)));
  }
});
```
Calling this once per 800-row batch (instead of once per 24,000-row run) is the entire durability fix — no change needed to this function.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `resolveLegSnapshot` returns `LegSnapshot \| null` with no timestamp | `LegSnapshot` carries `time: Date`; use-case gates on it | This phase (OPS-01) | Enables the skip-vs-serve-stale decision that was structurally impossible before. |
| `computeBsmGreeks` reads-solves-writes as one atomic unit | Batch loop with wall-clock budget, many small commits | This phase (OPS-02) | Converts "lose the whole run on any kill" into "lose at most one batch (~800 rows, ~1 min of work)." |

**Deprecated/outdated:** None — no libraries or APIs are being swapped, only internal control flow.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS = 45min` (1.5x the 30-min chain cadence) is the right tolerance | Pattern 1 | Too tight: false-positive skips during ordinary chain-fetch jitter (e.g., a slow compute-bsm-greeks run delaying the chain-triggered snapshot-calendars invocation by a few minutes), producing MORE gaps than today. Too loose: doesn't catch real outages fast enough. Recommend confirming with the user or tuning after a few days of prod observation — Claude's Discretion per CONTEXT, but the exact minute value is my judgment call, not verified against an existing constant elsewhere in the repo. |
| A2 | `COMMIT_BATCH_SIZE = 800` and `BSM_TIME_BUDGET_MS = 700_000` (~11.7 min) keep each batch under ~60s and the whole run under 900s | Pattern 2, Pitfall 3 | Derived from CONTEXT's own reported range (12,000 rows in 10-14 min → 14.3-20 rows/sec) — worst case (14.3/s): 800 rows ≈ 56s/batch, budget+last-batch ≈ 806s (94s margin under 900s). If actual production rate is slower than the worst case observed so far (e.g., under heavier concurrent DB load), retune down. This is a tunable constant, not a structural risk — the loop shape self-corrects regardless of the exact numbers (worst case: more batches roll to the next chain-trigger, never a hard failure). |
| A3 | Steady-state new-pending volume per chain cycle (~15k rows, per the existing dual-source doc comment) may NOT fully drain within a single `BSM_TIME_BUDGET_MS` window even with batching, and that's acceptable ("24k rows/day-ish" per CONTEXT, not "24k rows/single-run") | Summary, Open Questions | If the user's actual expectation is "every single chain cycle's new volume is 100% solved before the NEXT cycle fires," partial-drain carryover across 2 cycles could look like a regression rather than expected behavior. Flagged explicitly below as an Open Question — needs a one-line confirmation from the user or the planner should document this explicitly as expected behavior in the plan's acceptance criteria. |

## Open Questions (RESOLVED)

1. **Does "a full-cohort recompute completes within ONE handler cycle" (CONTEXT, OPS-02) mean one pg-boss job invocation, or one 30-min chain-trigger cadence?**
   - What we know: at the observed solve rate (14.3-20 rows/sec), a genuinely fresh 24k-row cohort takes 20-28 minutes of pure compute — mathematically cannot complete inside a single 900s pg-boss invocation no matter how it's batched (batching changes commit granularity, not total CPU time).
   - What's unclear: whether CONTEXT's "24k rows/day-ish" + "ONE handler cycle" language anticipated this, or expects the fix to also somehow speed up solving (out of scope — CONTEXT doesn't ask for that).
   - Recommendation: the plan should state acceptance criteria as "no run ever times out or loses committed progress; the pending backlog trends to zero across the 30-min chain-trigger cadence" rather than "every single run's entire read reaches zero pending" — this matches what CONTEXT's guardrails actually protect against (the timeout+retry dance) without requiring an impossible compute-speed guarantee. Surface this framing to the user before finalizing the PLAN's acceptance criteria.

2. **Should the OPS-01 skip be visible to the operator beyond `console.warn`?**
   - What we know: `ForReadingJobRuns`/`JobRunMap` (`ports.ts:392-405`) already tracks per-job `lastSuccessAt`/`lastErrorAt`/`lastError` at the JOB level, surfaced in `GET /api/status`. It has no per-calendar-skip granularity.
   - What's unclear: whether a run with 1-2 skipped calendars (of e.g. 5 open) should still register as `lastSuccessAt` (since the use-case returns `ok`) or whether the operator needs to see "N calendars skipped this cycle" surfaced anywhere beyond worker logs.
   - Recommendation: CONTEXT explicitly leaves this to Claude's Discretion and says "follow existing handler logging conventions" — `console.warn` (matching the existing RTH-skip warn at `snapshot-calendars.ts:51` and the orphaned-symbols warn at `leg-observations.ts:209`) is the consistent, lowest-footprint choice. No new job_run schema needed. If the user wants richer operator visibility later, that's a natural follow-up, not blocking for this phase.

## Environment Availability

Skipped — this phase is a pure code-path restructure of existing pipeline behavior (no new external tool, service, or runtime dependency). Postgres and pg-boss are already-provisioned infra this phase reads from but does not newly depend on.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (root `vitest.config.ts` workspace; `packages/core` has its own `vitest.config.ts`) + fast-check (property tests) + testcontainers (Postgres contract tests) — per `tdd.md` |
| Config file | `/vitest.config.ts` (workspace root), `packages/core/vitest.config.ts` |
| Quick run command | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts packages/core/src/journal/application/computeBsmGreeks.test.ts` |
| Full suite command | `bun run test` (root `vitest run`, all workspaces) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-01 | Calendar with no leg observation in window (Jul-06 zero-row shape) → row SKIPPED, not zero-written | unit | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` | ✅ file exists, add new `describe` block |
| OPS-01 | Calendar with a leg older than tolerance (stale-serve shape) → row SKIPPED, not silently served | unit | same file | ✅ (extend) |
| OPS-01 | Calendar with both legs fresh → row written exactly as today (D-05/D-06 unchanged, regression guard) | unit | same file | ✅ (existing tests must stay green) |
| OPS-01 | `resolveLegSnapshot`/`getLatestLegObs` actually return the real `time` column from Postgres | contract (testcontainers) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts packages/adapters/src/postgres/repos/leg-observations.*.test.ts` | ✅ (extend `__contract__/calendar-snapshots.contract.ts` assertions) |
| OPS-02 | A batch under `COMMIT_BATCH_SIZE` fully drains in one loop pass, `ok` returned | unit | `bun run test -- packages/core/src/journal/application/computeBsmGreeks.test.ts` | ✅ (extend) |
| OPS-02 | Pending count exceeds one batch → multiple `writeBsm` calls, each with ≤`COMMIT_BATCH_SIZE` rows | unit | same file | ✅ (extend — assert `writeBsm` call count/sizes via a capturing double, mirroring `snapshotCalendars.test.ts`'s existing capture-array pattern) |
| OPS-02 | Time budget exhausted mid-drain → loop exits with `ok(undefined)` and pending rows remain (not an error) | unit | same file | ✅ (extend — inject a fake `now()` that advances past the budget) |
| OPS-02 | Kill mid-drain (simulated: only call the use-case for N batches worth of budget) → already-written batches persist in Postgres; a second invocation resumes and finishes | contract (testcontainers) | `bun run test -- packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` | ✅ file exists — extend with a new `describe` block modeled on the existing SC3/D-15 drain-to-zero test, adding a budget-interrupted-then-resumed scenario |

### Sampling Rate
- **Per task commit:** the two targeted files above (`snapshotCalendars.test.ts`, `computeBsmGreeks.test.ts`) — fast, no Docker.
- **Per wave merge:** full contract-test files (`calendar-snapshots.contract.test.ts`, `leg-observations.bsm-drain.contract.test.ts`) — requires Docker (testcontainers), per `tdd.md`'s "Postgres repos → testcontainers against real Postgres" rule.
- **Phase gate:** `bun run test` (full suite) green before `/gsd-verify-work 25`; plus the two live verification queries CONTEXT already specifies (gap-row count stays 0, BSM durations drop well under 900s) run by the orchestrator post-deploy.

### Wave 0 Gaps
None — `snapshotCalendars.test.ts`, `computeBsmGreeks.test.ts`, `calendar-snapshots.contract.test.ts`, and `leg-observations.bsm-drain.contract.test.ts` all already exist with the exact fixture/capture patterns (`makeLegSnapshot`, `makePersistCapture`, `runBsmDrainContractTests`) needed to extend for both OPS-01 and OPS-02 — no new test file or framework install required.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase touches no auth surface — internal worker job logic only. |
| V3 Session Management | No | Same. |
| V4 Access Control | No | Same. |
| V5 Input Validation | No new surface | No new external input — `LegSnapshot.time` comes from a trusted internal DB column (Postgres `timestamptz`, not user input); batch-size/budget constants are hardcoded, not parsed from any request. |
| V6 Cryptography | No | Not touched. |

### Known Threat Patterns for {stack}

None applicable — this phase has no new attacker-reachable surface (no new HTTP route, no new MCP tool, no new user input parsing). The only "input" affected is internal pipeline data (leg observation timestamps, pending-row counts) already fully trusted within the existing hexagonal boundary. `security_enforcement: true` / ASVS L1 is satisfied by confirming no new surface is introduced — no additional controls needed for this phase.

## Sources

### Primary (HIGH confidence — direct repo read, this session)
- `packages/core/src/journal/application/snapshotCalendars.ts` — full use-case + D-05/D-06 doc comments
- `packages/core/src/journal/application/ports.ts` — `LegSnapshot`, `SnapshotRow`, all port signatures
- `packages/core/src/journal/application/computeBsmGreeks.ts` — full use-case, `MAX_BATCH_SIZE` history/rationale
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — `resolveLegSnapshot`, `persistSnapshot`, `mapSnapshotRow`
- `packages/adapters/src/postgres/repos/leg-observations.ts` — `readPendingObs`, `writeBsmResults`, `getLatestLegObs`
- `packages/adapters/src/memory/calendar-snapshots.ts`, `packages/adapters/src/memory/leg-observations.ts` — twin parity surface
- `apps/worker/src/handlers/snapshot-calendars.ts`, `apps/worker/src/handlers/compute-bsm-greeks.ts` — thin-adapter RTH gate + chain-trigger wiring
- `apps/worker/src/schedule.ts`, `apps/worker/src/main.ts` — full cron/chain-trigger topology, composition root wiring
- `packages/shared/src/rth-window.ts` — `isWithinRth` implementation (confirms no AH path reaches the journal write)
- `node_modules/.bun/pg-boss@12.18.3/node_modules/pg-boss/dist/plans.js:24-33` — `QUEUE_DEFAULTS` (`expire_seconds: FIFTEEN_MINUTES`, `retry_limit: 2`, `retry_backoff: false`) — installed dependency source, authoritative for the exact version in use
- `packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` — existing drain contract-test pattern to extend
- `docs/architecture/jobs.md` — current documented behavior, cross-checked against `schedule.ts` (found 2 stale lines, Pitfall 4)

### Secondary (MEDIUM confidence)
- None — no web sources were needed; all findings verified against the actual codebase and installed dependency.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- OPS-01 root cause: HIGH — directly traced `resolveLegSnapshot`'s missing staleness bound and `buildSnapshotRow`'s zero-default against the exact Jul-06 forensic shape (3 stale-served + 2 zero-row calendars); confirmed the RTH gate makes AH a non-issue by reading `isWithinRth` and the handler gate directly.
- OPS-02 root cause: HIGH — directly traced the single read-solve-write-once shape and confirmed `writeBsmResults`'s per-call transaction boundary; confirmed pg-boss's actual 900s/retry defaults against the installed package source (not assumed from training data).
- Fix architecture (constants, batch size, tolerance): MEDIUM — the loop/gate shapes are HIGH confidence (directly derivable from the ports and existing patterns), but the exact numeric constants (`45min`, `800`, `700_000ms`) are my calibration from CONTEXT's reported rate range, not independently re-measured against live prod — flagged in Assumptions Log A1/A2 for the planner to treat as tunable, not fixed.

**Research date:** 2026-07-09
**Valid until:** 30 days (stable internal control-flow domain; no external API/library version drift risk)
