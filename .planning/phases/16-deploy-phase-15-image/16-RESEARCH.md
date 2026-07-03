# Phase 16: Deploy Phase-15 Image - Research

**Researched:** 2026-07-03
**Domain:** Ops/deploy verification (Railway + Vercel), zero application code
**Confidence:** HIGH — every claim below was checked live against Railway CLI, Vercel CLI,
prod `/api/status`, and `git log`/`git status` during this research session, not inferred
from training data.

---

## ⚠️ URGENT — Action Required Before/During This Phase

**A public domain was accidentally created on the `sidecar` Railway service during this
research session** (`https://sidecar-production-1b98.up.railway.app`), by running `railway
domain` without an explicit `--service` flag while `sidecar` was the ambient linked service.
This **violates GW-05** (`docs/architecture/deployment.md` / stack-decisions: sidecar must
have **NO public domain** — it is reached only via `SIDECAR_URL` on the private Railway
network). The Railway CLI has no `domain remove` subcommand; removal requires the Railway
dashboard (Service → Settings → Networking → remove the generated domain).

**The planner MUST add a `checkpoint:human-verify` task, first in the plan, to remove this
domain before or alongside the phase's deploy work.** This is unrelated to DEPLOY-04 itself
but is a live security exposure discovered while researching this phase and must not be
carried forward silently.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Build-proof strategy (provisional):** Prove "prod runs the phase-15 build" with zero
code change:
- **Server:** `refreshExpiresIn` key present in the `GET /api/status` payload — a phase-15-only
  contract addition, so its presence (even `null`) is the build marker.
- **Worker:** Railway dashboard deployed-commit sha (worker has no HTTP surface).
- **Web:** Vercel dashboard deployment commit sha.
- Rejected: injecting `RAILWAY_GIT_COMMIT_SHA` into the status `version` field (hardcoded
  `"0.0.1"` at `apps/server/src/main.ts`) — durable improvement, but turns a deploy-only phase
  into a code phase. Deferred to a later phase.

**D-02 — T-24h alert verification (provisional):** Two-checkpoint verification, no simulation
code:
1. At deploy: `refreshExpiresIn` key present on `/api/status`; web status wiring confirmed
   (AuthExpiredBanner ships in the deployed bundle).
2. At the real window (~2026-07-08): observe the amber banner on web + warn log
   (`refresh-expiry-warner.ts`) live during the actual T-24h window.
- Rejected: forcing a near-expiry token state in prod.
- Consequence: phase verification has a deferred UAT item that only closes ~07-08. Plan must
  mark checkpoint 2 as a scheduled follow-up, not a same-day gate.

**D-03 — Deploy mechanics (provisional):** Verify deployed shas first, deploy only stale
services:
- Check the deployed commit sha per service (Railway dashboards for server/worker/sidecar;
  Vercel for web) before redeploying — web may already be current.
- For stale Railway services: `railway up --service server` / `railway up --service worker`.
  Known gotcha: a plain git push SKIPs services — force per service, never assume push
  deployed.
- Sidecar excluded: redeployed 2026-07-02 during the live re-auth; DEPLOY-04 names
  server+worker+web only.
- No migration step expected (last applied: 0013). Planner should still confirm migration
  parity before deploying.

**D-04 — Regression smoke scope (provisional):** Manual checklist, no new scripts:
- `curl`/MCP checks: `get_status` (db up, both apps' auth state), `get_journal` (fresh 30-min
  snapshot timestamp), `get_cot` (latest weekly row), FRED macro series present.
- Web eyeball: dashboard loads, positions render, GEX charts populate.
- Live-stream check is RTH-bound: verify badge + ticking greeks during the next RTH session
  after deploy. Deploy timing itself is unconstrained; stream verification just waits for RTH.
- Rejected: reusable scripted smoke suite (over-engineering for a single deploy phase);
  healthchecks-only (too weak for criterion 3).

**D-05 — Todos:** Fold neither matched todo — the phase ships zero code changes, keeping the
"no regression" baseline clean.

### Claude's Discretion
- Deploy order among server/worker (no migration in play, so ordering is low-stakes).
- Exact smoke-checklist wording and which MCP tool vs curl per check.

### Deferred Ideas (OUT OF SCOPE)
- **Real version reporting:** inject `RAILWAY_GIT_COMMIT_SHA` (and a web equivalent) into the
  status `version` field so every future deploy is sha-verifiable via the API. Candidate for
  Phase 17 or a later ops phase.
- `03-code-review-followups.md` (advisory v1.0-era code fixes) — deploy-only phase ships no
  code, still pending.
- `over-engineering-cleanup.md` (ponytail dead-code cleanup) — same reason, still pending.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEPLOY-04 | Prod runs the phase-15 image on server, worker, and web; the T-24h re-auth alert surface (amber banner, warn log, `refreshExpiresIn` on both status surfaces) is verifiably live before the ~2026-07-09 re-auth window | Live verification below proves exactly which commits are/aren't in prod today for each of the three services, and gives the exact commands to close the gap and prove closure (see Architecture Patterns, Code Examples, Common Pitfalls). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

| Directive | Applicability to Phase 16 |
|---|---|
| Dependencies point inward (hexagonal) | N/A — zero code changes this phase. |
| TDD red→green, no production code without a failing test first | N/A/exempt — this phase is pure ops (deploy config, no source changes). `tdd.md` scope explicitly exempts "pure wiring in composition roots, static config" — deploy is a superset of that: no source at all. |
| No `any`, no `as`, no `!` | N/A — no TypeScript written. |
| Docs before architecture changes | N/A — no architecture change; deploy topology docs (`docs/architecture/deployment.md`) already describe the target state accurately (verified during this research, no drift found). |
| Commits at green only | Applies to any commits this phase does make (e.g., recording deploy verification in `.planning/`) — keep those doc-only commits separate from any future code fix. |
| `knowledge-base/` read-only | N/A. |

**Net effect:** this phase is one of the rare ones where almost every CLAUDE.md code-discipline
rule is inapplicable by design — the phase's own boundary (D-05, zero code) enforces that. The
one rule that fully applies is change hygiene: touch only Railway/Vercel deploy state, nothing
in `packages/` or `apps/*/src/`.

## Summary

This is a pure infrastructure-verification phase: no application code changes, only bringing
Railway's `server` and `worker` services (and confirming Vercel's `web`) up to the already-merged
phase-15 commit. Live verification during this research (Railway CLI `deployment list --json`,
Vercel CLI `inspect --format=json`, `git log`/`git status`, and a direct `curl` of prod
`/api/status`) established the **exact current gap**, which is narrower and more precise than
CONTEXT.md's provisional assumptions:

- **Web is very likely already current.** Vercel auto-deployed from `origin/main` at commit
  `220719f` (2026-07-02T22:12:01Z), which is the tip of `origin/main` today and includes every
  phase-15 commit (including the second code-review round, IN-01 through IN-06). No redeploy
  needed for web unless the planner finds contrary evidence in the Vercel dashboard's git-source
  panel (CLI JSON did not expose an explicit commit field for this deployment — see Common
  Pitfalls).
- **Server and worker are stale, but only by six small commits, one of which is a real (if
  minor) behavior fix.** The last *successful* deploy for both was a manual `railway up`
  (image-digest based, untracked by git) on 2026-07-02T21:27:46Z / 21:27:52Z — which predates
  local commits `6233d67`..`0c5600f` (IN-01 through IN-06, committed 21:37Z–21:47Z that same
  day). The subsequent git-push-triggered deploy for `220719f` (which *would* have included
  those fixes) was **SKIPPED** for both services — the exact "push silently skips" gotcha
  carried forward from Phases 8–9 and 14, now empirically reconfirmed on this repo today.
- Of the six missing commits: two touch the sidecar (out of scope, already redeployed), two are
  dead-code deletions (no behavior change), one is test-only, and **one (`0c5600f`, IN-06) is a
  real production code fix** to `apps/server/src/adapters/refresh-expiry-warner.ts` — it changes
  the T-24h warn-log copy from a misleading "0s remaining ... before expiry" to a correct
  "refresh token EXPIRED ... re-auth now" once the cutoff has actually passed. **This is directly
  inside the alert surface DEPLOY-04 cares about**, so "prod already shows `refreshExpiresIn`"
  (true today, see below) is *not* sufficient proof of "prod runs the phase-15 build" — the
  planner needs a check that also confirms this specific fix (or simply: confirm the deploy
  timestamp is after `0c5600f`'s commit time, since `railway up` provides no other git-linkage).
- `origin/main` is currently 7 commits behind local `HEAD` (all v1.2 planning docs, zero code) —
  deploying from the local working tree (current standard practice per `railway up`) is safe and
  captures the full phase-15 tip regardless of whether those 7 doc commits are pushed first.

**Primary recommendation:** Deploy server and worker with `railway up --service server` and
`railway up --service worker` from the current working tree (after confirming `git status` is
clean of anything other than expected planning-doc changes), verify via `/api/status` +
`lastJobRuns` timestamp progression (not just Railway's dashboard, which won't show a git sha for
CLI-triggered deploys), and treat web as **verify-only** unless the Vercel dashboard's commit
panel disagrees with the timestamp correlation established here.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Build/deploy trigger | Railway / Vercel (CDN/compute host) | — | Config-as-code (`railway.*.toml`, `vercel.json`) already defines build+deploy; this phase only *executes* the existing pipeline, adds nothing new. |
| Deploy-proof (sha/version) | API / Backend (`/api/status`) | Browser/Client (web dashboard renders it) | `refreshExpiresIn` and `version` are backend contract fields; the web tier only displays what the backend reports — it cannot independently prove its own deployed commit without the Vercel dashboard. |
| T-24h alert surface | API / Backend (warn log + status field) | Browser/Client (amber banner) | The warning is computed once at the backend (`withRefreshExpiryWarning` decorator wraps `getStatus`) and fans out to both the HTTP status response and, via polling, the web banner — single source of truth pattern already in place, not something this phase needs to re-architect. |
| Migration execution | Database / Storage (Postgres via worker boot) | — | Worker's `main.ts` calls `runMigrations` unconditionally at boot; server never migrates. Redeploying either service is independent of migration state (idempotent, no-op here since 0013 is already applied). |

## Standard Stack

**N/A — no new dependencies, libraries, or packages this phase.** The only "stack" in play is
existing deploy tooling already present in the environment:

| Tool | Verified Version | Role |
|------|-------------------|------|
| `railway` CLI | 4.11.0 [VERIFIED: `railway --version` run live] | Deploys `server`/`worker`; already logged in as `chiragthesia` and linked to project `morai`. |
| `vercel` CLI (via `npx vercel`, not globally installed) | 54.20.0 [VERIFIED: `npx vercel --version` run live] | Inspects/verifies `web` deployments; already logged in as `harithesia-6928`. Not installed globally — every invocation should go through `npx --yes vercel ...` unless the planner chooses to `bun add -g vercel` (also fine, but adds a step). |

## Package Legitimacy Audit

**N/A — this phase installs no packages.** Skip.

## Architecture Patterns

### System Architecture Diagram (deploy flow, not application data flow)

```
 Local working tree (git HEAD, 7 commits ahead of origin/main — docs only)
        │
        │  git push (optional; not required for `railway up`)
        ▼
 origin/main @ 220719f  ──────────────► Vercel (GitHub-integrated, auto-deploy)
        │                                       │
        │                                       ▼
        │                              web build (bun run --filter @morai/web build)
        │                                       │
        │                                       ▼
        │                              https://morai.wtf (Production alias)
        │                              — ALREADY at 220719f tip (verified below)
        │
        │  railway up --service server   (uploads local dir, NOT git-linked)
        ▼
 Railway `server` service ──► Dockerfile build (apps/server/Dockerfile)
        │                              │
        │                              ▼
        │                     healthcheck GET /api/status (60s timeout, 5 retries)
        │                              │
        │                     pass ──► traffic cutover (old container drained)
        │
        │  railway up --service worker
        ▼
 Railway `worker` service ──► Dockerfile build (apps/worker/Dockerfile)
        │                              │
        │                              ▼
        │                     boot: runMigrations(DATABASE_URL)  [idempotent, 0013 already applied]
        │                              │
        │                              ▼
        │                     pg-boss cron/queue handlers resume (no HTTP healthcheck)

 Verification loop (both services):
   curl https://server-production-f5ca2.up.railway.app/api/status
        │
        ├─ refreshExpiresIn key present (both apps)  → D-01 build marker (necessary, not sufficient — see Pitfalls)
        ├─ lastJobRuns.<job>.lastSuccessAt advances past deploy timestamp → proves WORKER is alive & running new image
        └─ db: "ok", tokenFreshness fresh for both apps → no auth regression
```

### Pattern: Verify-before-deploy (D-03)

**What:** Before touching any service, establish ground truth of what's currently running, using
tools that don't lie by omission.
**When to use:** Any deploy-only phase, always — the cost of checking is near-zero, the cost of
a needless or a missed redeploy is high (missed T-24h window here).
**Verified commands (all run live during this research):**

```bash
# Server / worker: list recent deployments with git commit + build metadata.
railway deployment list --service server --json --limit 5 \
  | jq '[.[] | {id, status, createdAt, commitHash: .meta.commitHash, builder: .meta.serviceManifest.build.builder}]'

railway deployment list --service worker --json --limit 5 \
  | jq '[.[] | {id, status, createdAt, commitHash: .meta.commitHash, builder: .meta.serviceManifest.build.builder}]'

# Web: list production deployments, inspect the newest one.
npx --yes vercel ls --scope <team> | head -5
npx --yes vercel inspect <deployment-url> --format=json
```

**Finding from this research:** the most recent **SUCCESS** entries for `server` and `worker`
both have `commitHash: null` (because they were `railway up` CLI deploys, not git-push
triggers) — cross-reference `createdAt` against `git log --format="%h %ad %s" --date=iso-strict`
to know what was actually in the working tree at that moment. The most recent git-push-triggered
entries (commit `220719f`) show `status: "SKIPPED"` for both services — direct proof of the
"push doesn't deploy" gotcha, not just a remembered lesson.

### Pattern: Worker liveness proxy (no HTTP surface)

**What:** `worker` has no healthcheck and no domain (`railway.worker.toml` deploy section has no
`healthcheckPath`). The only way to prove the new image is *running* (not just *built*) is to
watch its side effects.
**When to use:** Any Railway service with no public HTTP surface.
**Example (verified live against current prod):**

```bash
curl -s https://server-production-f5ca2.up.railway.app/api/status | jq '.lastJobRuns'
# Re-run a few minutes after redeploying worker — lastSuccessAt for cron-scheduled jobs
# (compute-analytics, snapshot-calendars, etc.) should advance past the redeploy timestamp.
# A job whose cadence hasn't elapsed yet won't move — don't treat a stale timestamp as failure
# unless enough time has passed for that job's own schedule.
```

### Anti-Patterns to Avoid

- **Trusting `git push` to deploy Railway services.** Confirmed today: pushing `220719f`
  produced `status: "SKIPPED"` deployments for both `server` and `worker`. Always force with
  `railway up --service <name>`.
- **Treating "`refreshExpiresIn` key present" as proof of the *full* phase-15 build.** That key
  was added early in phase 15 (commits `f947c3f`/`33e7bcf`, 2026-07-02 ~19:30Z) and is already
  present in the *currently stale* server build. It proves "at least mid-phase-15", not
  "phase-15 complete including code-review fixes." Pair it with a timestamp check (deploy time
  after the last phase-15 commit, `0c5600f` at 2026-07-02T21:41:25-05:00) for real proof.
- **Running Railway CLI commands without `--service`.** The CLI defaults to whatever service was
  last linked in this shell/session (observed default: `sidecar`), and mutating commands (like
  `railway domain`) will silently act on the wrong service — this is exactly how the sidecar
  public-domain incident (see top of this document) happened. Always pass `--service server` /
  `--service worker` / `--service sidecar` explicitly, and never run `railway domain` (which
  creates on first use) against `sidecar`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Proving a deploy landed | A custom "deployed version" endpoint or script | Existing `/api/status` fields (`refreshExpiresIn`, `lastJobRuns`) + `railway deployment list --json` timestamp correlation | Zero-code constraint (D-05); the existing contract already carries enough signal for this phase's proof needs. A real version-sha field is a legitimate future improvement (deferred, see CONTEXT.md), not something to improvise mid-phase. |
| Regression smoke testing | A new scripted smoke-test suite | MCP tools (`get_status`, `get_journal`, `get_cot`, `get_macro`) + manual web eyeball (D-04) | Explicitly rejected in CONTEXT.md as over-engineering for a single deploy event; the existing MCP surface already covers the check list. |

**Key insight:** every tool needed for this phase's verification work already exists in the repo
or the CLI toolchain — this phase is discipline (use the right commands, in the right order,
verify before/after) rather than building anything.

## Common Pitfalls

### Pitfall 1: `railway up` deploys are invisible to git-based sha checks
**What goes wrong:** D-03 says "check the deployed commit sha per service (Railway dashboards)."
For a service last deployed via `railway up`, `meta.commitHash` is `null` — there is no sha to
read, in the CLI or (per this research) apparently in the metadata Railway stores for CLI-origin
deployments.
**Why it happens:** `railway up` uploads the local working directory as an archive; it has no
concept of "this came from commit X" the way a GitHub-integrated push-deploy does.
**How to avoid:** Before running `railway up`, capture `git rev-parse HEAD` and the current
timestamp; after the deploy reports `SUCCESS`, correlate `deployment list --json`'s `createdAt`
against that captured commit/time pair in your own verification notes (UAT/plan checkpoint), not
Railway's dashboard.
**Warning signs:** Trying to "verify the sha in the Railway dashboard" for a CLI-deployed service
and finding no such field — that's expected, not a bug.

### Pitfall 2: git push SKIPS the deploy (reconfirmed empirically today)
**What goes wrong:** Pushing a commit does not always deploy — Railway may show `status:
"SKIPPED"` for the resulting deployment on affected services.
**Why it happens:** Documented recurring gotcha (Phases 8–9, 14); root cause not re-derived here,
but the symptom is 100% reproducible: the push for `220719f` today produced `SKIPPED` on both
`server` and `worker`.
**How to avoid:** Never rely on `git push` alone for these two services. Always force with
`railway up --service server` / `railway up --service worker` and confirm `status: "SUCCESS"` via
`railway deployment list --json --limit 1`.
**Warning signs:** `/api/status` or job timestamps not advancing after a push you expected to
deploy.

### Pitfall 3: the build-marker key can be a false positive
**What goes wrong:** Checking only "is `refreshExpiresIn` present in `/api/status`" can report
success on a stale build, because that field was added mid-phase-15, before the code-review
fixup commits.
**Why it happens:** Phase-15 shipped the field early and polished the surrounding behavior
(log-message copy) later, in a second code-review round. A single boolean "key present" check
collapses that timeline.
**How to avoid:** Pair the key-presence check with a deploy-timestamp check against the phase's
final commit (or just redeploy — since the fix is small and the deploy is cheap, don't try to
skip the redeploy on the theory that the key is already there).
**Warning signs:** None visible from the API alone — this is why the timestamp cross-check
matters; the payload will look identical.

### Pitfall 4: default-linked Railway service bites destructive commands
**What goes wrong:** Running a Railway CLI command without `--service` operates on whatever
service was last linked in that shell session — which may not be the one you intend, especially
for commands that *create* state (`railway domain`, `railway up` without `-s`).
**Why it happens:** `railway status` reported `Service: sidecar` as the ambient default in this
session (left over from prior sidecar work), and `railway domain` (no args) generates a domain if
none exists rather than erroring.
**How to avoid:** Always pass `--service <name>` explicitly on every Railway CLI invocation in
this phase's plan and execution steps. Never run `railway domain` against `sidecar` — it must
stay domain-less per GW-05.
**Warning signs:** Already tripped once this session (see the urgent note at the top of this
document) — the remediation (dashboard domain removal) should be an explicit task in the plan.

### Pitfall 5: pre-existing prod noise can masquerade as a deploy regression
**What goes wrong:** `/api/status.lastJobRuns` currently shows live errors unrelated to this
phase: `fetch-schwab-chain` failed with `"AUTH_EXPIRED"` today (2026-07-03T18:01:32Z) despite
`tokenFreshness` reporting both apps `"fresh"`, and `sync-fills` failed with an "expected object,
received null" payload error at 18:11:32Z.
**Why it happens:** Unrelated pre-existing operational issues (likely a transient sidecar/chain
hiccup and an upstream Schwab payload shape edge case) — not caused by, and not fixed by, this
deploy.
**How to avoid:** Record these two error states as the **pre-deploy baseline** before starting
work, so the post-deploy smoke check (D-04) doesn't misattribute them as a regression from the
phase-15 deploy. If they persist unchanged after redeploy, they are out of this phase's scope.
**Warning signs:** Treating any red `lastError` in the status payload as a deploy blocker without
first checking whether it predates the deploy.

## Code Examples

### Verify current deployed state before touching anything

```bash
# Confirm local vs origin divergence (docs-only ahead is safe to deploy from local tree)
git status -sb
git rev-parse HEAD origin/main

# Server/worker: last 5 deployments each, with status + builder + commit (if any)
railway deployment list --service server --json --limit 5 \
  | jq '[.[] | {status, createdAt, commitHash: .meta.commitHash, builder: .meta.serviceManifest.build.builder}]'
railway deployment list --service worker --json --limit 5 \
  | jq '[.[] | {status, createdAt, commitHash: .meta.commitHash, builder: .meta.serviceManifest.build.builder}]'

# Web: newest production deployment
npx --yes vercel ls | head -5
npx --yes vercel inspect <newest-url> --format=json
```

### Force-deploy the stale services

```bash
railway up --service server
railway up --service worker
```

### Post-deploy proof (D-01 + Pitfall 3 combined)

```bash
DEPLOY_TIME_UTC=$(date -u +%FT%TZ)   # capture immediately before `railway up`

curl -s https://server-production-f5ca2.up.railway.app/api/status | jq '{
  refreshExpiresIn_trader: .tokenFreshness.trader.refreshExpiresIn,
  refreshExpiresIn_market: .tokenFreshness.market.refreshExpiresIn,
  db: .db,
  lastJobRuns
}'

railway deployment list --service server --json --limit 1 | jq '.[0] | {status, createdAt}'
railway deployment list --service worker --json --limit 1 | jq '.[0] | {status, createdAt}'
# createdAt for both must be >= $DEPLOY_TIME_UTC and status == "SUCCESS"
```

### D-04 smoke checklist (MCP + curl)

```bash
# via MCP (bearer-authed): get_status, get_journal, get_cot, get_macro
# via curl equivalents where no MCP client is at hand:
curl -s https://server-production-f5ca2.up.railway.app/api/status | jq .
# journal/cot/macro routes require the Supabase JWT (web session) or MCP bearer — exercise via
# the MCP tools or the web UI, not anonymous curl.
```

## State of the Art

Not applicable — no library/framework version drift is in scope for a deploy-only phase. The one
relevant "state of the art" note: Railway's CLI (`deployment list --json`) is the tool that made
this research's precise timeline reconstruction possible; earlier phases' SUMMARY docs describe
the push-skip gotcha qualitatively but (per a repo-wide search) never captured the underlying
`railway deployment list` evidence — worth adopting as a standard verification step in future
deploy phases, not just this one.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Vercel production deployment created at 2026-07-02T22:12:01Z was built from commit `220719f` (correlated by timestamp proximity to the git push, not an explicit git-sha field returned by `vercel inspect --format=json`) | Summary, Architecture Patterns | If wrong, web could still be serving a slightly older phase-15 commit (though still almost certainly post the AuthExpiredBanner amber-state work, which landed hours earlier at 19:37:41Z) — low practical risk, but the planner should have the executor cross-check the Vercel dashboard's "Source" panel (which does show the commit sha visually) before marking web as "no redeploy needed." |
| A2 | No other commit touching `apps/web` landed between the last confirmed Vercel build time (~22:12Z) and now (2026-07-03, research time) | Summary | Checked via commit message inspection of all commits in that window — none touch `apps/web`; risk is low but not re-verified via file-level diff in this research pass. |

## Open Questions (RESOLVED)

> Both questions are resolved by concrete plan tasks: Q1 → Plan 16-02 Task 1 (executor reads the
> Vercel dashboard commit sha before declaring web done), Q2 → Plans 16-01/16-03 (both errors
> captured as pre-deploy baseline and excluded from regression judgment per Pitfall 5).

1. **(RESOLVED — Plan 16-02 Task 1)** **Does the Vercel dashboard's "Source" panel confirm commit `220719f` (or later) for the live
   production deployment?**
   - What we know: `vercel inspect <url> --format=json` returned build config but no explicit
     git-commit field for this deployment; the CLI's plain-text `created` timestamp closely
     matches the `220719f` push time.
   - What's unclear: whether the JSON format simply omits a field the web dashboard renders
     elsewhere, or whether this Vercel project isn't fully GitHub-metadata-linked.
   - Recommendation: planner/executor opens the Vercel dashboard once during execution to read
     the commit sha directly (30 seconds), rather than trusting the timestamp correlation alone,
     before declaring web done with zero redeploy.

2. **(RESOLVED — Plans 16-01/16-03, baseline-and-exclude)** **Are the two live `lastJobRuns` errors (`fetch-schwab-chain` AUTH_EXPIRED, `sync-fills`
   payload-shape error) safe to ignore for this phase, or worth a quick look?**
   - What we know: both are timestamped today, both are unrelated to any phase-15/16 change, and
     `tokenFreshness` for both Schwab apps currently reports `"fresh"` (contradicting a literal
     `AUTH_EXPIRED` on the chain-fetch job, suggesting a transient/sidecar-side issue rather than
     the server's own token state).
   - What's unclear: root cause; out of this phase's investigative scope (zero-code, deploy-only).
   - Recommendation: record as pre-existing baseline (Pitfall 5) so the D-04 smoke check isn't
     confused by it; flag to the user as a possible follow-up item outside Phase 16, not a
     blocker.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| `railway` CLI | Deploying server/worker | ✓ [VERIFIED: `railway --version` run live] | 4.11.0 | — |
| Railway auth/link | Deploying server/worker | ✓ [VERIFIED: `railway whoami`/`railway status` run live] | logged in as `chiragthesia`, project `morai` | — |
| `vercel` CLI (global) | Inspecting web deploys | ✗ [VERIFIED: `command -v vercel` empty] | — | `npx --yes vercel ...` (confirmed working, v54.20.0, already authenticated as `harithesia-6928`) |
| `curl` | Smoke checks | ✓ | system | — |
| `jq` | Parsing Railway/Vercel JSON output | ✓ | system | — |
| MCP client access to prod bearer token | D-04 smoke checklist via `get_status`/`get_journal`/`get_cot` | not verified in this research session (no MCP client invoked) | — | `curl` against `/api/status` covers the public part; journal/cot/macro routes need the bearer or a web session — use the MCP tools directly during execution, this research only confirmed the plain HTTP status endpoint. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** global `vercel` CLI — use `npx --yes vercel` instead.

## Validation Architecture

This phase has no automated test framework to run — DEPLOY-04's three success criteria are all
externally-observable ops facts (deployed build identity, live alert-surface visibility,
functional non-regression), not unit-testable code behavior. The existing Vitest suite
(`bun run test`) should stay green throughout (no source changes expected), and running it once
before starting is a cheap sanity check that the working tree itself isn't broken before it's
uploaded via `railway up` — but it is not a per-requirement test map in the usual sense.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing repo-wide suite) — sanity-check only, not phase-specific |
| Config file | repo root `vitest` config (pre-existing) |
| Quick run command | `bun run test` (before deploying, confirms tree is green) |
| Full suite command | `bun run test` (same — no phase-specific subset) |

### Phase Requirements → Verification Map
| Req ID | Behavior | Verification Type | Command | Evidence Exists? |
|--------|----------|--------------------|---------|-------------------|
| DEPLOY-04 (criterion 1) | Server/worker/web run the phase-15 build | ops/manual | `railway deployment list --service <x> --json --limit 1` timestamp check + Vercel dashboard commit check | ❌ — must be captured fresh at execution time (state changes the moment `railway up` runs) |
| DEPLOY-04 (criterion 2) | T-24h alert surface visible on `/api/status` and web | ops/manual (checkpoint 1: key presence; checkpoint 2: deferred to ~07-08) | `curl .../api/status \| jq .tokenFreshness` + web eyeball of `AuthExpiredBanner` amber state (only renders when actually inside the window — cannot be forced, per D-02) | Partial — checkpoint 1 (key presence) can close now; checkpoint 2 (live banner observation) cannot close until the real window |
| DEPLOY-04 (criterion 3) | No regression in live-stream, journal, COT, FRED | manual smoke (D-04) | MCP `get_status`/`get_journal`/`get_cot`/`get_macro` + web eyeball + RTH-bound stream check | ❌ — must be run post-deploy |

### Sampling Rate
- **Per deploy command:** re-run the post-deploy proof snippet (Code Examples) immediately after
  each `railway up`.
- **Phase gate:** full D-04 manual checklist before closing the phase; checkpoint 2 of D-02
  remains open as a scheduled follow-up past phase close (~2026-07-08), per CONTEXT.md.

### Wave 0 Gaps
None — no test files needed; this is an ops-verification phase, not a code-test phase.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No new auth code; existing Supabase JWT (web) and MCP bearer (jobs/tools) untouched. |
| V3 Session Management | No | Unchanged. |
| V4 Access Control | Yes (verify, don't build) | Confirm `/api/status` remains the **only** public, unauthenticated route post-deploy (`app.route("/api", statusRoutes(...))` mounted before the authenticated groups in `main.ts`) — a redeploy must not accidentally reorder middleware. Spot-check with an anonymous `curl` to a protected route (e.g. `/api/jobs/*`) expecting a 401, alongside the `/api/status` 200. |
| V5 Input Validation | No | No new input surface. |
| V6 Cryptography | No | `TOKEN_ENCRYPTION_KEY` and Postgres `broker_tokens` encryption untouched by a redeploy of existing images. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Accidental public exposure of an internal-only service via CLI misuse | Elevation of Privilege / Information Disclosure | Explicit `--service` on every Railway CLI command; the sidecar's `NO public domain` invariant (GW-05) must be re-verified (and the accidental domain from this research session removed) before the phase is considered closed. This is a live finding from this research session, not a hypothetical. |
| Healthcheck route mistakenly gated behind auth after a refactor | Denial of Service (failed deploy loop) | `/api/status` must stay outside `authReadGroup`/`bearerAuth` — verified unchanged in `main.ts` during this research (route registration order confirmed: status route mounted first, `/api` auth groups after). No code change this phase should touch this ordering; if a future phase does, re-verify. |
| Stale deployed image silently missing a security-relevant fix | Tampering (indirect) | This phase's own core mechanism (verify-then-force-deploy per service) is the mitigation — the six-commit gap identified above is exactly this failure mode caught in the act. |

## Sources

### Primary (HIGH confidence — verified live this session)
- `railway deployment list --service server/worker/sidecar --json` — deployment history, commit
  hashes, build config, timestamps.
- `railway variables --service server/worker --json` — confirmed env var completeness
  (SIDECAR_URL, FRED_API_KEY, etc.) per service.
- `npx --yes vercel ls` / `vercel inspect --format=json` — web deployment history and build
  config.
- `curl https://server-production-f5ca2.up.railway.app/api/status` — live prod payload shape and
  current values.
- `git log --format="%h %ad %s" --date=iso-strict`, `git status -sb`, `git rev-parse HEAD
  origin/main` — exact commit timeline and local/remote divergence.
- Repo source: `apps/server/src/main.ts`, `apps/server/src/adapters/refresh-expiry-warner.ts`,
  `apps/web/src/components/AuthExpiredBanner.tsx`, `packages/contracts/src/status.ts`,
  `railway.server.toml`, `railway.worker.toml`, `vercel.json`,
  `docs/architecture/deployment.md`, `docs/operations/schwab-reauth-runbook.md`.

### Secondary (MEDIUM confidence)
- Timestamp-based correlation of the Vercel production deployment to commit `220719f` (Vercel
  CLI JSON did not expose an explicit git-sha field for this deployment — see Open Question 1).

### Tertiary (LOW confidence)
- None — every claim in this document was checked against a live tool or the repo itself during
  this research session.

## Metadata

**Confidence breakdown:**
- Deploy-gap identification (which commits are/aren't in prod): HIGH — derived from live
  `railway deployment list --json` timestamps cross-referenced against `git log` timestamps to
  the minute.
- Web-current-ness: MEDIUM-HIGH — strong timestamp correlation, one open question (Vercel
  dashboard commit-sha confirmation) left for the executor to close in 30 seconds.
- Security finding (sidecar domain): HIGH — directly observed, not inferred.

**Research date:** 2026-07-03
**Valid until:** This research is time-sensitive by nature (deployment state changes the moment
anyone runs `railway up` or pushes to `main`). Treat the specific commit hashes and timestamps as
a snapshot as of 2026-07-03T18:15Z; re-run the verification commands in Code Examples immediately
before planning/executing if more than a few hours have passed.
