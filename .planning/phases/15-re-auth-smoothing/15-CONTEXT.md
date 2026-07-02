# Phase 15: Re-Auth Smoothing - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning — **decisions D-01..D-04 are Claude-recommended defaults
(user selected all four discussion areas, then went AFK before answering). User must
skim the Decisions section before/at plan review and may override any of them.**

<domain>
## Phase Boundary

The operator is never silently killed by the Schwab 7-day refresh-token expiry: the
system warns at T-24h (AUTH-05), and restoring auth is a documented, redeploy-free
operator flow that writes fresh tokens to Postgres for the sidecar to pick up (AUTH-06).
Plus one 2-line debt cleanup from the v1.1 milestone audit (stale `refresh-tokens`
trigger_job entry).

</domain>

<decisions>
## Implementation Decisions

### Alert delivery (D-01 — provisional, Claude-recommended)
- **D-01:** Passive surfaces only: `GET /api/status` exposes `refreshExpiresIn`
  (non-null inside T-24h) per app; the web dashboard shows an amber warning banner
  (extend the existing `AuthExpiredBanner` pattern); MCP `get_status` carries the same
  contract field so Claude Code sessions surface it for free. **No push-notification
  adapter** — user is in the dashboard daily during RTH; a push channel (ntfy/Telegram/
  email) is deferred (new adapter + secret for marginal gain). Rationale: roadmap SC1
  only requires the status field + a logged warning.

### Re-auth flow surface (D-02 — provisional, Claude-recommended)
- **D-02:** Harden the existing **CLI two-step** (`apps/sidecar/seed_token.py`
  `authurl` → `exchange`) as the operator re-auth flow, and write the operator runbook
  (AUTH-06). **No web re-auth form** — a dashboard route that accepts pasted OAuth
  redirect URLs and writes broker tokens expands the attack surface of the
  internet-facing server for a ~weekly operator task, and roadmap SC2 explicitly
  specifies "local re-auth flow (manual-flow → token_write → Postgres)". Web
  one-click form = deferred idea.
- **D-02a:** Flow must cover BOTH Schwab apps (trader + market) in one pass —
  seed_token.py already does; keep it that way.
- **D-02b:** Runbook lives in `docs/` (operator-facing), linked from the alert banner
  text or status output if practical.

### Alert stages/timing (D-03 — provisional, Claude-recommended)
- **D-03:** Two states only, no escalation ladder: **amber warning** from T-24h until
  expiry (new), **red AUTH_EXPIRED** at expiry (already exists). A single warning log
  line fires when freshness computation first crosses T-24h. Escalating T-48/T-24/T-0
  stages rejected as over-engineering for a single-operator system.

### Fold-in: trigger_job cleanup (D-04 — provisional, Claude-recommended)
- **D-04:** YES — fold the v1.1 milestone-audit debt item into this phase: remove
  `"refresh-tokens"` from `TRIGGERABLE_JOBS` in `packages/contracts/src/jobs.ts` and
  update the `trigger_job` MCP tool description in
  `apps/server/src/adapters/mcp/tools/trigger-job.ts`. Retired in Phase 11; invoking it
  today returns a storage-error. Same subsystem, trivial diff.

### Claude's Discretion
- Where the T-24h expiry math lives (core use-case vs status route) — follow existing
  freshness-computation placement.
- Exact `refreshExpiresIn` representation (seconds vs ISO timestamp) — match existing
  status contract conventions.
- Banner copy and styling — follow AuthExpiredBanner precedent.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition
- `.planning/ROADMAP.md` — Phase 15 section (goal, AUTH-05/06, success criteria; SC2
  wording locks the local-flow decision)
- `.planning/REQUIREMENTS.md` — AUTH-05, AUTH-06 requirement text
- `.planning/v1.1-MILESTONE-AUDIT.md` — trigger_job debt item being folded in (D-04)

### Token/auth code (the surfaces this phase touches)
- `packages/contracts/src/status.ts` — tokenFreshness contract: per-app
  `status: fresh|stale|AUTH_EXPIRED|none_yet`, `refreshIssuedAt`, `lastRefreshError`.
  AUTH-05 adds `refreshExpiresIn` here.
- `apps/sidecar/seed_token.py` — the existing two-step re-auth flow (authurl →
  exchange, both apps, dual-writes token_json + encrypted columns).
  **⚠ Has UNCOMMITTED working-tree modifications** (user iterated during the 2026-07-01
  OAuth dance) — planner must diff/reconcile before building on it.
- `apps/sidecar/token_store.py` — sidecar token ownership; `refresh_issued_at` is NEVER
  updated by auto-refresh (Phase 4 P02) — it anchors the 7-day TTL clock. Expiry =
  `refresh_issued_at + 7d`.
- `packages/adapters/src/postgres/schema.ts` — `broker_tokens` table (~line 207).
- `apps/web/src/components/AuthExpiredBanner.tsx` — existing red expired banner; the
  amber T-24h warning extends this pattern.

### Cleanup targets (D-04)
- `packages/contracts/src/jobs.ts` — `TRIGGERABLE_JOBS` stale `refresh-tokens` entry
- `apps/server/src/adapters/mcp/tools/trigger-job.ts` — stale tool description

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `seed_token.py` two-step CLI: AUTH-06 is ~80% built — needs hardening + runbook, not
  invention.
- Freshness computation already feeds `/api/status` and MCP `get_status` from the same
  contract — adding `refreshExpiresIn` propagates to web + MCP automatically (MCP-02
  satisfied by construction).
- `isNearExpiry` pattern from Phase 5 (JOB-02) — roadmap flags it as the alert
  precedent.
- `AuthExpiredBanner` — mount point and pattern for the amber warning state.

### Established Patterns
- Sidecar is sole token owner (GW-01/03); sidecar internal-only (GW-05) — no auth
  machinery gets exposed on the public server.
- Tokens never in code/logs/commits (workflow rule); seed_token logs no token values.
- Sidecar picks up externally-written tokens on its next auto-refresh cycle — SC2
  depends on this; researcher should verify the pickup mechanism (token_store re-read
  semantics) rather than assume.

### Integration Points
- `packages/contracts/src/status.ts` → status route → web `useStatus` → banner.
- `broker_tokens` row (per app_id) ← seed_token.py writes; sidecar token_store reads.

</code_context>

<specifics>
## Specific Ideas

- User's pain is real and recent: the 2026-06-26→07-01 worker outage and repeated
  manual OAuth dances this week are the motivating incidents. The alert must fire
  BEFORE expiry ("never a silent outage"), and the runbook must be executable by a
  future Claude session (non-interactive steps, exact commands).

</specifics>

<deferred>
## Deferred Ideas

- **Push-notification channel** (ntfy/Telegram/email) for token expiry + job-failure
  alerts generally — new adapter, broader than this phase.
- **Web one-click re-auth form** in the dashboard (paste redirect URL → server writes
  token) — attack-surface trade-off; revisit if CLI flow proves annoying.
- **Silent-stall stream watchdog** (Phase 12 leftover, noted in milestone audit) — not
  auth, don't fold here.

### Reviewed Todos (not folded)
- `03-code-review-followups.md` — phase-3 advisory review items; unrelated to re-auth.
- `over-engineering-cleanup.md` — dead-code/deps cleanup (ponytail audit); unrelated;
  keep for a maintenance window.

</deferred>

---

*Phase: 15-re-auth-smoothing*
*Context gathered: 2026-07-02*
