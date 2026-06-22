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
