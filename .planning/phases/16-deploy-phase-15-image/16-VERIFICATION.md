---
phase: 16-deploy-phase-15-image
verified: 2026-07-03T21:00:00Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: null
deferred:
  - truth: "Live amber banner + warn log observed during the real T-24h window"
    addressed_in: "Post-phase follow-up (~2026-07-08/09, tied to the real Schwab refresh-token expiry)"
    evidence: "16-03-SUMMARY.md 'Scheduled Follow-Ups' item 1 — cannot be forced per D-02; this is the second of a deliberate two-checkpoint verification, checkpoint 1 (key-presence + wiring, same-day) is what DEPLOY-04 requires and is verified in this report"
  - truth: "Live-stream badge + ticking greeks verified during RTH"
    addressed_in: "Post-phase follow-up (~2026-07-06, next RTH session)"
    evidence: "16-03-SUMMARY.md 'Scheduled Follow-Ups' item 2 — deploy ran just past the 16:00 ET close on a pre-holiday-weekend day; D-04 explicitly scopes this sub-check as RTH-bound, not a same-day gate"
---

# Phase 16: Deploy Phase-15 Image Verification Report

**Phase Goal:** Prod runs the phase-15 image on server, worker, and web so the T-24h re-auth alert
surface is verifiably live before the ~2026-07-09 re-auth window, giving every later v1.2 phase a
current (not stale) prod baseline to build on.
**Verified:** 2026-07-03T21:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

This is a deploy/ops-only phase (zero source files changed — every commit across all three plans
is `docs(.planning/...)`, confirmed by `git diff origin/main..HEAD --stat -- packages/ apps/*/src/`
returning empty). Must-haves are operational truths, verified here against LIVE prod state, not
against SUMMARY claims alone.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria for Phase 16)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Server, worker, and web in prod are running the phase-15 build | ✓ VERIFIED | **Live-checked**, not just SUMMARY: `railway deployment list --service server --json --limit 3` → most-recent `status: "SUCCESS"`, `createdAt: 2026-07-03T19:19:11.745Z`. `--service worker` → `status: "SUCCESS"`, `createdAt: 2026-07-03T19:19:20.184Z`. Both match the SUMMARY-claimed DEPLOY_TIME_UTC (19:19:07Z) exactly — same values independently re-pulled from Railway, not re-typed from the SUMMARY. Web: confirmed `220719f` (the commit correlated to the current live prod Vercel deployment per 16-01/16-02 SUMMARY) is a **git descendant** of `b3d3470` (last phase-15 web commit, "WR-02 show amber banner on market-only AUTH_EXPIRED") via `git merge-base --is-ancestor b3d3470 220719f` → true. `curl -o /dev/null -w %{http_code} https://morai.wtf` and `https://morai-web.vercel.app` both return `200`. |
| 2 | The T-24h re-auth alert surface (amber banner, warn log, `refreshExpiresIn`) is visible on both status surfaces (`/api/status` and web) in prod | ✓ VERIFIED | **Live-checked**: `curl https://server-production-f5ca2.up.railway.app/api/status` → `tokenFreshness.trader.refreshExpiresIn: null` (key present) and `tokenFreshness.market.refreshExpiresIn: null` (key present) — `null` is the correct value far from the T-24h window, not a failure. `packages/contracts/src/status.ts:28` confirms `refreshExpiresIn` is a required, non-optional Zod field (`z.number().int().nonnegative().nullable()` — never omitted). `apps/web/src/components/AuthExpiredBanner.tsx` (lines 55-59) reads `trader.refreshExpiresIn !== null \|\| market.refreshExpiresIn !== null` to decide banner state, and is mounted unconditionally in `Shell.tsx:185` for the authenticated app. Web is confirmed at `220719f`, a descendant of the commit that introduced this exact banner logic (`b3d3470`). The Plan 03 SUMMARY additionally records operator confirmation (checkpoint gate `type="checkpoint:human-verify"`, resume-signal "verified") that the live browser's `/api/status` poll carried both keys and the dashboard rendered — this satisfies the phase's own D-02 checkpoint-1 gate, which is the correct scope (checkpoint 2 — observing the banner actually turn amber inside the real window — is properly deferred, see Deferred Items). |
| 3 | Existing live-stream, journal, COT, and FRED functionality shows no regression post-deploy | ✓ VERIFIED | **Live-checked, independently re-run** (not copied from SUMMARY): `curl /api/status \| jq .lastJobRuns` shows `fetch-schwab-chain` (`lastErrorAt 19:31:31Z` AUTH_EXPIRED → `lastSuccessAt 20:01:00.913Z`, recovered) and `sync-fills` (`lastErrorAt 19:51:00Z` → `lastSuccessAt 20:10:30.869Z`, recovered) — these are exactly the two pre-existing baseline errors documented in 16-01-SUMMARY (captured BEFORE the deploy), both self-recovered on the new image, no new error on any previously-healthy job. `compute-bsm-greeks` and `fetch-rates` show only their pre-existing stale errors (2026-07-01 and 2026-06-30 respectively), unrelated to this deploy. Re-ran one live MCP call per remaining tool as a spot-check (bearer pulled read-only from `railway variables --service server`): `get_macro` → returned the same 8 series (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS, VVIX) with values through 2026-07-01..07-03, matching the SUMMARY's claimed result exactly. `get_cot` → returned rows with latest `asOf: 2026-06-23`, `publishedAt: 2026-07-01T16:48:14.548Z`, matching the SUMMARY's claimed result exactly. Both independent re-checks corroborate the SUMMARY was not fabricated. `get_journal` was not independently re-run (would require a specific calendar id and adds no new signal beyond the two independently-confirmed tools) but the SUMMARY's reported values are internally consistent with the independently-verified `compute-analytics`/`snapshot-calendars` timestamps in `lastJobRuns`. Access control: `curl -o /dev/null -w %{http_code} /api/status` → `200`; `/api/jobs` → `401` — confirms the redeploy did not regress the auth boundary. Live-stream check is explicitly, correctly deferred (RTH-bound per D-04; see Deferred Items) — not silently dropped. |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Deferred Items

Two items are correctly out-of-scope-for-now rather than gaps — both are tied to real-world time
windows this same-day phase cannot force, and both are explicitly recorded (not silently dropped)
in 16-03-SUMMARY.md as scheduled follow-ups, not as met success criteria:

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Live amber banner + warn log observed during the real T-24h window | Post-phase follow-up (~2026-07-08/09) | The `refreshExpiresIn` value is `null` today (server confirmed live) because the real token expiry window hasn't arrived — the banner logic is proven wired (Truth 2), but its "turns amber" behavior can only be observed inside the actual window. D-02 explicitly designed this as a two-checkpoint verification; checkpoint 1 (this phase) is complete. |
| 2 | Live-stream badge + ticking greeks verified during RTH | Post-phase follow-up (~2026-07-06) | Deploy work ran 2026-07-03 ~20:09 UTC, just past the 16:00 ET close, with 2026-07-04 a holiday weekend. D-04 scopes this specific sub-check as RTH-bound; the rest of the regression checklist (journal/COT/macro/job-chain) was fully run and passed same-day. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| DEPLOY-04 | 16-01, 16-02, 16-03 | Prod runs the phase-15 image on server/worker/web; T-24h alert surface verifiably live before ~2026-07-09 | ✓ SATISFIED | All 3 ROADMAP success criteria independently live-verified above. `REQUIREMENTS.md:114` already reflects `DEPLOY-04 \| Phase 16 \| Complete`, and `grep "Phase 16" REQUIREMENTS.md` shows no other requirement IDs mapped to this phase — no orphaned requirements. |

### Anti-Patterns Found

None. `git diff origin/main..HEAD --stat -- packages/ apps/*/src/` is empty (confirms the phase's own claim of zero source changes); `grep -n "TBD\|FIXME\|XXX"` across all three SUMMARY files returns no matches.

**One documentation-accuracy note (Info, non-blocking):** 16-02-SUMMARY.md states commit `0c5600f` was "committed 2026-07-02T21:41:25-05:00 = 2026-07-03T02:41:25Z". Independently checking `git show -s --format='%cI' 0c5600f` returns `2026-07-02T16:41:25-05:00`, which converts to `2026-07-02T21:41:25Z` (not `2026-07-03T02:41:25Z` — the SUMMARY's UTC conversion is off by 5 hours, likely a tz-arithmetic slip). This does **not** change the correctness of the phase's central proof: the actual deploy `createdAt` (2026-07-03T19:19:11Z) is after the commit under either the SUMMARY's stated value or the correct one, so Truth 1's timestamp-correlation conclusion still holds. Flagging only so the mis-stated intermediate value isn't propagated as fact elsewhere.

### Key Operational Facts Independently Re-Verified (not merely re-read from SUMMARY)

- `railway deployment list --service server --json --limit 3` → SUCCESS @ `2026-07-03T19:19:11.745Z`
- `railway deployment list --service worker --json --limit 3` → SUCCESS @ `2026-07-03T19:19:20.184Z`
- `curl /api/status` → `db: "ok"`; `refreshExpiresIn` key present (null) on both `tokenFreshness.trader` and `.market`; `lastJobRuns` shows only the two pre-existing baseline errors, both self-recovered
- `curl -o /dev/null -w %{http_code} /api/status` → `200`; `/api/jobs` → `401`
- `curl -o /dev/null -w %{http_code} https://morai.wtf` and `https://morai-web.vercel.app` → `200`
- `curl -o /dev/null -w %{http_code} https://sidecar-production-1b98.up.railway.app/` → `404` (consistent with the accidental domain having no service mapped, corroborating GW-05 restoration, without running the forbidden `railway domain --service sidecar` CLI command)
- Live MCP spot-checks (bearer pulled read-only via `railway variables --service server --json`): `get_macro` and `get_cot` both returned data matching the SUMMARY's claimed values exactly
- `ls packages/adapters/src/postgres/migrations/*.sql \| sort \| tail -1` → `0013_macro_observations.sql` (migration parity claim confirmed)
- `git diff origin/main..HEAD --stat -- packages/ apps/*/src/` → empty (zero source changed, as claimed)

### Human Verification Required

None. The one human-in-the-loop step this phase required (D-02 checkpoint 1: operator confirms
the live browser `/api/status` poll and dashboard render) was already executed as a blocking
`checkpoint:human-verify` gate inside Plan 03 Task 2, with the operator's "verified" resume-signal
and pasted live response recorded in 16-03-SUMMARY.md — not deferred to this verification pass.

### Gaps Summary

No gaps. All three ROADMAP success criteria for Phase 16 are independently confirmed against live
prod state (Railway deployment API, `/api/status`, MCP tool calls, git ancestry), not merely
asserted by the SUMMARYs. The two items intentionally left open (live amber-banner observation
during the real T-24h window; RTH-bound live-stream check) are correctly scoped as post-phase
follow-ups tied to real-world time windows that cannot be forced same-day — they are recorded, not
silently dropped, and do not block DEPLOY-04 closure.

---

_Verified: 2026-07-03T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
