# Morai — Architecture Overview

**Status**: Approved baseline — no code until this doc set was in place (done).
**Last updated**: 2026-06-05

## What Morai Is

A self-hosted, online trading application. One place where all trading data is collected,
computed, and exposed live through APIs:

- **API server** — typed HTTP API; the primary surface that drives everything.
- **Jobs** — background data collection (Schwab/CBOE pulls), derived computation (BSM greeks,
  skew, term structure), 30-minute calendar snapshots, token refresh.
- **Journal** — per-calendar price/greeks tracking at 30-minute RTH intervals; tracks how price
  and greeks evolved over the life of each trade.
- **MCP server + Claude Code plugin** — every use-case the API can do, Claude Code can do.
- **Web UI** — live dashboard (positions, journal, greeks, vol, skew/term). **Deferred** (D19):
  built later as `apps/web` on Vercel. Backend + data layer come first.

**Build order**: backend and data layer first, driven by APIs + MCP. The UI is a later consumer of
a stable API — not a Phase-1 concern.

## Why Hexagonal + DDD

Primary driver: **we swap things in and out quickly**. Brokers change (Schwab → CBOE → Polygon),
queues change (pg-boss → BullMQ), hosts change (Railway → VPS). The architecture must make each
of these a *one-directory* change, never a rewrite.

Hexagonal architecture (ports & adapters) + DDD-lite gives us that:

1. **Dependency inversion** — Domain and Application define interfaces (ports);
   Infrastructure implements them (adapters). Dependencies always point inward.
2. **Separation of concerns** — Domain and Application stay free of frameworks, SQL, HTTP,
   and vendor SDKs. Pure TypeScript, trivially testable.
3. **Swap = new adapter** — replacing Schwab with another data vendor means writing one new
   outbound adapter that satisfies the existing port. Zero changes inside the hexagon.

Reference: [Implementing DDD — Hexagonal](https://eventsandstuff.substack.com/p/implementing-domain-driven-design-hexagonal)
(adapted from Go to TypeScript; see `hexagonal-ddd.md`).

## System Context

```
  ┌──────────┐ HTTPS (deferred)  ┌──────────────────────────────────────────┐
  │ Browser  │ ─ ─ ─ ─ ─ ─ ─ ─ ▶ │                 Railway                  │
  │ (Vercel) │  apps/web later   │  ┌─────────────┐      ┌────────────────┐ │
  └──────────┘                   │  │ apps/server │      │  apps/worker   │ │
                                 │  │ Hono API    │      │  pg-boss jobs  │ │
  ┌──────────┐  MCP / HTTP       │  │ + MCP (http)│      │  (crons/queue) │ │
  │ Claude   │ ────────────────▶ │  └──────┬──────┘      └───────┬────────┘ │
  │ Code     │                   │         │     ┌───────────────┘          │
  └──────────┘                   │         ▼     ▼                          │
                                 │  ┌─────────────────┐                     │
                                 │  │ packages/core   │  ← the hexagon      │
                                 │  │ (domain + app)  │                     │
                                 │  └──────┬──────────┘                     │
                                 │         │ ports implemented by adapters  │
                                 │         ▼                                │
                                 │  ┌──────────────────────────────────┐    │
                                 │  │ packages/adapters                │    │
                                 │  │ postgres │ schwab │ cboe │ fred  │    │
                                 │  └────┬─────────┬────────┬──────────┘    │
                                 └───────┼─────────┼────────┼───────────────┘
                                         ▼         ▼        ▼
                                  ┌────────────┐ ┌───────────────────┐
                                  │  Supabase  │ │ Schwab · CBOE ·   │
                                  │ Postgres16 │ │ FRED  (external)  │
                                  └────────────┘ └───────────────────┘
```

## Stack (summary — full rationale in `stack-decisions.md`)

| Concern | Choice | Swap cost |
|---|---|---|
| Runtime / package manager | **Bun** | Low (Hono is runtime-portable) |
| Frontend | **React + Vite + TypeScript + Tailwind + shadcn/ui** | Medium |
| Backend HTTP | **Hono** (RPC + Zod) | Low — inbound adapter |
| Database | **Postgres 16 on Supabase** + Drizzle ORM | Low — outbound adapter |
| Time-series | **Plain Postgres now**; Timescale upgrade trigger documented | One migration |
| Jobs / queue | **pg-boss** (Postgres-backed) | Low — behind `JobQueue` port |
| Testing | **Vitest** (+ fast-check, testcontainers, msw); **TDD red→green mandatory** | — |
| Hosting | **Railway** (server + worker) · **Supabase** (DB) · **Vercel** (web, deferred) | Medium |
| AI integration | **MCP server** (inbound adapter) + Claude Code plugin | Low |

## Hard Rules (enforced — see `.claude/rules/`)

1. **No code without a failing test first** (TDD red→green). `.claude/rules/tdd.md`
2. **Dependencies point inward** — core never imports adapters/frameworks. `.claude/rules/architecture-boundaries.md`
3. **Strict TypeScript** — no `any`, no `as`, no `!`, Zod at every boundary. `.claude/rules/typescript.md`
4. **Docs before architecture changes** — significant decisions get an entry in `stack-decisions.md` first. `.claude/rules/workflow.md`

## Doc Map

| Doc | Contents |
|---|---|
| `stack-decisions.md` | Every tooling decision: why, swap cost, revisit trigger (ADR-lite) |
| `hexagonal-ddd.md` | Layers, ports/adapters, naming, dependency rules, bounded contexts |
| `monorepo-layout.md` | Bun workspaces, apps/packages, composition roots |
| `data-model.md` | Journal schema, snapshots, Postgres-vs-Timescale decision math |
| `jobs.md` | Job catalog, schedules, pg-boss patterns, queue port |
| `api-design.md` | Hono RPC, Zod contracts, service/DAO vocabulary mapping |
| `mcp-and-plugins.md` | MCP server as inbound adapter, Claude Code plugin shape |
| `testing-tdd.md` | Red→green workflow, test pyramid, calibration gates |
| `deployment.md` | Railway topology, environments, secrets, volumes |
