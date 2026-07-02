# Phase 15: Re-Auth Smoothing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 15-re-auth-smoothing
**Areas discussed:** Alert delivery, Re-auth flow surface, Alert stages/timing, Fold in trigger_job cleanup

> **Session note:** User selected all four areas for discussion, then went AFK. The
> first area's question timed out after 60s. All four decisions below are
> Claude-recommended defaults, recorded as PROVISIONAL in CONTEXT.md — user reviews
> at plan gate and may override.

---

## Alert delivery

| Option | Description | Selected |
|--------|-------------|----------|
| Status + web banner | /api/status refreshExpiresIn + amber dashboard banner; zero new infra | ✓ (Claude default) |
| Active push too | Banner plus ntfy/Telegram/email push; new adapter + secret | |
| MCP/Claude surface | Prominent in get_status MCP output | (subsumed — same contract feeds MCP free) |

**Choice rationale:** Roadmap SC1 requires only the status field + warning log; user is
in the dashboard daily during RTH; push channel deferred as its own idea.

---

## Re-auth flow surface

| Option | Description | Selected |
|--------|-------------|----------|
| Harden CLI two-step + runbook | seed_token.py authurl→exchange already exists and works; document it | ✓ (Claude default) |
| Web re-auth form | Dashboard form pastes redirect URL → server writes token | |

**Choice rationale:** Roadmap SC2 explicitly specifies a local flow; web token-write
route expands the internet-facing attack surface for a weekly operator task.

---

## Alert stages/timing

| Option | Description | Selected |
|--------|-------------|----------|
| Single T-24h amber + existing red expired | Two states, one warning log at crossover | ✓ (Claude default) |
| Escalating T-48/T-24/T-0 ladder | More stages, more state | |

**Choice rationale:** Single-operator system; escalation ladder is over-engineering.

---

## Fold in trigger_job cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Fold in | Remove stale "refresh-tokens" from TRIGGERABLE_JOBS + tool description | ✓ (Claude default) |
| Leave as debt | Keep in milestone-audit tech-debt list | |

**Choice rationale:** Same subsystem, 2-line diff, closes a v1.1 audit item.

## Claude's Discretion

- Expiry-math placement (follow existing freshness computation)
- refreshExpiresIn representation (match status contract conventions)
- Banner copy/styling (AuthExpiredBanner precedent)

## Deferred Ideas

- Push-notification channel (ntfy/Telegram/email) for expiry + job failures
- Web one-click re-auth form
- Silent-stall stream watchdog (Phase 12 leftover — separate concern)
