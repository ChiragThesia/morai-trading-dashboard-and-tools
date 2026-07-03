---
phase: 16
slug: deploy-phase-15-image
status: final
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-03
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Deploy-only phase: zero repo code changes. Validation is CLI/HTTP assertions against
> live Railway/Vercel/prod state, plus two blocking human checkpoints. The vitest suite
> runs once as a pre-deploy green gate, not per-task (no code changes to sample).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing workspace suite; no new tests — zero-code phase) |
| **Config file** | existing workspace vitest config (unchanged) |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` CLI/HTTP assertions (railway/curl/jq) — no code changes, so the vitest suite is not re-run per task
- **After every plan wave:** Re-assert the wave's exit condition (Wave 1: baseline captured; Wave 2: deploy proof; Wave 3: smoke diff)
- **Before `/gsd-verify-work`:** `bun run test` green (pre-deploy gate, 16-01-03) + all automated assertions green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | DEPLOY-04 | T-16-01 | sidecar has zero public domains (GW-05) | manual checkpoint | Railway GraphQL `domains` query returns empty `serviceDomains` for sidecar | ✅ | ⬜ pending |
| 16-01-02 | 01 | 1 | DEPLOY-04 | T-16-04 | all railway CLI calls pass explicit `--service` | CLI assertion | `railway deployment list --service <svc> --json` per service; baseline recorded | ✅ | ⬜ pending |
| 16-01-03 | 01 | 1 | DEPLOY-04 | — | N/A | CLI assertion | migration parity (0013 latest, none pending) + `git status` docs-only + `bun run test` exits 0 | ✅ | ⬜ pending |
| 16-02-01 | 02 | 2 | DEPLOY-04 | T-16-03 / T-16-04 | deploys forced per service, healthcheck gates cutover | CLI assertion | `railway up --service server` / `--service worker`; latest deployment `status=SUCCESS` (not SKIPPED) | ✅ | ⬜ pending |
| 16-02-02 | 02 | 2 | DEPLOY-04 | T-16-05 | `/api/status` 200 unauthenticated; protected routes still gated | HTTP assertion | `curl /api/status` → `refreshExpiresIn` key present + deploy `createdAt` > 0c5600f commit time + worker `lastJobRuns` advance | ✅ | ⬜ pending |
| 16-03-01 | 03 | 3 | DEPLOY-04 | — | only the two baseline errors present, no new ones | MCP/HTTP assertion | `get_status`, `get_journal`, `get_cot`, FRED series checks diffed against 16-01 baseline | ✅ | ⬜ pending |
| 16-03-02 | 03 | 3 | DEPLOY-04 | — | N/A | manual checkpoint | web eyeball: dashboard loads, positions render, GEX charts populate; `refreshExpiresIn` on web status surface | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — zero-code phase, no test stubs or
framework installs needed. The only suite interaction is the pre-deploy green gate in 16-01-03.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sidecar public domain removed | DEPLOY-04 (GW-05) | Railway dashboard action gated on operator approval (API delete was classifier-blocked) | Railway → sidecar → Settings → Networking → delete `sidecar-production-1b98.up.railway.app`; re-query domains to confirm empty |
| Web dashboard eyeball | DEPLOY-04 crit. 3 | Visual render (positions, GEX charts) has no scripted assertion per D-04 | Load prod web, confirm dashboard loads, positions render, GEX charts populate |
| T-24h amber banner live (checkpoint 2) | DEPLOY-04 crit. 2 | Banner renders only inside the real T-24h window (~2026-07-08); cannot be forced (D-02) | During re-auth runbook at the window: observe amber banner on web + warn log from refresh-expiry-warner |
| Live-stream badge + ticking greeks | DEPLOY-04 crit. 3 | RTH-bound — requires next market session after deploy | During next RTH session: badge LIVE, greeks ticking |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — no code)
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-03
