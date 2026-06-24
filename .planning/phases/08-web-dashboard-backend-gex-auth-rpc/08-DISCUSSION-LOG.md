# Phase 8: Web Dashboard Backend — GEX endpoint, contract, RPC export, Supabase Auth + CORS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 08-web-dashboard-backend-gex-auth-rpc
**Areas discussed:** GEX compute strategy, Dashboard auth / exposure, Live-data refresh model, v1 scope / phase split

---

## GEX compute strategy

| Option | Description | Selected |
|--------|-------------|----------|
| On-read from latest snapshot | Compute per request from latest `leg_observations`; no new table; simplest (YAGNI) | |
| Snapshot-job (pre-compute + store) | Compute once per 30-min cycle via pg-boss, store `gex_snapshot`, serve cached read | ✓ |
| Hybrid: on-read + short TTL cache | Compute on request, cache ~5min in-process | |

**User's choice:** Snapshot-job (pre-compute + store)
**Notes:** GEX has multiple consumers per page and the source is already ≤30min fresh, so a
stored snapshot serves cheap reads with no freshness loss. Re-run within a cycle must be idempotent.

---

## Dashboard auth / exposure

| Option | Description | Selected |
|--------|-------------|----------|
| Gate with a single shared secret | Extend bearerAuth to read endpoints; SPA holds a secret | |
| Keep read endpoints public | No auth on reads; brokerage data internet-reachable | |
| Full login (accounts/sessions) | Real auth with sessions (e.g. Supabase Auth) | ✓ |

**User's choice:** Full login → **Supabase Auth** (follow-up)
**Notes:** Read endpoints currently serve real positions + P&L unauthenticated. Follow-up locked
the mechanism to **Supabase Auth** (Supabase already hosts the DB; don't hand-roll session
security), single account, signups closed. Un-defers the stack-decisions D18 Supabase-Auth
deferral → requires a docs update before code (docs-before-code rule).

---

## Live-data refresh model

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-poll via TanStack refetchInterval | Background poll per screen; greeks/positions/GEX ~60s | ✓ |
| Manual refresh button only | Fetch on load + explicit refresh | |
| Auto-poll + manual refresh | Both | |

**User's choice:** Auto-poll via TanStack `refetchInterval`
**Notes:** Implemented in Phase 9 (frontend). Recorded here because the snapshot-job decision
keeps GEX reads cheap enough to poll.

---

## v1 scope / phase split

| Option | Description | Selected |
|--------|-------------|----------|
| All in Phase 8, planner waves it | One phase; planner orders backend-then-screens waves | |
| Split: backend (8a) then frontend (8b) | Backend phase first, frontend phase second | ✓ |
| Split by screen priority | 8a Overview+Journal, 8b Analyzer+Market, 8c Positions | |

**User's choice:** Split backend → frontend. Follow-up: **restructure roadmap now.**
**Notes:** ROADMAP restructured this session — old single "Phase 8: Web Dashboard — React
frontend …" became **Phase 8 (backend slice)** + new **Phase 9 (frontend slice)**. The approved
UI-SPEC moved to the Phase 9 directory (`09-UI-SPEC.md`, frontmatter updated). This CONTEXT.md
scopes the backend slice only.

---

## Claude's Discretion

- Endpoint path/naming and MCP tool name, exact hexagon port/interface shapes, the
  `gex_snapshot` migration, CORS allowed-origins config mechanism, and the Supabase-JWT
  verification middleware mechanism — left to research + planning.

## Deferred Ideas

- **Phase 9 (frontend):** `apps/web` scaffold, five screens, auto-poll wiring, Supabase Auth
  login UI, per-calendar rebuild button (REBUILD-01), pre-Jun-12 journal UX (JOURNAL-01),
  coming-soon stubs.
- **Future:** Charm/Vanna by strike, intraday delta-flow / HIRO (needs denser snapshots),
  economic-calendar feed.
