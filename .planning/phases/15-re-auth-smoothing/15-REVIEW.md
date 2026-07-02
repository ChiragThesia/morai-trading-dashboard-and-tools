---
phase: 15-re-auth-smoothing
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - apps/server/src/adapters/http/jobs.routes.test.ts
  - apps/server/src/adapters/http/status.routes.test.ts
  - apps/server/src/adapters/mcp/tools/trigger-job.ts
  - apps/server/src/adapters/refresh-expiry-warner.test.ts
  - apps/server/src/adapters/refresh-expiry-warner.ts
  - apps/server/src/adapters/status-dto.ts
  - apps/server/src/main.ts
  - apps/web/src/components/AuthExpiredBanner.test.tsx
  - apps/web/src/components/AuthExpiredBanner.tsx
  - apps/worker/src/handlers/fetch-schwab-chain.test.ts
  - packages/adapters/src/memory/broker-tokens.ts
  - packages/contracts/src/jobs.test.ts
  - packages/contracts/src/jobs.ts
  - packages/contracts/src/status.test.ts
  - packages/contracts/src/status.ts
  - packages/core/src/brokerage/application/ports.ts
  - packages/core/src/brokerage/application/refreshTokens.test.ts
  - packages/core/src/brokerage/application/selectChainSource.test.ts
  - packages/core/src/brokerage/domain/token-freshness.test.ts
  - packages/core/src/brokerage/domain/token-freshness.ts
  - packages/core/src/journal/application/getStatus.test.ts
  - apps/sidecar/seed_token.py
  - docs/operations/schwab-reauth-runbook.md
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Reviewed the AUTH-05/AUTH-06 re-auth smoothing changes: the `refreshExpiresIn`
domain function and its threading through ports, contract, DTO, and both status
surfaces; the `withRefreshExpiryWarning` composition-root decorator; the amber
pre-expiry banner state; the retirement of `refresh-tokens` from the trigger
surface; and the `seed_token.py` hardening plus operator runbook.

The core is sound. `refreshExpiresInSeconds` is pure, clamped, and boundary-tested
consistently with `isNearExpiry` (>= 6d threshold verified at ±1 minute).
The decorator latch is correct: per-app, re-arms on null, warns before latching a
throwing sink, never mutates the payload, and is wired exactly once in `main.ts`
so HTTP and MCP share one latch. Contract, DTO, and both status-route round-trip
tests cover null / 0 / positive values. Project rules hold: no `any`/`as`/`!` in
new code, Zod at every boundary, `Result` types throughout, core imports shared
only, and the in-memory twin was updated with the port change.

Four warnings survive adversarial reading. The most operationally significant:
`seed_token.py exchange` exits 0 and prints "seeded ... Done" even when every
token exchange failed (WR-01), and the web UI goes completely silent when the
market app actually expires — the amber warning vanishes at the exact moment it
matters most (WR-02).

## Warnings

### WR-01: `seed_token.py exchange` reports success after a failed exchange

**File:** `apps/sidecar/seed_token.py:164-181, 219-237`
**Issue:** `step_exchange` collects `failures` (line 164, appended at 178) but
never reads it. After a per-app exchange failure the script still calls
`_verify_and_finish`, which only checks `token_json IS NOT NULL`. On a re-auth
(this phase's primary scenario) the STALE row from the previous seed is still
present, so a totally failed exchange prints `trader: seeded`, `market: seeded`,
`Done. Now restart the sidecar...` and exits 0. The runbook (Step 2) tells the
operator this verification line confirms the exchange; an operator (or an agent
scripting this) can restart the sidecar against expired tokens believing recovery
succeeded. The `EXCHANGE FAILED` line scrolls by above the false-positive summary.
Pre-existing in part, but the failure path is the reason this file is in a
re-auth-smoothing phase, and this phase edited the success message.
**Fix:**
```python
    _verify_and_finish(db_url)
    if failures:
        sys.exit(f"Exchange FAILED for: {', '.join(failures)} — do NOT restart the sidecar; re-run authurl/exchange for the failed app(s).")
```
Additionally have `_verify_and_finish` check `refresh_issued_at > now() - interval '5 minutes'`
(or compare against a timestamp captured before the exchange) instead of mere
`token_json` presence, so a stale row cannot masquerade as a fresh seed.

### WR-02: Web UI is completely silent when the market app is AUTH_EXPIRED

**File:** `apps/web/src/components/AuthExpiredBanner.tsx:45-52`
**Issue:** The red gate is trader-only (documented residual gap). The new amber
gate explicitly excludes `market.status === "AUTH_EXPIRED"`. Net behavior for the
market app: amber banner during T-24h → **nothing at all** once it actually
expires — the warning disappears at the moment of failure, and the trader keeps
seeing a clean dashboard while Schwab chain pulls have silently fallen back to
CBOE. The doc comment acknowledges the red gap but not that AUTH-05's amber state
now actively *removes* a visible signal on the market-expiry transition. Note the
domain guarantees `refreshExpiresIn === 0` (non-null) for an expired app, so the
data to keep some banner up is already on the wire. There is also no test for the
market-AUTH_EXPIRED / trader-fresh combination (the test helper pins market to
`"fresh"` except via `refreshExpiresIn`).
**Fix:** Either extend the amber branch to cover a market-only expiry with
accurate copy ("market app auth expired — chain fell back to CBOE; re-auth per
runbook"), or drop the `market.status !== "AUTH_EXPIRED"` exclusion and branch
the copy on `market.status`. Add a test:
```tsx
it("shows a banner when market is AUTH_EXPIRED and trader is fresh", ...)
```
If deferral is deliberate, record it as a tracked gap (workflow.md: hacks need a
tracking issue), not only a code comment.

### WR-03: Architecture docs still describe the retired `refresh-tokens` job as an active daily cron

**File:** `docs/architecture/deployment.md:54` (also `docs/architecture/jobs.md:27, 161`)
**Issue:** This phase removed `refresh-tokens` from `TRIGGERABLE_JOBS` and the MCP
tool description, and edited `deployment.md` two lines *below* a bullet that
still reads "`refresh-tokens` job (04:00 ET daily) keeps **access** tokens
fresh." `jobs.md` still lists it in the cron table and keeps its full section.
workflow.md declares the `docs/architecture/` set the source of truth and
requires reconciliation when code contradicts it — the phase touched the
surrounding text and left the contradiction in place.
**Fix:** Update `deployment.md:54` to state the sidecar is the sole token
refresher (GW-03) and mark/remove the `refresh-tokens` rows in `jobs.md:27` and
the section at `jobs.md:161` as retired.

### WR-04: Memory twin cannot clear `lastRefreshError` to null over a row-level error (`??` swallows the explicit null)

**File:** `packages/adapters/src/memory/broker-tokens.ts:50, 84-85`
**Issue:** `recordRefreshOutcome(appId, null)` stores an explicit `null` to mean
"last refresh succeeded — clear the flag." But every read merges with
`refreshErrors.get(appId) ?? row.lastRefreshError`, and `??` treats the stored
`null` as absent, falling back to the row's stale `lastRefreshError`. A test that
seeds a row with a non-null `lastRefreshError` and then records a successful
refresh will still see the old error — the Postgres repo (which persists the NULL)
behaves correctly. This is exactly the twin/prod divergence class that
architecture-boundaries §8 and the phase 5-6 lessons exist to prevent, in the file
this phase touched.
**Fix:**
```ts
const lastRefreshError = refreshErrors.has(appId)
  ? (refreshErrors.get(appId) ?? null)
  : row.lastRefreshError;
```
Apply the same `has()`-based merge at lines 84-85.

## Info

### IN-01: `STATE_FILE` is written by `authurl` but never read by `exchange`

**File:** `apps/sidecar/seed_token.py:66, 109-111, 170`
**Issue:** Step A persists per-app OAuth `state` to a temp file and prints "(saved
per-app OAuth state...)"; the module docstring's SECURITY note says the persisted
state is "the only thing persisted between steps." Step B never opens the file —
it takes `state` from the pasted redirect URL instead (which also makes the
CSRF-state check self-referential, as the inline comment concedes). Dead
persistence plus a misleading security note.
**Fix:** Delete the `STATE_FILE` write and its messaging, or actually read it in
`step_exchange` and cross-check against the URL's state.

### IN-02: `_verify_and_finish` never prints MISSING for an app with no row

**File:** `apps/sidecar/seed_token.py:222-232`
**Issue:** The query returns only existing rows; an app that was never inserted
produces no line at all, so the promised `MISSING` branch is unreachable for the
worst case. First-ever seed failure shows an empty verification block.
**Fix:** Iterate over `("trader", "market")` and report `MISSING` for app_ids
absent from the result set.

### IN-03: `makeRefreshTokensUseCase` is dead code with a maintained test suite

**File:** `packages/core/src/brokerage/application/refreshTokens.test.ts` (use-case in `refreshTokens.ts`)
**Issue:** After the GW-03 retirement, `makeRefreshTokensUseCase` has no consumer
outside core's own exports (worker handler removed in phase 11). This phase
updated its test fixtures (adding `refreshExpiresIn`) instead of deleting the
dead use-case + suite, extending the maintenance surface of retired code.
**Fix:** Delete `refreshTokens.ts`, its test, and the `index.ts` exports in a
dedicated cleanup commit — or record why the use-case is intentionally retained.

### IN-04: Untyped freshness mock in fetch-schwab-chain test drifts from `AppTokenStatus`

**File:** `apps/worker/src/handlers/fetch-schwab-chain.test.ts:79-84`
**Issue:** The `readTokenFreshness` double is `vi.fn().mockResolvedValue(...)`
(unchecked), and its rows omit `lastRefreshError` while this phase added
`refreshExpiresIn`. The fixture no longer matches the port's row shape, and the
compiler cannot catch the next field it misses.
**Fix:** Type the double as `ForReadingTokenFreshness` (as the sibling
selectChainSource tests do) and add the missing `lastRefreshError: null` fields.

### IN-05: Memory twin duplicates the `none_yet` literal four times with dead `!== undefined` guards

**File:** `packages/adapters/src/memory/broker-tokens.ts:99-163`
**Issue:** `traderLastError`/`marketLastError` are `string | null` after the `??`
merge, so the `!== undefined` checks (lines 99, 121) are dead. Four hand-built
`none_yet` status objects duplicate the same shape; a `noneYetStatus(lastError)`
helper collapses ~60 lines to ~15 and removes the field-omission risk that WR-04's
class of bug feeds on.
**Fix:** Extract a helper and drop the dead `undefined` comparisons.

### IN-06: Warning copy is wrong for an already-expired app ("0s remaining ... before expiry")

**File:** `apps/server/src/adapters/refresh-expiry-warner.ts:56-58`
**Issue:** If the first status poll happens after the 7-day cutoff,
`refreshExpiresIn` is 0 and the log reads "nearing 7-day re-auth cutoff — 0s
remaining, re-auth required before expiry" for a token that has already expired.
Harmless but misleading in the exact log line an operator greps during an outage.
**Fix:** Branch the message on `refreshExpiresIn === 0` ("refresh token EXPIRED —
re-auth now") vs. positive seconds.

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
