---
phase: 15-re-auth-smoothing
plan: 02
subsystem: auth
tags: [schwab, oauth, seed_token, railway, runbook, operator-docs]

requires:
  - phase: 11-sidecar-scaffold-auth-migration
    provides: seed_token.py two-step (authurl/exchange) and one-shot (login) re-auth CLI, broker_tokens dual-write
provides:
  - Committed hardening diff to seed_token.py (headless-safe step_login + configurable callback timeout)
  - Corrected post-exchange restart instruction (railway redeploy --service sidecar -y, not railway up)
  - docs/operations/schwab-reauth-runbook.md — full operator runbook, discoverable via TOPIC-MAP
  - Reconciled stale "no restart needed" claim in docs/architecture/deployment.md
  - Live-verified AUTH-06 recovery against production (2026-07-02)
affects: [phase-15 remaining plans, future ops docs, future AI sessions running re-auth]

tech-stack:
  added: []
  patterns:
    - "Operator runbooks live under docs/operations/, linked from TOPIC-MAP, sourced from the CLI's own docstring"
    - "Placeholder-only OAuth redirect URLs in docs (never a captured code= value)"

key-files:
  created:
    - docs/operations/schwab-reauth-runbook.md
  modified:
    - apps/sidecar/seed_token.py
    - docs/TOPIC-MAP.md
    - docs/architecture/deployment.md

key-decisions:
  - "railway redeploy --service sidecar -y (restart-only, no rebuild) satisfies AUTH-06's 'no redeploy' roadmap wording, reinterpreted as 'no code ship' per the phase's provisional decision — no sidecar reload endpoint or file-watcher added (D-02 minimal attack surface)"
  - "Runbook now recommends seed_token.py login (browser auto-capture) over two-step exchange when a browser is available, based on live operator experience: two-step exchange loses the ~30s Schwab code-expiry race when both apps are authorized before either is exchanged"

patterns-established:
  - "Docs correction workflow: when a runbook/architecture doc's claim is falsified by hands-on operator use, patch the doc immediately rather than letting drift accumulate"

requirements-completed: [AUTH-06]

coverage:
  - id: D1
    description: "seed_token.py hardening diff (interactive=False, callback_timeout) committed; restart instructions corrected to railway redeploy --service sidecar -y in both docstring and _verify_and_finish"
    requirement: "AUTH-06"
    verification:
      - kind: unit
        ref: "python -c \"import ast; ast.parse(open('apps/sidecar/seed_token.py').read())\" — syntax ok"
        status: pass
      - kind: other
        ref: "rg -c 'railway redeploy --service sidecar' apps/sidecar/seed_token.py -> 2; rg 'railway up --service sidecar' apps/sidecar/seed_token.py -> no matches"
        status: pass
    human_judgment: false
  - id: D2
    description: "docs/operations/schwab-reauth-runbook.md written (two-step + login flows, mandatory restart, post-restart health/status checks, placeholder URLs only); registered in TOPIC-MAP Operations section; deployment.md's stale no-restart-needed claim reconciled"
    requirement: "AUTH-06"
    verification:
      - kind: other
        ref: "test -f docs/operations/schwab-reauth-runbook.md; rg -c 'railway redeploy --service sidecar -y' docs/operations/schwab-reauth-runbook.md -> 3; rg -c 'schwab-reauth-runbook' docs/TOPIC-MAP.md -> 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live production re-auth + sidecar restart cycle restores Schwab auth for both apps (trader + market) with no code rebuild and no second streamer session"
    requirement: "AUTH-06"
    verification:
      - kind: manual_procedural
        ref: "Operator ran seed_token.py login via railway run --service worker (2026-07-02); railway redeploy --service sidecar -y; verified GET /api/status fresh for both apps"
        status: pass
    human_judgment: true
    rationale: "Browser OAuth exchange and live Railway process restart cannot run in CI — RESEARCH Test Map marks both AUTH-06 smoke items manual-only; this is the one required human pass."

duration: ~25min
completed: 2026-07-02
status: complete
---

# Phase 15 Plan 02: Schwab Re-Auth Hardening + Operator Runbook Summary

**Hardened seed_token.py's restart instruction to `railway redeploy` (no rebuild), shipped docs/operations/schwab-reauth-runbook.md as the discoverable operator playbook, and live-verified full AUTH-06 recovery against production.**

## Performance

- **Duration:** ~25 min (Tasks 1-2: ~8 min executor time; Task 3 checkpoint: operator-run against prod, evidence returned 2026-07-02)
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 4 (apps/sidecar/seed_token.py, docs/operations/schwab-reauth-runbook.md, docs/TOPIC-MAP.md, docs/architecture/deployment.md)

## Accomplishments

- Committed the previously-uncommitted `step_login` hardening diff (`interactive=False`, configurable `SEED_CALLBACK_TIMEOUT`) that had been iterated live during the 2026-06-26→07-01 outage — closing the drift instead of leaving it as an untracked working-tree change.
- Corrected both places seed_token.py prints the post-exchange restart instruction to `railway redeploy --service sidecar -y` (restart-only, no rebuild), replacing a stale `railway up` rebuild command.
- Wrote `docs/operations/schwab-reauth-runbook.md` — a new `docs/operations/` topic directory — covering when to run re-auth, the two-step and one-shot flows, the mandatory restart, and post-restart verification. Registered it in TOPIC-MAP under a new Operations section.
- Reconciled the stale `docs/architecture/deployment.md` claim that re-auth needs "no deploy, no SSH" — it now states the sidecar requires a `railway redeploy` restart to pick up a freshly written token.
- **Live-verified against production (2026-07-02):** operator ran the re-auth dance end-to-end via `seed_token.py login` (browser auto-capture) through `railway run --service worker`, then `railway redeploy --service sidecar -y`. Both apps confirmed fresh on `GET /api/status` post-restart, with no second streamer session (GW-04 advisory lock held).
- Added a short operator-experience note to the runbook recommending `login` mode over two-step `exchange` when a browser is available, based on a real race condition hit during the checkpoint run (see Deviations).

## Task Commits

Each task was committed atomically:

1. **Task 1: Commit pending seed_token.py hardening diff, correct restart instruction** — `a00a89a` (fix: harden step_login for headless re-auth), `351fc2a` (fix: correct post-exchange restart instruction to railway redeploy)
2. **Task 2: Write operator runbook + TOPIC-MAP + reconcile deployment.md** — `437a063` (docs: add Schwab re-auth runbook, register in TOPIC-MAP, reconcile deployment.md)
3. **Task 3: Checkpoint — operator runs the re-auth dance once against prod** — no code commit (human-verify checkpoint); follow-up note commit `f0f73fb` (docs: note login-mode preference for the 30s code-expiry race)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/sidecar/seed_token.py` — headless-safe `step_login`, restart instruction corrected in module docstring + `_verify_and_finish`
- `docs/operations/schwab-reauth-runbook.md` — new operator runbook (when to run, two-step + login flows, mandatory restart, verification, login-mode preference note)
- `docs/TOPIC-MAP.md` — new "Operations (docs/operations/)" section linking the runbook
- `docs/architecture/deployment.md` — one-line reconciliation of the stale "no restart needed" claim

## Decisions Made

- `railway redeploy --service sidecar -y` (restart-only, no rebuild) satisfies AUTH-06's roadmap wording "without a Railway redeploy" once reinterpreted as "no code ship" — the running sidecar reads its token from Postgres exactly once at construction (schwab-py `auth.py:540`) and never re-reads on refresh cycles, so a restart is unavoidable; no sidecar reload endpoint or file-watcher was added (D-02, minimal attack surface on the auth-critical path).
- Runbook now states a preference for `seed_token.py login` (browser auto-capture) over two-step `exchange` whenever a browser is available — added post-checkpoint based on real operator experience (see Deviations below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Post-checkpoint operator lesson] Runbook gap: two-step exchange loses the Schwab code-expiry race**

- **Found during:** Task 3 checkpoint (live prod run, 2026-07-02)
- **Issue:** The runbook presented two-step `authurl`/`exchange` as the primary flow with `login` as a browser-terminal alternative, but didn't warn that Schwab's authorization code expires ~30 seconds after issuance. Running the two-step flow for both apps in one pass (log into both, then exchange both) loses that race for whichever app was authorized first — confirmed live: trader (authorized first) failed twice on `exchange` before the operator switched to `login`; market (authorized second, closer to code use) succeeded both times.
- **Fix:** Added a short note to Step 2 of the runbook stating the 30s expiry risk and recommending `login` mode whenever a browser is available, reserving two-step `exchange` for headless-agent-shell use only. Scoped to a small addition per resume instructions — no restructuring of the runbook.
- **Files modified:** `docs/operations/schwab-reauth-runbook.md`
- **Commit:** `f0f73fb`

**2. [Context, not a deviation] Post-Task-1 review fix WR-01 touched seed_token.py**

- Between this plan's Task 1 commits and the Task 3 checkpoint, a separate code-review pass landed `d8cacd4` (fix(15): WR-01 fail loud when seed_token exchange fails) on `apps/sidecar/seed_token.py`. This commit is **not** part of this plan's task list and was not redone here — it's noted because the checkpoint evidence confirms WR-01 behaved correctly in prod: on the two failed `exchange` attempts, the script exited non-zero, named the failed app, and suppressed the (now-irrelevant) restart instruction rather than printing a false-success message.

---

**Total deviations:** 1 auto-fixed (post-checkpoint runbook note); 1 noted for context (out-of-plan review fix, verified working, not re-done)
**Impact on plan:** No scope creep — the runbook note is the only in-scope change, kept to the size the resume instructions specified.

## Issues Encountered

- **Schwab code-expiry race during the live checkpoint run.** Two-step `exchange` failed twice for the trader app (oldest authorized code, ~30s expiry) before the operator switched to `login` mode, which succeeded for both apps immediately. No functional regression — this is inherent Schwab OAuth behavior, not a bug in seed_token.py. Documented per Deviations above. WR-01 (a prior, out-of-plan review fix) ensured the failed attempts errored loudly rather than silently.

## User Setup Required

None beyond the checkpoint itself, which is now complete. The re-auth flow is operator-run by design (AUTH-06 is explicitly a manual, non-CI-automatable flow).

## Checkpoint Verification Evidence (Task 3)

Verified 2026-07-02 by the operator against production:

- Ran `seed_token.py login` (browser auto-capture) via `railway run --service worker`, after two two-step `exchange` attempts hit Schwab's ~30s code-expiry race on the trader app (trader authorized first = oldest code; market succeeded both times).
- Post-review fix WR-01 (`d8cacd4`) behaved correctly during the failed attempts: exited non-zero, named the failed app, suppressed the restart instruction.
- Both apps seeded: trader `refresh_issued_at` `2026-07-02T20:58:58Z`, market `2026-07-02T20:59:10Z`; CLI verification printed "trader: seeded / market: seeded".
- `railway redeploy --service sidecar -y` executed; deployment status SUCCESS at `2026-07-02T20:59:43Z`.
- Production `GET /api/status`: trader status "fresh", market status "fresh", `lastRefreshError` null for both, `refreshIssuedAt` matches the seed timestamps. (`refreshExpiresIn` absent because prod still runs the pre-phase-15 image — expected; field ships on next deploy. `/sidecar/health` is not publicly proxied — sidecar health confirmed via deployment SUCCESS + fresh token status.)
- No second streamer session: sidecar restart-only (redeploy, no rebuild), GW-04 advisory lock held.

## Next Phase Readiness

- AUTH-06 is fully satisfied: the operator re-auth flow is committed, documented, discoverable, and live-verified end-to-end against production.
- Remaining Phase 15 plans (15-03 D-04 half already landed per STATE.md; 15-04, 15-05 already complete per git log) are unaffected by this plan's scope.
- No blockers carried forward from this plan.

---
*Phase: 15-re-auth-smoothing*
*Completed: 2026-07-02*
