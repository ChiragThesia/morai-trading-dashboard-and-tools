# Morai — Trading Dashboard & Tools

## What This Is

A self-hosted online trading system that collects SPX options data (Schwab + CBOE), keeps a
per-calendar journal of 30-minute RTH snapshots (price, greeks, IV term structure), computes
derived analytics (BSM greeks, skew, forward vol, GEX), and exposes all of it through a typed
HTTP API, an MCP server, and a live React dashboard (morai.wtf) with real-time streamed
position greeks. It is for one trader (the author) running SPX calendar spreads who wants
every trade's life recorded and queryable.

## Core Value

**The journal**: for any calendar, answer "how did price and greeks move over the life of this
trade?" — collected automatically, never hand-edited, queryable by API and by Claude Code. If
everything else fails, this must work.

## Current State (post-v1.2, 2026-07-09)

**Shipped:** v1.0 Backend + Data Layer (Phases 1–9, 2026-06-25), v1.1 Real-Time Schwab Streaming
(Phases 10–15, 2026-07-02), and v1.2 Trade Picker & Dashboard Redesign (Phases 16–22, 2026-07-06).
See `.planning/MILESTONES.md`.

**v1.2 added:** a TOS-fidelity Overview payoff dock (per-leg IV-calibrated curves, date projection,
per-calendar toggles), a ranked-cards calendar Picker over a real `scoreCalendarCandidates` engine +
FOMC/CPI/NFP economic-events context, a 3-state stream-health watchdog, event-triggered journal
snapshots, a per-trade strategy-rules recording layer, an app-wide button/affordance system, and a
per-calendar journal lifecycle graph (P&L attribution, forward vol, signed greeks).

**Next milestone (candidate):** reliability / ops hardening — in-app Schwab re-auth trigger +
market-feed-down alert (no auto-refresh cron or prod refresh path exists today) and fixing the
`snapshot-calendars` gaps that leave open-calendar journal series ~74% empty.

- Three Railway services (server, worker, Python schwab-py sidecar) + Supabase Postgres +
  Vercel web (morai-web.vercel.app / morai.wtf).
- The sidecar is the sole Schwab boundary: OAuth + token ownership, auto-refresh, REST proxy,
  one advisory-locked streamer session. TS never talks to Schwab directly.
- Live LEVELONE_OPTION greeks (BSM-recomputed) + ACCT_ACTIVITY fills fan out over authed SSE
  to N browsers; journal snapshots, COT, and 8-series FRED macro land on 30-min/weekly/twice-daily
  crons; all surfaces ship HTTP + MCP pairs (MCP-02).
- ~1,374 tests green; hexagon enforced by ESLint boundaries; TDD red→green throughout.

**Known debt (v1.1 audit):** no silent-stall watchdog on the live stream; `apps/web` has no
typecheck gate in CI (4 pre-existing tsc failures). *(Phase 16, 2026-07-03: prod now runs the
phase-15 image on server+worker+web — T-24h re-auth alert surface (`refreshExpiresIn` +
AuthExpiredBanner) live; DEPLOY-04 validated. Next re-auth window ~2026-07-09.)*

## Current Milestone: v1.3 Picker Intelligence

**Goal:** Close the trade loop — the engine that picks entries with the user's real criteria
learns to manage exits, proves its rules on his own trade history, and inherits the rest of
his trading-knowledge playbook.

**Target features (build order):**
1. Exit advisor: per-open-calendar verdicts (HOLD / TAKE / STOP / ROLL / EXIT-pre-event) each
   picker cycle, from an exit-rule registry encoding the playbook ladder (+5/+10/+15% takes,
   −25/−50% stops, EVT/TERM/GAMMA triggers, roll rule, theta-runway-vs-risk) — held-positions
   panel in the Analyzer + MCP tool
2. PICK-04 backtest harness: replay stored chains (leg_observations since 2026-06-12) + the
   13 validated closed calendars through entry AND exit rules; measure per-rule predictive
   power against realized P&L; promote/demote weights with evidence
3. Playbook port: VIX < 25 + VIX/VIX3M < 0.95 crisis gates (requires ingesting the VIXCLS3M
   FRED series), anti-criteria (max open calendars, trend filter, loss cooldown), sizing
   tiers, event-calendar bucket (gap 3–10d cheap style)

**Key context (2026-07-09):** Picker criteria v4.1 live in prod (band-scan Δ∈[−0.49,−0.30],
gap 15–90d, liquidity-driven strikes, 66%-of-width fill haircut, 9 scored rules incl.
debitFit $3.2k–5k / θ-vega / VRP, event→exit stamp with thetaCapturePct, marketSession AH
labeling). Exit-advisor design thought through in-session — data 90% flowing already; the
user's GH trading-knowledge repo (`plugins/trade-advisor/`) is the reference spec. Reusable
oracle: his real fills. Ops rider candidates: batched BSM writes (900s handler cap),
journal snapshot gap fix.

## Requirements

### Validated

- ✓ Monorepo + hexagon enforced (FND-01..05) — v1.0
- ✓ Supabase Postgres + Drizzle idempotent migrations (DATA-01..04) — v1.0
- ✓ Railway walking skeleton: `/api/status` + MCP in prod (DEPLOY-01..03) — v1.0
- ✓ CBOE delayed SPX chain adapter, no auth (MKT-01..03) — v1.0
- ✓ Schwab OAuth two-app client, tokens in Postgres, graceful AUTH_EXPIRED (AUTH-01..04) — v1.0
- ✓ Own BSM engine: IV inversion + greeks, property-tested (BSM-01..03) — v1.0
- ✓ Calendar registration + 30-min RTH snapshot job (CAL-01..05) — v1.0
- ✓ Journal read surface: HTTP + MCP snapshot series (MVP anchor) — v1.0
- ✓ Derived analytics: skew + term structure + GEX (ANLY-01..03) — v1.0
- ✓ Journal rebuilt from Schwab fills, never hand-written (JRNL-01, JOB-01..03) — v1.0
- ✓ Trade history: `get_transactions` + chunked idempotent backfill (BRK-03..04) — v1.0
- ✓ Web dashboard: React SPA on typed Hono RPC + Supabase Auth (Phases 8–9) — v1.0
- ✓ schwab-py sidecar = sole Schwab boundary, single refresher, advisory-locked streamer,
  internal-only (GW-01..05) — v1.1
- ✓ Live streaming: position + ad-hoc greeks (BSM-recomputed) + fills over authed SSE fan-out,
  display-only, reconcile-on-connect (STRM-01..05) — v1.1
- ✓ Journal re-sourced through sidecar with CBOE fallback (JRNL-02) — v1.1
- ✓ COT positioning: weekly fetch + API/MCP series (COT-01..02) — v1.1
- ✓ FRED macro expansion: 8 series twice daily + API/MCP + MacroCard (MAC-01..02) — v1.1
- ✓ Re-auth smoothing: T-24h alert + operator re-auth without redeploy, proven live
  (AUTH-05..06) — v1.1

### Active

v1.2 scope — REQ-IDs defined in `.planning/REQUIREMENTS.md`: phase-15 deploy, Overview v2
redesign + IV calibration fix, Analyzer picker redesign, picker engine + events adapter,
stall watchdog, event-triggered snapshot, strategy-rules engine (L4).

### Out of Scope

- **Supabase-native features beyond Auth (Realtime, RLS-as-authz, auto-REST)** — Supabase used
  as managed Postgres + JWT issuer only; hexagon stays vendor-neutral (D18, softened by D20:
  Supabase Auth JWT verifies web reads).
- **Live trade advice / regime scoring** — the separate `trade-advisor` plugin owns live
  analysis; Morai owns collected/historical data. Trade Picker (v1.2 candidate) scores
  *structures*, not advice timing — boundary to re-check at v1.2 definition.
- **Full-chain streaming** — ~500-symbol streamer cap makes it impossible; 30-min REST snapshot
  stays. D17 lifted only for account/position legs + ad-hoc lookups (v1.1).
- **Multi-user / public API versioning** — single user; bearer token + Supabase JWT suffice.
- **Hand-edited journal entries** — journal is rebuilt from broker fills, source-of-truth
  discipline.

## Context

- **Architecture docs are the source of truth**: `docs/architecture/` (start `overview.md`) +
  STRICT rules in `.claude/rules/`. This PROJECT.md sits on top; it does not restate them.
- **Codebase**: Bun/TS monorepo (packages: core, adapters, contracts, shared, quant) + Python
  sidecar (`apps/sidecar`, FastAPI + schwab-py). ~45k lines added in v1.1 alone.
- **Domain gotchas documented**: Schwab-vs-TOS IV discrepancy (`docs/iv-engine-discrepancy-and-solver.md`);
  GEX put-sign + regime thresholds (`docs/tos-studies-learnings.md`); SPX OI=0 → SPY proxy
  ×10.048; CBOE timestamps are UTC; 65,534-param insert limit (chunk ≤2,000 rows).
- **Operator surface**: `docs/operations/schwab-reauth-runbook.md` — weekly Schwab re-auth via
  `seed_token.py login` + `railway redeploy --service sidecar`.
- **Synthesized trading knowledge** lives read-only in `knowledge-base/`.

## Constraints

- **Tech stack** (locked, see `docs/architecture/stack-decisions.md`): Bun · Hono (+RPC, Zod) ·
  Supabase Postgres 16 + Drizzle · pg-boss · Vitest (+fast-check, testcontainers, msw) ·
  React/Vite/Tailwind/shadcn (`apps/web`) · FastAPI + schwab-py (`apps/sidecar`). Hosting:
  Railway (server + worker + sidecar), Supabase (DB), Vercel (web). MCP over streamable HTTP.
- **Hexagonal law**: dependencies point inward; `core` is framework-free; vendors live in
  adapters; every driven port has an in-memory adapter.
- **TDD red→green mandatory**; commit at green only. `.claude/rules/tdd.md`.
- **Strict TypeScript** — no `any`, no `as`, no `!`; Zod at every boundary; `Result<T,E>`.
- **Docs before architecture changes** — update `stack-decisions.md` first.
- **Supabase connection**: pg-boss + migrations use the direct/session URL; never the
  transaction pooler. Railway has no IPv6 → session pooler for the sidecar.
- **Schwab weekly re-auth**: refresh tokens hard-expire after 7 days. One streamer session per
  account. Jobs degrade gracefully (AUTH_EXPIRED + CBOE fallback); one app failing never blocks
  the other.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hexagonal + DDD-lite | Swap brokers/queue/host as one-directory changes | ✓ Good — sidecar swap (D22) touched only adapters + composition roots |
| Database = Supabase (D18) | Managed Postgres, zero infra | ✓ Good — pooler/IPv6 quirks documented, no regrets |
| Supabase as "just Postgres" | Avoid vendor coupling | ✓ Good — softened by D20 (Supabase Auth JWT for web) deliberately |
| Hosting split: Railway / Supabase / Vercel (D11, D19) | Each provider a swap boundary | ✓ Good — 3rd Railway service added without friction |
| Backend + data first, UI deferred (D19) | UI is a later API consumer | ✓ Good — UI landed Phase 9 on a stable API |
| MVP = one calendar's journal end-to-end | Anchors work on the core value | ✓ Good — journal collecting since Jun-12 |
| Own BSM engine over vendor greeks | Consistent + attributable | ✓ Good — reused for live-stream recompute (D-02, v1.1) |
| Spec-driven workflow (interactive GSD) | Spec → review → build; docs current | ✓ Good — 15 phases, 2 milestones shipped |
| D22: Python schwab-py sidecar as 3rd service (supersedes D16 TS OAuth) | Dual-refresher race + one-streamer ownership need single-process auth | ✓ Good — live in prod, re-auth proven 2026-07-02 |
| D17 lifted for legs-only streaming | 500-symbol cap blocks full chain; positions need freshness | ✓ Good — live ticks verified in UAT |
| Opaque ticket for SSE auth (Phase 12 D-01) | Query-param JWTs leak into logs | ✓ Good |
| Stream is display-only; REST stays fill authority (STRM-04) | No per-tick writes; journal integrity | ✓ Good — regression-gated |
| Restart-only sidecar token pickup (15-02) | Sidecar reads token at construction; `railway redeploy` beats a reload endpoint | ✓ Good — documented in runbook |

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
*Last updated: 2026-07-03 — Phase 16 complete (phase-15 image deployed, DEPLOY-04 validated)*
