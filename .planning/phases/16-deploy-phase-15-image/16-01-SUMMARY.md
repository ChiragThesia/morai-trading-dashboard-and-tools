---
phase: 16-deploy-phase-15-image
plan: 01
subsystem: infra
tags: [railway, vercel, deploy-verification, gw-05, sidecar, pre-deploy-baseline]

# Dependency graph
requires:
  - phase: 15-re-auth-smoothing
    provides: merged phase-15 code (refreshExpiresIn contract, refresh-expiry-warner, AuthExpiredBanner) awaiting prod deploy
provides:
  - GW-05 restored — sidecar service has zero public domains
  - Pre-deploy ground-truth baseline (per-service deployed status/createdAt, SKIPPED push entries, two known job errors, web deploy timestamp)
  - Deploy-readiness record (HEAD sha = deploy target, migration parity confirmed, suite green)
affects: [16-02 deploy+proof, 16-03 smoke+alert-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sidecar domain state verified via Railway GraphQL / dashboard ONLY — never `railway domain` (creates-on-first-use)"
    - "railway up deploy identity proven by createdAt timestamp, not commitHash (CLI deploys carry commitHash=null)"

key-files:
  created:
    - .planning/phases/16-deploy-phase-15-image/16-01-SUMMARY.md
  modified: []

key-decisions:
  - "Sidecar domain removal + verification done via Railway GraphQL serviceDomainDelete + read-only domains query, after CLI re-verify re-broke the operator's dashboard removal"
  - "`bun run test` treated green at exit 0 (150 files passed, 21 testcontainer-backed files skipped for lack of local Docker — environmental, not a phase-16 regression)"

patterns-established:
  - "NEVER run `railway domain --service sidecar` — the plan's own verify step is wrong; it creates a domain when the service is domainless"
  - "Deploy/ops read-only capture tasks produce no source artifacts; the SUMMARY IS the artifact — a single docs commit, no empty per-task commits"

requirements-completed: []  # DEPLOY-04 spans the whole phase; closed by Plan 03, not this plan

coverage:
  - id: D1
    description: "GW-05 restored — sidecar has zero public domains (accidental sidecar-production-1b98 removed by operator; sidecar-production-268b re-created by a CLI re-verify then deleted via GraphQL)"
    requirement: "DEPLOY-04"
    verification:
      - kind: manual_procedural
        ref: "Railway GraphQL read-only domains query → serviceDomains = []; operator dashboard confirmation"
        status: pass
    human_judgment: true
    rationale: "Sidecar domain absence is an external Railway-state fact; authoritative signal is the dashboard/GraphQL, confirmed by operator, not automatable from this repo"
  - id: D2
    description: "Pre-deploy baseline recorded: per-service deployed status/createdAt, 220719f SKIPPED entries, two known job errors, web deploy timestamp"
    requirement: "DEPLOY-04"
    verification:
      - kind: manual_procedural
        ref: "railway deployment list --service {server,worker} --json --limit 5; curl /api/status; vercel inspect"
        status: pass
    human_judgment: false
  - id: D3
    description: "Deploy readiness confirmed: migration parity (0013 highest), tree docs-only ahead of origin/main, HEAD sha recorded, suite green"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "bun run test → exit 0, 150 passed / 21 skipped / 0 failed"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-07-03
status: complete
---

# Phase 16 Plan 01: Security Gate + Pre-Deploy Baseline Summary

**Restored GW-05 (sidecar zero public domains, via GraphQL after a CLI re-verify re-exposed it) and captured exact pre-deploy ground truth — server/worker stale at a commitHash-null `railway up` from 21:27Z, web current at 22:12Z (220719f), two pre-existing job errors baselined, migration parity at 0013, tree docs-only ahead, suite green.**

## Performance

- **Duration:** ~14 min (across two checkpoint pauses)
- **Started:** 2026-07-03T18:58:55Z
- **Completed:** 2026-07-03T19:12:53Z
- **Tasks:** 3 (1 checkpoint + 2 auto)
- **Files modified:** 1 (this SUMMARY; deploy/ops-only phase, zero source)

## Accomplishments

- **GW-05 restored** — sidecar service confirmed at zero public domains (read-only GraphQL `domains` query returned `serviceDomains = []`; operator dashboard confirmed).
- **Pre-deploy baseline captured** for all three services (read-only; nothing deployed).
- **Deploy readiness confirmed** — migration parity (0013 latest, worker migrate is a no-op), tree docs-only ahead of origin/main, `bun run test` green.

## Pre-Deploy Baseline (ground truth for Plans 02/03)

### Server (`server-production-f5ca2.up.railway.app`)
| status | createdAt | commitHash |
|--------|-----------|------------|
| SKIPPED | 2026-07-02T22:12:00.812Z | 220719f (push — the skip gotcha, Pitfall 2) |
| **SUCCESS** (current live) | **2026-07-02T21:27:46.831Z** | **null** (`railway up` CLI deploy) |
| REMOVED | 2026-07-02T21:27:39.833Z | c87d977 |
| SKIPPED | 2026-07-02T03:48:29.219Z | d0a0b99 |
| SKIPPED | 2026-07-02T03:43:31.330Z | 5c353a1 |

### Worker (`worker-production-4cdf.up.railway.app`)
| status | createdAt | commitHash |
|--------|-----------|------------|
| SKIPPED | 2026-07-02T22:12:01.114Z | 220719f (push — skip gotcha) |
| **SUCCESS** (current live) | **2026-07-02T21:27:52.927Z** | **null** (`railway up` CLI deploy) |
| REMOVED | 2026-07-02T21:27:40.100Z | c87d977 |
| SKIPPED | 2026-07-02T03:48:29.573Z | d0a0b99 |
| SKIPPED | 2026-07-02T03:43:31.761Z | 5c353a1 |

**Deploy gap:** server + worker are STALE — their live SUCCESS deploys (commitHash null, ~21:27Z) predate the phase-15 code-review fixups; the subsequent 220719f push was SKIPPED on both. Plan 02 must force with `railway up --service server` / `--service worker`.

### Web (Vercel `morai-web`)
- Newest production deployment: `morai-gu95vkfcc-projects-9dcb446e.vercel.app`, target=production, **created 2026-07-02T22:12:01Z** (17:12:01 CDT) — correlates to the 220719f push time.
- **Web is very likely already current.** CLI JSON exposes no git-sha field — definitive web-commit confirmation is deferred to Plan 02 (Vercel dashboard "Source" panel, per RESEARCH Open Q1).

### Prod error baseline (`/api/status`, RESEARCH Pitfall 5 — do NOT count as deploy regressions)
- `db`: **"ok"**
- `tokenFreshness`: **trader = fresh**, **market = fresh** (both `refreshExpiresIn: null` — the current stale server build predates the phase-15 warner copy fix)
- **`fetch-schwab-chain`** — `lastError: "AUTH_EXPIRED"` at 2026-07-03T19:02:02.647Z (last success 13:01:01Z). PRE-EXISTING baseline.
- **`sync-fills`** — `lastError: "sync-fills: invalid payload: [ { \"expected\": \"object\", \"code\": \"invalid_type\", \"path\": [], \"message\": \"Invalid input: expected object, received null\" } ]"` at 2026-07-03T19:02:02.103Z (last success 13:21:01Z). PRE-EXISTING baseline.
- Also noted (not in the plan's named pair, but present): `compute-bsm-greeks` last error "handler execution exceeded 900s" (2026-07-01, stale); `fetch-rates` last error an insert conflict (2026-06-30, stale). Both predate this deploy — informational only.

### Deploy-readiness record
- **Migration parity:** highest migration file is `0013_macro_observations.sql` — no new phase-15 migration; worker boot `runMigrations` will be an idempotent no-op (last applied 0013). Did NOT run `bun run migrate` (validates SIDECAR_URL — file-level parity check sufficient).
- **Tree state:** `main` is ahead of `origin/main` by 11 commits, all docs/planning (verify command printed `TREE_DOCS_ONLY`; no `packages/` or `apps/*/src/` changes). Deploying the local tree via `railway up` is safe.
- **HEAD sha (Plan 02 deploy target):** `7a710b9` (`7a710b9ba85c310c13674c969b16c1e609f0ebb5`). origin/main = `220719f`.
- **`bun run test`:** GREEN — exit 0, **150 files passed / 21 skipped / 0 failed** (1369 tests passed, 168 skipped). The 21 skipped files are testcontainer-backed adapter tests skipped because local Docker isn't running — environmental, not a phase-16 regression.

## Task Commits

Tasks 2 and 3 are read-only captures — they produce no source artifacts, so there are no per-task file commits (deploy/ops-only phase, `files_modified: []`). The captured facts are recorded here; the SUMMARY is the single artifact.

1. **Task 1: Remove accidental sidecar public domain (GW-05)** — checkpoint, resolved by operator (dashboard) + orchestrator (GraphQL `serviceDomainDelete`). No repo commit.
2. **Task 2: Capture pre-deploy ground truth** — read-only; recorded in this SUMMARY. No repo commit.
3. **Task 3: Confirm deploy readiness** — read-only; recorded in this SUMMARY. No repo commit.

**Plan metadata:** committed with this SUMMARY + STATE.md + ROADMAP.md.

## Files Created/Modified
- `.planning/phases/16-deploy-phase-15-image/16-01-SUMMARY.md` — this file (baseline + readiness record).

## Decisions Made
- Sidecar domain removal verified via Railway **GraphQL** (read-only `domains` query + `serviceDomainDelete` mutation), not the CLI — because the CLI `domain` subcommand creates-on-first-use.
- Treated the suite as green at exit 0; the Docker/testcontainers skip is an environmental limitation of the local machine, not a red test or a phase-16 regression.

## Deviations from Plan

### Auto-fixed / protocol corrections

**1. [Rule 1 - Bug in the plan's own verify step] The plan's `railway domain --service sidecar` "READ-only" verification is WRONG**
- **Found during:** Task 1 re-verification (after the operator's dashboard removal).
- **Issue:** The plan (and the orchestrator's briefing) asserted `railway domain --service sidecar` is READ-only and safe. It is NOT. When the sidecar is domainless, that command hits Railway's **create-on-first-use** path (RESEARCH Pitfall 4) and generated a NEW public domain `sidecar-production-268b.up.railway.app` — re-breaking the operator's dashboard removal and re-violating GW-05. The `--service` flag only scopes WHICH service gets the domain; it does not make the command read-only.
- **Fix:** STOPPED immediately (blocking gate), reported the re-exposure, and did NOT re-run `railway domain`. The orchestrator deleted the re-created domain via Railway GraphQL `serviceDomainDelete(id: c09a7141-a2dd-46a5-9b75-ee261f80c97c)` → returned `true`, and a read-only GraphQL `domains` re-query confirmed `serviceDomains = []`.
- **Corrected protocol (Plans 02/03 MUST NOT repeat this):** NEVER run `railway domain` against the sidecar for ANY reason — not even to "verify zero domains". Sidecar domain state is verified via the Railway **dashboard** or a read-only **GraphQL `domains` query** only. Every other railway command still requires explicit `--service` (ambient link is sidecar).
- **Files modified:** none (external Railway state).
- **Verification:** GraphQL read-only re-query → `serviceDomains = []`; operator dashboard confirmation. Server/worker domains untouched (`server-production-f5ca2`, `worker-production-4cdf`).

---

**Total deviations:** 1 protocol correction (the plan's own sidecar verify step is unsafe).
**Impact on plan:** No scope creep. The correction hardens the GW-05 gate and hands Plans 02/03 a safe verification protocol; the actual objective (sidecar zero-domain + baseline) was met.

## Issues Encountered
- The read-only assumption about `railway domain --service sidecar` was false and momentarily re-exposed the sidecar (see Deviation 1). Resolved via GraphQL before any deploy work; no persistent exposure.

## User Setup Required
None — no external service configuration introduced by this plan.

## Next Phase Readiness
- **Plan 02 (deploy + proof) is unblocked.** Deploy target sha = `7a710b9`. Force-deploy server + worker with `railway up --service server` / `--service worker` (both are stale; git push SKIPs). Web is verify-only pending the Vercel dashboard "Source" panel.
- **Baseline for Plan 03 smoke:** the two pre-existing errors (`fetch-schwab-chain` AUTH_EXPIRED, `sync-fills` null-payload) must be EXCLUDED from regression judgment.
- **Carried protocol warning:** do NOT run `railway domain` against the sidecar; verify its domain state via dashboard/GraphQL only.

---
*Phase: 16-deploy-phase-15-image*
*Completed: 2026-07-03*
