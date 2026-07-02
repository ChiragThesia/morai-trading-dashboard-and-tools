---
phase: 14-fred-expansion
fixed_at: 2026-07-01T22:20:00-04:00
review_path: .planning/phases/14-fred-expansion/14-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-07-01 22:20 ET
**Source review:** [14-REVIEW.md](14-REVIEW.md)
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (Critical + Warning; Info findings IN-01..IN-03 out of scope)
- Fixed: 4
- Skipped: 0

**Verification:** `bun run typecheck` clean, `bun run lint` clean,
`bun run test` — 170 files / 1520 tests passed. Every fix followed TDD
red→green: regression test updated first, confirmed failing for the right
reason, then the code fix, then green.

## Fixed Issues

### CR-01: Second `fetch-rates` schedule silently overwrites the first

**Files modified:** `apps/worker/src/schedule.ts`, `apps/worker/src/schedule.test.ts`
**Commit:** a29075f
**Applied fix:** pg-boss v12 upserts schedules on `(name, key)` with `key`
defaulting to `''`, so the 18:30 ET cron overwrote the 09:00 ET cron.
Widened `JobScheduler.schedule` opts with `key?: string` and gave the two
fetch-rates crons distinct keys (`"morning"` / `"evening"`). The test's fake
boss now models the `(name, key)` upsert in a `scheduleStore` and asserts
TWO SURVIVING fetch-rates rows with distinct keys — the regression test
fails on the old code (green-suite blind spot closed, Phase 5/6 lesson).

**Operator step (prod cleanup, also documented in a schedule.ts comment):**
the pre-fix keyless `("fetch-rates", '')` row in the prod `pgboss.schedule`
table is not removed by code and will keep firing at whatever cron it last
held. Delete it once at deploy:

```sql
DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = '';
```

(No `unschedule`-on-boot pattern exists in `apps/worker/src/main.ts`, so
this stays a one-time manual step.)

### WR-01: jobs.md documented gap self-healing that the code does not implement

**Files modified:** `docs/architecture/jobs.md`
**Commit:** 308f227
**Applied fix:** Took the review's option (a) — the minimal honest fix.
Removed the false "self-heals any gap by fetching from `max(date)+1`" claim
and replaced it with a "Gap behavior" paragraph stating reality: each run
persists only the latest observation per series, the `(series_id, date)`
upsert makes re-runs idempotent (D-05) but does NOT backfill missed days,
and historical backfill is not implemented (out of phase scope).

### WR-02: VVIX observation labeled with the UTC calendar day

**Files modified:** `packages/adapters/src/http/cboe-vvix.ts`,
`packages/adapters/src/http/cboe-vvix.test.ts`
**Commit:** fca8c9d
**Applied fix:** Between 20:00 ET and midnight ET the UTC date is already
tomorrow, so late-evening manual `trigger_job` runs stored the session's
VVIX under the next day. The adapter now converts the observed UTC instant
to the `America/New_York` calendar day via
`Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", ... })`.
Test fixture updated first (red→green): `"2026-07-02 01:00:55"` UTC
(21:00 ET July 1) now asserts `date: "2026-07-01"`.

### WR-03: Missing in-memory twins for the two new driven fetch ports

**Files modified:** `packages/adapters/src/memory/fred-series.ts` (new),
`packages/adapters/src/memory/fred-series.test.ts` (new),
`packages/adapters/src/memory/vvix.ts` (new),
`packages/adapters/src/memory/vvix.test.ts` (new),
`packages/adapters/src/index.ts`
**Commit:** 58c766a
**Applied fix:** Added `makeMemoryFredSeriesAdapter` (rows keyed by
seriesId) and `makeMemoryVvixAdapter` (single seedable row) mirroring the
`memory/rate.ts` / `memory/cot.ts` precedent. Both return
`err(FetchError)` when unseeded — D-09 no-fallback parity with the real
adapters (the cot.ts pattern, not rate.ts's lenient fallback). Exported
from `packages/adapters/src/index.ts`; unit tests cover unseeded-err,
seeded-ok, per-series independence, and re-seed upsert semantics
(architecture-boundaries §8 satisfied).

## Skipped Issues

None.

---

_Fixed: 2026-07-01 22:20 ET_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
