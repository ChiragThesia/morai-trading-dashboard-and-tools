# Morai — Trading Dashboard & Tools

## What This Is

A self-hosted online trading system that collects SPX options data (Schwab + CBOE), keeps a
per-calendar journal of 30-minute RTH snapshots (price, greeks, IV term structure), computes
derived analytics (BSM greeks, skew, forward vol), and exposes all of it live through a typed HTTP
API and an MCP server. The first consumer is Claude Code; a web UI comes later. It is for one
trader (the author) running SPX calendar spreads who wants every trade's life recorded and
queryable.

## Core Value

**The journal**: for any calendar, answer "how did price and greeks move over the life of this
trade?" — collected automatically, never hand-edited, queryable by API and by Claude Code. If
everything else fails, this must work.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — pre-code; ship to validate.)

### Active

<!-- Current scope. Backend + data layer first; driven by APIs + MCP. -->

- [ ] Monorepo scaffold (Bun workspaces) with the hexagon enforced: `core` imports only `shared`;
      boundary rules fail the build when violated.
- [ ] Supabase Postgres reachable; Drizzle schema + idempotent migrations run on boot.
- [ ] Walking skeleton deployed to Railway: `GET /api/status` live in prod, MCP `get_status`
      reachable by Claude Code.
- [ ] CBOE adapter: pull a delayed SPX option chain behind a market-data port (no auth).
- [ ] Schwab adapter: OAuth two-app client (vendored), tokens in Supabase, graceful AUTH_EXPIRED.
- [ ] Own BSM engine: IV inversion + greeks, property-tested, calibrated against known values.
- [ ] Calendar registration + `snapshot-calendars` job writes 30-min RTH `calendar_snapshots`.
- [ ] Journal read surface: `GET /api/journal/:calendarId` + MCP `get_journal` return the snapshot
      series for one calendar — the end-to-end MVP.
- [ ] Derived analytics: skew + term-structure observations, exposed via API + MCP.
- [ ] Journal rebuilt from Schwab fills (`sync-fills` / rebuild) — never hand-written.

### Out of Scope

<!-- Explicit boundaries with reasoning. -->

- **Web UI (`apps/web`)** — deferred (D19). Build a strong API/MCP backend first; UI later on Vercel.
- **Supabase-native features (Realtime, Auth, RLS, auto-REST)** — deferred (D18). Supabase is used
  as managed Postgres only, to keep the hexagon vendor-neutral and swap cost low.
- **Live trade advice / regime scoring / entry-exit recommendations** — the separate `trade-advisor`
  plugin owns live analysis. Morai owns *collected/historical* data. They may merge later.
- **Market-data streaming (websockets)** — deferred (D17). 30-min snapshot cadence is covered by
  scheduled pulls.
- **Multi-user / auth on the API** — single user now; bearer token guards MCP. Revisit at multi-user.

## Context

- **Backend shipped; architecture-complete.** Phases 1–8 are merged: hexagon scaffold,
  Supabase/Drizzle, CBOE + Schwab adapters, own BSM engine, journal + 30-min snapshot jobs,
  derived analytics, trade history, and the web-dashboard **backend** (GEX analytics endpoint +
  scheduled snapshot job, typed Hono `AppType` RPC export, Supabase-Auth + CORS). The frontend
  (`apps/web`) is Phase 9. A full hand-authored architecture doc set remains the source of truth:
  `docs/architecture/` (read `overview.md` first) + STRICT working rules in `.claude/rules/`. This
  PROJECT.md sits on top of those — it does not restate them.
- **Prior art to port, not invent.** A working `trade-advisor` plugin already implements Schwab
  OAuth (`auth.ts`: setup/refresh/status/doctor), a BSM engine, CBOE pulls, OCC symbol parsing,
  and journal-rebuild-from-fills. Inventory: `docs/trade-advisor-inventory.md`. These are
  reference implementations to re-home into the hexagon, not greenfield problems.
- **Known domain gotchas already documented.** Schwab-vs-TOS IV discrepancy + own-solver decision
  (`docs/iv-engine-discrepancy-and-solver.md`); GEX taxonomy + put-sign bug, regime thresholds
  (`docs/tos-studies-learnings.md`); SPX OI=0 quirk (SPY proxy scaled ~10.048×).
- **Synthesized trading knowledge** lives read-only in `knowledge-base/` (calendar mechanics,
  greeks, vol). Reference, never edited by code tasks.

## Constraints

- **Tech stack** (locked, see `docs/architecture/stack-decisions.md`): Bun · Hono (+RPC, Zod) ·
  Supabase Postgres 16 + Drizzle · pg-boss · Vitest (+fast-check, testcontainers, msw). Hosting:
  Railway (server + worker), Supabase (DB), Vercel (web, deferred). MCP over streamable HTTP.
- **Hexagonal law**: dependencies point inward; `core` is framework-free; vendors live in adapters;
  every driven port has an in-memory adapter. Enforced by ESLint boundaries + tsconfig refs.
- **TDD red→green is mandatory** — no production code without a failing test run first; commit at
  green only. `.claude/rules/tdd.md`.
- **Strict TypeScript** — no `any`, no `as`, no `!`; Zod at every boundary; `Result<T,E>`.
- **Docs before architecture changes** — significant decisions update `stack-decisions.md` first.
- **Supabase connection**: pg-boss + migrations use the direct/session URL (`LISTEN/NOTIFY` +
  advisory locks); never the transaction pooler.
- **Schwab weekly re-auth**: refresh tokens hard-expire 7 days after issuance. Jobs must degrade
  gracefully (pause Schwab pulls, flag AUTH_EXPIRED) — one app failing never blocks the other.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hexagonal + DDD-lite | Swap brokers/queue/host as one-directory changes, not rewrites | — Pending |
| Database = Supabase (D18) | Managed Postgres, zero infra; DB independent of compute host | — Pending |
| Supabase as "just Postgres" | Avoid vendor coupling; keep swap cost low; drive via own API | — Pending |
| Hosting split: Railway compute / Supabase DB / Vercel web (D11, D19) | Each provider a swap boundary | — Pending |
| Backend + data first, UI deferred (D19) | "Drive most things with APIs"; UI is a later API consumer | — Pending |
| MVP = one calendar's journal end-to-end | Anchors Phase work on the core value | — Pending |
| CBOE + Schwab both in foundation | Real chain data early (CBOE no-auth) + real positions (Schwab) | — Pending |
| Own BSM engine over vendor greeks | Vendor greeks are black-box; ours are consistent + attributable | — Pending |
| Spec-driven workflow (interactive GSD) | Write spec → review → approve → build; docs kept current | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-24 after Phase 8 (web-dashboard backend — GEX endpoint, Supabase Auth + CORS, AppType RPC export).*
