---
phase: 15-re-auth-smoothing
fixed_at: 2026-07-02T16:45:00Z
review_path: .planning/phases/15-re-auth-smoothing/15-REVIEW.md
iteration: 2
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-07-02T16:45:00Z
**Source review:** .planning/phases/15-re-auth-smoothing/15-REVIEW.md
**Iteration:** 2 (iteration 1: WR-01..WR-04, fix_scope critical_warning; iteration 2: IN-01..IN-06, fix_scope all)

**Summary:**
- Findings in scope: 10 (4 Warning fixed in iteration 1, 6 Info fixed in iteration 2)
- Fixed: 10
- Skipped: 0

## Fixed Issues

### WR-01: `seed_token.py exchange` reports success after a failed exchange

**Files modified:** `apps/sidecar/seed_token.py`
**Commit:** d8cacd4 _(iteration 1)_
**Applied fix:** `step_exchange` now passes its `failures` list to `_verify_and_finish`,
which exits non-zero naming the failed app(s) ("do NOT restart the sidecar") and suppresses
the "Done. Now restart" instruction when any exchange failed. Verification query changed
from `token_json IS NOT NULL` to `refresh_issued_at > now() - interval '5 minutes'`, so a
stale row from a previous seed prints `STALE — not written by this run` instead of `seeded`.
Verified with `python3 ast.parse` (clean).

### WR-02: Web UI is completely silent when the market app is AUTH_EXPIRED

**Files modified:** `apps/web/src/components/AuthExpiredBanner.tsx`, `apps/web/src/components/AuthExpiredBanner.test.tsx`
**Commit:** b3d3470 _(iteration 1)_
**Applied fix:** Added an `isMarketExpired` gate: a market-only AUTH_EXPIRED now keeps the
amber banner up with accurate copy ("Schwab market app auth expired — chain data fell back
to CBOE. Re-auth per `docs/operations/schwab-reauth-runbook.md`."). Red (trader) keeps
precedence. Doc comment updated to reflect the new gate. TDD: the review's suggested
market-expired test plus a both-expired red-precedence test were added first and run RED,
then the gate change — suite GREEN 12/12 (`bunx vitest run` in `apps/web`).

### WR-03: Architecture docs still describe the retired `refresh-tokens` job as an active daily cron

**Files modified:** `docs/architecture/deployment.md`, `docs/architecture/jobs.md`
**Commit:** d6d835f _(iteration 1)_
**Applied fix:** `deployment.md` token-persistence bullet now states the schwab-py sidecar
is the sole token refresher (GW-03, `refresh-tokens` cron retired). `jobs.md`: cron-table
row marked RETIRED (GW-03) pointing at the section; the "Token refresh at 04:00 ET" notes
bullet reconciled; the full `refresh-tokens` section replaced with a RETIRED section
recording the Phase 5 origin, Phase 11 sidecar cutover, and Phase 15 trigger-surface
removal, plus the surviving 7-day re-auth facts (runbook + `refreshExpiresIn` warning).

### WR-04: Memory twin cannot clear `lastRefreshError` to null (`??` swallows the explicit null)

**Files modified:** `packages/adapters/src/memory/broker-tokens.ts`, `packages/adapters/src/memory/broker-tokens.test.ts`
**Commit:** 21da1e0 _(iteration 1)_
**Applied fix:** Replaced the `??`-based merge with the review's `has()`-based merge in both
`readTokens` and `readTokenFreshness`, so an explicitly recorded `null` ("last refresh
succeeded — clear the flag") wins over the row's stale value — matching the Postgres repo.
TDD: created `broker-tokens.test.ts` (twin had no test file) with two null-clear regression
tests (run RED first) plus a non-null flag-ownership baseline — GREEN 3/3. Root
`bun run typecheck` reports no errors in the touched files (pre-existing TS2307
workspace-resolution noise from raw `bunx tsc` confirmed pre-existing via stash baseline).

### IN-01: `STATE_FILE` is written by `authurl` but never read by `exchange`

**Files modified:** `apps/sidecar/seed_token.py`
**Commit:** 6233d67 _(iteration 2)_
**Applied fix:** Deleted the dead `STATE_FILE` constant, the `states` dict, the
`json.dump` write, and the "(saved per-app OAuth state...)" print from `step_authurl`.
Corrected the module docstring: Step A no longer claims to save state; the SECURITY note
now reads "nothing is persisted between steps (step B takes the OAuth `state` from the
pasted redirect URL)"; Step B's docstring states where its state comes from.
Grep-verified zero remaining `STATE_FILE` references. `python3 -m py_compile` clean
(seed_token.py has no test file in `apps/sidecar/tests/`).

### IN-02: `_verify_and_finish` never prints MISSING for an app with no row

**Files modified:** `apps/sidecar/seed_token.py`
**Commit:** a5b6b12 _(iteration 2)_
**Applied fix:** Verification now iterates over `("trader", "market")` against a dict of
returned rows and prints `MISSING — no broker_tokens row` for any app absent from the
result set, so a first-ever seed failure no longer shows an empty verification block.
`python3 -m py_compile` clean.

### IN-03: `makeRefreshTokensUseCase` is dead code with a maintained test suite

**Files modified:** `packages/core/src/brokerage/application/refreshTokens.ts` (deleted),
`packages/core/src/brokerage/application/refreshTokens.test.ts` (deleted),
`packages/core/src/brokerage/index.ts`, `packages/core/src/index.ts`
**Commit:** 0441538 _(iteration 2)_
**Applied fix:** Deleted the GW-03-retired use-case and its test suite, and removed the
`makeRefreshTokensUseCase` / `RefreshTokensResult` / `AppRefreshOutcome` /
`RefreshTokensDeps` exports from both core index files. Grep-verified before deletion that
the only consumers were core's own index exports and the test file (worker handler removed
in Phase 11; `refreshToken.ts` singular and the oauth-client `refreshTokens` method are
unrelated and untouched). `bun run typecheck` clean; core brokerage suite GREEN 47/47.

### IN-04: Untyped freshness mock in fetch-schwab-chain test drifts from `AppTokenStatus`

**Files modified:** `apps/worker/src/handlers/fetch-schwab-chain.test.ts`
**Commit:** 8801360 _(iteration 2)_
**Applied fix:** Replaced the unchecked `vi.fn().mockResolvedValue(...)` double with a
`const readTokenFreshnessFn: ForReadingTokenFreshness = async () => ok({...})` typed as
the port (matching the sibling selectChainSource tests) and added the missing
`lastRefreshError: null` to both fixture rows — the compiler now catches any future field
drift. `bun run typecheck` clean; suite GREEN 7/7.

### IN-05: Memory twin duplicates the `none_yet` literal four times with dead `!== undefined` guards

**Files modified:** `packages/adapters/src/memory/broker-tokens.ts`
**Commit:** a86953c _(iteration 2)_
**Applied fix:** Extracted a `noneYetStatus(lastRefreshError)` helper and collapsed the
three synthesized-row branches (four hand-built `none_yet` literals, ~75 lines) into one
`freshnessMap` expression (~20 lines): a non-null status row goes through
`toAppTokenStatus`, a missing row gets `noneYetStatus(lastError)`. Dropped the dead
`!== undefined` comparisons and `?? null` fallbacks (the merged values are `string | null`).
Behavior-equivalent by case analysis incl. the `toAppTokenStatus(null, now)` corner (it
returns the same all-null `none_yet` shape). WR-04 regression suite still GREEN; full
memory adapter suite GREEN 160/160; typecheck clean.

### IN-06: Warning copy is wrong for an already-expired app ("0s remaining ... before expiry")

**Files modified:** `apps/server/src/adapters/refresh-expiry-warner.ts`
**Commit:** 0c5600f _(iteration 2)_
**Applied fix:** The warn message now branches on `refreshExpiresIn === 0`: an already-past
cutoff logs `refresh token EXPIRED — 7-day re-auth cutoff passed, re-auth now` instead of
"0s remaining ... re-auth required before expiry". Existing tests (which assert positive
seconds + appId substrings) unaffected — suite GREEN 7/7; typecheck clean.

## Verification (iteration 2)

- Per-fix: `python3 -m py_compile` for seed_token.py; `bun run typecheck` + targeted
  `bunx vitest run <file>` for every TS change.
- Final gate: full `bun run test` GREEN — 150 files passed, 1369 tests passed (21 files /
  168 tests skipped). `bun run lint` clean (pre-existing eslint-boundaries warnings only).
- Note: `apps/web/src/hooks/useLiveStream.test.ts` initially failed inside the isolated
  worktree because the untracked `apps/web/.env.local` (VITE_API_BASE_URL) does not carry
  into worktrees — confirmed passing on the untouched main checkout, then green in the
  worktree after copying the env file. Unrelated to any finding.

---

_Fixed: 2026-07-02T16:45:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
