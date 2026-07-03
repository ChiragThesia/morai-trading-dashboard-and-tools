# Phase 16: Deploy Phase-15 Image - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 16-deploy-phase-15-image
**Areas discussed:** Build-proof strategy, T-24h alert verification, Deploy mechanics, Regression smoke scope

**Session note:** User answered the area-selection question (chose all four areas), then went
AFK. The two subsequent AskUserQuestion calls timed out (60s each). All four area decisions
below were adopted as the presented "(Recommended)" option and are marked **provisional** in
CONTEXT.md — user may override before planning.

---

## Area selection + todo folding (answered by user)

| Option | Description | Selected |
|--------|-------------|----------|
| Build-proof strategy | What counts as proof prod runs phase-15 | ✓ |
| T-24h alert verification | Banner only renders inside window | ✓ |
| Deploy mechanics | Per-service railway up, service set, order | ✓ |
| Regression smoke scope | Checklist depth, RTH timing | ✓ |

**Todo folding (multiSelect):** user selected "Fold neither (Recommended)" AND both todos —
contradictory. Clarification question timed out; defaulted to **Fold neither**.

---

## Build-proof strategy (timed out — recommended adopted)

| Option | Description | Selected |
|--------|-------------|----------|
| Field + platform sha (Recommended) | Zero code: refreshExpiresIn key presence = phase-15 server; Railway sha = worker; Vercel sha = web | ✓ (default) |
| Inject real version | RAILWAY_GIT_COMMIT_SHA → status version; durable but ships code in a deploy-only phase | |
| Platform dashboards only | No API proof; weakest vs criterion wording | |

---

## T-24h alert verification (timed out — recommended adopted)

| Option | Description | Selected |
|--------|-------------|----------|
| Field now + live window (Recommended) | Key-present at deploy; observe amber banner + warn log during real ~07-08 window | ✓ (default) |
| Simulate expiry | Force near-expiry token state in prod; touches sidecar-owned token state | |
| Field-presence only | No scheduled window observation | |

---

## Deploy mechanics (timed out — recommended adopted)

| Option | Description | Selected |
|--------|-------------|----------|
| Verify shas, deploy stale only (Recommended) | Check deployed shas first (web may already be current via Vercel auto-deploy); `railway up --service` for stale; sidecar excluded | ✓ (default) |
| Force-redeploy all three | Redeploy regardless of sha | |
| Include sidecar too | Uniform four-service baseline | |

---

## Regression smoke scope (timed out — recommended adopted)

| Option | Description | Selected |
|--------|-------------|----------|
| Manual checklist + RTH stream check (Recommended) | curl/MCP get_status/get_journal/get_cot/FRED + web eyeball; stream verified next RTH | ✓ (default) |
| Scripted smoke | Reusable post-deploy script | |
| Healthchecks only | Trust /api/status + platform green | |

## Claude's Discretion

- Deploy order among server/worker (no migration in play).
- Exact smoke-checklist wording; MCP tool vs curl per check.

## Deferred Ideas

- Real version reporting (RAILWAY_GIT_COMMIT_SHA → status `version`) — later phase; see
  CONTEXT.md Deferred Ideas.
