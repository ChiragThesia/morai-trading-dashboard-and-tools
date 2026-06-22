# Deferred Items — Phase 06 (discovered during 06-01 execution)

Out-of-scope discoveries logged per the executor SCOPE BOUNDARY rule. NOT fixed in 06-01.

## 1. Stray `* 2.ts` / `* 2.md` cloud-sync duplicate files (45+ in packages/apps)

- **Found during:** Task 2 (schema typecheck)
- **What:** ~45 untracked files with a `" 2"` suffix (e.g. `fills.contract.test 2.ts`,
  `syncFills 2.ts`) exist across `packages/` and `apps/`, plus many `" 2"` planning docs under
  `.planning/phases/05-*`. These are iCloud/Dropbox-style sync conflict copies. All are
  **untracked by git** (`git ls-files` returns none of them).
- **Impact:** They pollute BOTH `bun run typecheck` (errors like `TS6307 (file not in project)`,
  `TS2345 ("dbUrl" not assignable to never)`) and `bun run lint` (15 problems, all in `* 2.ts`
  files, e.g. `strict-boolean-expressions`). They are not part of any plan and do not affect
  tracked source. 06-01's own files are both typecheck-clean and lint-clean.
- **Why deferred:** Deleting untracked files is destructive and out of scope for an analytics
  foundation plan. Recommend a separate cleanup task: `find packages apps .planning -name "* 2.*"`
  and remove after operator confirmation.

## 2. Pre-existing typecheck error: `orphan-fills.contract.ts(128,10)`

- **Found during:** Task 2 (schema typecheck)
- **What:** `error TS2454: Variable 'seed' is used before being assigned` in
  `packages/adapters/src/__contract__/orphan-fills.contract.ts`.
- **Verified pre-existing:** Present on clean HEAD (c3ef139) with the 06-01 schema change
  stashed — not introduced by this plan. From Phase 5 contract-test work.
- **Why deferred:** Out of scope (not caused by 06-01 changes). Belongs to a Phase 5 follow-up
  or a dedicated typecheck-cleanup task.

## 3. 06-02 Task 2: live production Supabase migrate (0007) — DEFERRED

- **Found during:** 06-02 execution (operator scope modification)
- **What:** 06-02 Task 2 is a `checkpoint:human-verify gate="blocking"` step that applies
  `0007_analytics_observations.sql` to the **live** Supabase Postgres via `bun run migrate`.
  Per operator decision (same as phases 03/04/05), the live production push is DEFERRED — NOT
  executed during this run.
- **Action required before deploy:** operator runs `bun run migrate` against the live Supabase
  DB (session pooler / direct URL, max:1 — NOT the 6543 transaction pooler), then re-runs it once
  to confirm a clean no-op (DATA-02 idempotency), then confirms the three tables exist
  (skew_observations, risk_reversal_observations, term_structure_observations).
- **Local validation already done:** the full migration chain (0000→0007) applied cleanly on a
  `postgres:16` testcontainer and a second `runMigrations` run was a clean no-op
  (`migrate.idempotent.test.ts` + `rls.test.ts` both green). The SQL is proven valid + idempotent;
  only the live apply is pending.
- **Does NOT block downstream:** 06-03/06-04/06-05 use testcontainers, which replay the migration
  files (including 0007) to build their schema — they do not need the live DB.
- **Note for the operator:** Postgres emits a NOTICE truncating the
  `risk_reversal_observations_snapshot_time_underlying_expiration_pk` constraint name (65 chars)
  to 63 chars. This is informational, deterministic, and idempotent — not an error.
