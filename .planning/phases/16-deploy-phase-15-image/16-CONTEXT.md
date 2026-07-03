# Phase 16: Deploy Phase-15 Image - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning
**Note:** User selected all four gray areas, then went AFK mid-discussion. Decisions D-01
through D-05 below adopt the recommended option presented for each question and are marked
**provisional** — the user may override any of them before `/gsd-plan-phase 16`.

<domain>
## Phase Boundary

Pure ops/deploy phase — zero feature code. Get the already-merged phase-15 code running in
prod on **server, worker, and web** (sidecar excluded) before the ~2026-07-09 Schwab re-auth
window, so the T-24h re-auth alert surface is verifiably live and every later v1.2 phase
builds on a current prod baseline. Requirement: DEPLOY-04.

</domain>

<decisions>
## Implementation Decisions

### Build-proof strategy (provisional)
- **D-01:** Prove "prod runs the phase-15 build" with zero code change:
  - **Server:** `refreshExpiresIn` key present in the `GET /api/status` payload — the key is
    a phase-15-only contract addition (`packages/contracts/src/status.ts`), so its presence
    (even with `null` value) is the build marker.
  - **Worker:** Railway dashboard deployed-commit sha (worker has no HTTP surface).
  - **Web:** Vercel dashboard deployment commit sha.
  - Rejected for this phase: injecting `RAILWAY_GIT_COMMIT_SHA` into the status `version`
    field (currently hardcoded `"0.0.1"` at `apps/server/src/main.ts:88`) — a durable
    improvement but it turns a deploy-only phase into a code phase. Candidate for a later
    phase (see Deferred Ideas).

### T-24h alert verification (provisional)
- **D-02:** Two-checkpoint verification, no simulation code:
  1. **At deploy:** `refreshExpiresIn` key present on `/api/status`; web status wiring
     confirmed (AuthExpiredBanner component ships in the deployed bundle).
  2. **At the real window (~2026-07-08):** observe the amber banner on web + warn log
     (`apps/server/src/adapters/refresh-expiry-warner.ts`) live during the actual T-24h
     window — the operator runs the re-auth runbook then anyway, so the observation is free.
  - Rejected: forcing a near-expiry token state in prod (touches live token state the
    sidecar owns — risk without payoff).
  - Consequence for planning: phase verification has a deferred UAT item that only closes
    ~07-08. Plan should mark checkpoint 2 as a scheduled follow-up, not a same-day gate.

### Deploy mechanics (provisional)
- **D-03:** Verify deployed shas first, deploy only stale services:
  - Check the deployed commit sha per service (Railway dashboards for server/worker/sidecar;
    Vercel for web). Web may ALREADY run phase-15 — Vercel auto-deploys from main via root
    `vercel.json`, and phase 15 merged 2026-07-02. Verify before redeploying.
  - For stale Railway services: `railway up --service server` / `railway up --service worker`
    — known gotcha: a plain git push SKIPs services (recurred Phases 8-9 and 14); force per
    service, never assume push deployed.
  - **Sidecar excluded:** redeployed 2026-07-02 during the live re-auth; DEPLOY-04 names
    server+worker+web only.
  - No migration step expected: no pending Drizzle migrations from phase 15 (last applied:
    0013). Planner should still confirm migration parity before deploying.

### Regression smoke scope (provisional)
- **D-04:** Manual checklist, no new scripts:
  - `curl`/MCP checks: `get_status` (db up, both apps' auth state), `get_journal` (fresh
    30-min snapshot timestamp), `get_cot` (latest weekly row), FRED macro series present.
  - Web eyeball: dashboard loads, positions render, GEX charts populate.
  - Live-stream check is RTH-bound: verify badge + ticking greeks during the next RTH
    session after deploy. Deploy timing itself is unconstrained; stream verification just
    waits for RTH.
  - Rejected: reusable scripted smoke suite (over-engineering for a single deploy phase);
    healthchecks-only (too weak for criterion 3).

### Todos (provisional)
- **D-05:** Fold neither matched todo — the phase ships zero code changes, keeping the
  "no regression" baseline clean. (User's multiSelect answer was contradictory — selected
  "Fold neither" AND both todos; clarification question timed out. Defaulted to neither;
  see Deferred Ideas.)

### Claude's Discretion
- Deploy order among server/worker (no migration in play, so ordering is low-stakes).
- Exact smoke-checklist wording and which MCP tool vs curl per check.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — DEPLOY-04 (the single requirement this phase covers)
- `.planning/ROADMAP.md` — Phase 16 goal + 3 success criteria

### Operations
- `docs/operations/schwab-reauth-runbook.md` — the T-24h/expired signals this deploy makes
  live, and the re-auth procedure that runs at the ~07-09 window (checkpoint 2 of D-02)

### Deploy configuration
- `railway.server.toml` — server config-as-code; healthcheck `/api/status`, timeout 60
- `railway.worker.toml` — worker config-as-code
- `vercel.json` (root) — web monorepo build (`bun run --filter @morai/web build`)

### Alert-surface code (verify, don't modify)
- `packages/contracts/src/status.ts` — `refreshExpiresIn` field (the build marker, D-01)
- `apps/server/src/adapters/refresh-expiry-warner.ts` — T-24h warn log
- `apps/web/src/components/AuthExpiredBanner.tsx` — web banner (amber T-24h state)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `GET /api/status` already doubles as the Railway healthcheck — a failed deploy never goes
  live (healthcheckTimeout 60, ON_FAILURE restart ×5).
- MCP tools (`get_status`, `get_journal`, `get_cot`) cover most of the smoke checklist
  without any new tooling.

### Established Patterns
- Dockerfile-per-service on Railway, config-as-code tomls at repo root, watchPatterns
  scoped per service.
- Vercel web deploys from root `vercel.json` (monorepo filter build, no build cache).

### Integration Points
- None — no code changes. The phase touches only Railway/Vercel deploy state.

### Known deploy gotchas (carried from prior phases)
- Railway push SKIPs services silently — always `railway up --service <name>` to force.
- `/api/status` must stay outside any auth gate or the healthcheck kills the deploy
  (Phase 8 lesson).
- Local `bun run migrate` validates ALL worker env vars (needs `SIDECAR_URL` set) — only
  relevant if migration parity check requires a local run.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the decisions above — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

- **Real version reporting:** inject `RAILWAY_GIT_COMMIT_SHA` (and a web equivalent) into
  the status `version` field so every future deploy is sha-verifiable via the API. Rejected
  from this phase to keep it zero-code (D-01); good candidate to ride along with Phase 17's
  web work or a later ops phase.

### Reviewed Todos (not folded)
- `03-code-review-followups.md` (advisory v1.0-era code fixes) — out of scope: deploy-only
  phase ships no code. Still pending.
- `over-engineering-cleanup.md` (ponytail dead-code cleanup) — same reason. Still pending.

</deferred>

---

*Phase: 16-Deploy Phase-15 Image*
*Context gathered: 2026-07-03*
