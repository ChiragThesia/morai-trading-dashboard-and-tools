# Milestones

## v1.1 Real-Time Schwab Streaming (Shipped: 2026-07-02)

**Phases completed:** 6 phases (10–15), 33 plans, ~100 tasks
**Timeline:** 8 days (2026-06-25 → 2026-07-02)
**Git range:** `e992c63` → `b603e29` — 285 commits, 322 files changed, +44,929/−5,332
**Requirements:** 18/18 satisfied (DOC-01, GW-01..05, JRNL-02, STRM-01..05, COT-01..02, MAC-01..02, AUTH-05..06)
**Closeout:** override_closeout — known verification overrides: 9 (see STATE.md Deferred Items; all v1.0-era or already UAT-closed)
**Audit:** milestones/v1.1-MILESTONE-AUDIT.md — status tech_debt, no blockers

**Delivered:** A single Python schwab-py sidecar became the sole Schwab boundary (REST +
stream); live position greeks stream to the browser; the journal is re-sourced through the
sidecar; COT and expanded FRED macro data feed new analytics surfaces; re-auth is alerted
and operator-runbook-driven instead of a silent weekly outage.

**Key accomplishments:**

1. Python schwab-py sidecar as third Railway service, sole Schwab boundary — OAuth + token ownership via `broker_tokens` callbacks, Postgres advisory-lock single-streamer guarantee, internal-only networking; TS `refresh-tokens` job and `apps/auth` CLI retired (GW-01..05)
2. Live streaming: LEVELONE_OPTION greeks (BSM-recomputed, never raw) + ACCT_ACTIVITY fills → authed SSE fan-out `GET /api/stream` with opaque tickets, cold-start reconcile, zero per-tick persistence (STRM-01..05)
3. Journal chain snapshots re-sourced through sidecar REST proxy with automatic CBOE fallback during auth gaps (JRNL-02)
4. Weekly COT adapter: `fetch-cot` cron → `cot_observations` → `GET /api/analytics/cot` + MCP `get_cot` (COT-01..02)
5. FRED macro expansion: 8 series (7 FRED + VVIX via CBOE) twice daily → `macro_observations` → `GET /api/analytics/macro` + MCP `get_macro` + Overview MacroCard (MAC-01..02)
6. Re-auth smoothing: T-24h `refreshExpiresIn` on both status surfaces, single-latch warning log, amber pre-expiry banner, operator runbook + `seed_token.py` flow — proven live 2026-07-02 (AUTH-05..06)

**Known tech debt (carried forward, from milestone audit):**

- Prod runs the pre-phase-15 image — T-24h alert surface not live until server+worker+web deploy (next re-auth window ~2026-07-09)
- No silent-stall watchdog on live stream (badge can show LIVE while ticks stalled)
- `apps/web` tsc --noEmit fails in 4 pre-phase-15 files; web has no typecheck gate in CI
- Phase 11 VALIDATION.md nyquist_compliant: false — per-task map never audited
- Phase 14 IN-01..03 + Phase 15 six Info-severity review findings (see audit frontmatter)

---
