---
phase: 11-sidecar-scaffold-auth-migration
plan: "07"
subsystem: auth
tags: [schwab, oauth, workspace, tsconfig, eslint, cleanup]

requires:
  - phase: 11-05
    provides: sidecar client_from_manual_flow seeds token_json; sidecar owns Schwab OAuth dance + auto-refresh
  - phase: 11-06
    provides: worker refresh-tokens job retired; chain source swapped to sidecar (JRNL-02)
provides:
  - apps/auth (@morai/auth) deleted from repo — no second OAuth/refresh path exists
  - tsconfig.json root project references cleaned (apps/auth entry removed)
  - eslint.config.js parserOptions.project lists cleaned (apps/auth/tsconfig.json removed from both arrays)
  - bun.lock re-resolved with 1 workspace package removed
  - Full workspace typecheck + lint + test green after removal
affects: [12-streaming, 15-reauth]

tech-stack:
  added: []
  patterns:
    - "Workspace retirement: git rm tracked files + manual symlink cleanup + bun install re-resolve"
    - "Devtool config cleanup: eslint.config.js parserOptions.project must be updated whenever a workspace app is added or removed"

key-files:
  created: []
  modified:
    - tsconfig.json
    - eslint.config.js
    - bun.lock

key-decisions:
  - "eslint.config.js listed apps/auth/tsconfig.json in two parserOptions.project arrays — both removed as Rule 1 auto-fix (lint would fail with TS5012 ENOENT after deletion)"
  - "Root package.json workspaces uses apps/* glob — no explicit @morai/auth entry existed; bun install removal of 1 package confirmed cleanup was automatic"
  - "backfill-transactions.ts comment referencing apps/auth/src/main.ts left untouched per plan prohibition — prose reference, not an import"

patterns-established:
  - "When removing a workspace app, always search eslint.config.js parserOptions.project arrays for stale tsconfig references"

requirements-completed: [GW-03]

duration: 3min
completed: "2026-06-25"
status: complete
---

# Phase 11 Plan 07: Retire apps/auth Summary

**apps/auth (@morai/auth) deleted from repo and workspace; Schwab auth now consolidated solely in the Python sidecar (D-04, GW-03); workspace typecheck + lint + test all green**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-25T22:30:01Z
- **Completed:** 2026-06-25T22:33:39Z
- **Tasks:** 2
- **Files modified:** 3 (tsconfig.json, eslint.config.js, bun.lock) + 11 deleted (apps/auth source files)

## Accomplishments

- Deleted all of `apps/auth/` — package.json, 5 source files, 2 test files, tsconfig.json, vitest.config.ts (11 tracked files via `git rm -r`)
- Removed `{ "path": "apps/auth" }` from root `tsconfig.json` project references
- Removed `apps/auth/tsconfig.json` from both `parserOptions.project` arrays in `eslint.config.js` (Rule 1 auto-fix — dangling reference caused lint failure)
- `bun install` confirmed 1 workspace package removed cleanly
- Full workspace green: `bun run typecheck` clean, `bun run lint` clean, `bun run test` 136 files / 1227 tests passed

## Task Commits

1. **Task 1: Retire apps/auth and remove from root workspace wiring** - `4ba636a` (chore)
2. **Task 2: Fix eslint.config.js + prove workspace green** - `b997c6c` (fix)

## Files Created/Modified

- `apps/auth/` — DELETED (entire directory: package.json, src/{main,config,setup,refresh,status,doctor}.ts, src/{setup,doctor}.test.ts, tsconfig.json, vitest.config.ts)
- `tsconfig.json` — removed `{ "path": "apps/auth" }` from references array
- `eslint.config.js` — removed `"apps/auth/tsconfig.json"` from both parserOptions.project arrays
- `bun.lock` — regenerated after workspace package removal (1 package removed)

## Decisions Made

None beyond plan — removal was surgical; no architectural choices needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] eslint.config.js retained stale apps/auth/tsconfig.json references**

- **Found during:** Task 2 (prove workspace green)
- **Issue:** `bun run lint` failed with `error TS5012: Cannot read file '.../apps/auth/tsconfig.json': ENOENT` on all web source files. `eslint.config.js` had `apps/auth/tsconfig.json` in two places: the TypeScript import resolver's `project` array (line 40) and the `parserOptions.project` array for typed lint rules (line 118).
- **Fix:** Removed both `"apps/auth/tsconfig.json"` entries from `eslint.config.js`.
- **Files modified:** `eslint.config.js`
- **Verification:** `bun run lint` passed cleanly (warnings only — boundaries legacy selector and multi-project hint, both pre-existing).
- **Committed in:** `b997c6c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — dangling eslint reference to deleted tsconfig)
**Impact on plan:** Necessary correctness fix; no scope creep. The plan noted only tsconfig.json and package.json as workspace wiring — eslint.config.js was an additional coupling point not enumerated in the plan but directly caused by the same deletion.

## Issues Encountered

None beyond the eslint.config.js auto-fix above.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. This plan only removes code — the second OAuth/refresh path (`apps/auth`) is gone; T-11-07-01 (tampering via second writer) is mitigated.

## Known Stubs

None — this plan deleted code, created no new stubs.

## Next Phase Readiness

- D-04 satisfied: the TS `apps/auth` OAuth setup/refresh client is retired; the sidecar (apps/sidecar, 11-05) is the sole owner of the Schwab dance + refresh.
- GW-03 reinforced: no second token-writer path remains in the repo.
- Phase 11 complete. Phase 12 (streaming) can proceed once the sidecar is live in production and the Schwab OAuth dance has been run manually to seed `token_json`.

## Self-Check: PASSED

- `test ! -d apps/auth` → PASS (directory does not exist)
- `grep -rl '@morai/auth' apps packages` → 0 files (no references)
- `grep 'apps/auth' tsconfig.json` → no match
- `grep 'apps/auth' eslint.config.js` → no match (after fix)
- `bun install` → succeeded (1 package removed)
- `bun run typecheck` → clean (no errors)
- `bun run lint` → clean (warnings only)
- `bun run test` → 136 files / 1227 tests passed
- Commits `4ba636a` and `b997c6c` verified in git log

---
*Phase: 11-sidecar-scaffold-auth-migration*
*Completed: 2026-06-25*
