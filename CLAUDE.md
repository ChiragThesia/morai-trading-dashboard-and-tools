# Morai — Trading Dashboard & Tools

Online trading app: web UI + typed API + background jobs + MCP server, one system.
Collect trading data (Schwab/CBOE), keep per-calendar journal (30-min RTH snapshots of
price/greeks/term-structure), compute derived analytics (skew, BSM greeks), expose all to
browser + Claude Code.

## STRICT RULES

Rules in `.claude/rules/` load by file path (YAML `paths:` frontmatter), mandatory.
Priority: user instruction > rules > docs. See
[.claude/rules/README.md](.claude/rules/README.md) for how system work.

| Rule | Loads for |
|---|---|
| [architecture-boundaries](.claude/rules/architecture-boundaries.md) | `packages/**`, `apps/**` TS |
| [tdd](.claude/rules/tdd.md) | TS source + tests |
| [typescript](.claude/rules/typescript.md) | all TS/TSX |
| [workflow](.claude/rules/workflow.md) | everything |
| [docs](.claude/rules/docs.md) | all markdown |

Non-negotiables, one line each:
1. **Dependencies point inward** — `core` import only `shared`; frameworks live in adapters.
2. **TDD red→green** — no production code without failing test run first; commit at green only.
3. **No `any`, no `as`, no `!`** — parse with Zod, use `Result<T,E>`, `assertDefined`.
4. **Docs before architecture changes** — update `docs/architecture/stack-decisions.md` first.

## Documentation

- Full index: [docs/TOPIC-MAP.md](docs/TOPIC-MAP.md)
- Writing/maintaining docs: [docs/docs-on-docs/](docs/docs-on-docs/)
- All prose follow [Hemingway style](docs/docs-on-docs/hemingway-style.md)

## Architecture

Hexagonal (ports & adapters) + DDD-lite. Full doc set: `docs/architecture/` (start
`overview.md`). Swap-friendly by design: brokers, queue, DB, host all adapters.

| Layer | Where | May import |
|---|---|---|
| Domain + Application (hexagon) | `packages/core/` | `packages/shared` only |
| Driven adapters (DB, Schwab, CBOE, queue) | `packages/adapters/` | core ports, shared |
| Driving adapters (HTTP, MCP, job handlers) | inside `apps/*` | core, adapters, contracts |
| API contracts (Zod) | `packages/contracts/` | zod, shared |
| Web UI (deferred) | `apps/web/` | contracts only (HTTP via Hono RPC) |

## Stack

Bun · Hono (+RPC, Zod) · Supabase (Postgres 16) + Drizzle · pg-boss jobs ·
Vitest (+fast-check, testcontainers, msw) · MCP (streamable HTTP). Hosting: Railway (API+worker) ·
Supabase (DB) · Vercel (web, deferred). React + Vite + Tailwind + shadcn/ui for `apps/web` when UI
work starts (deferred — backend + data layer first). Rationale + swap costs:
`docs/architecture/stack-decisions.md`.

## Layout

```
apps/        web | server (API+static+MCP) | worker (pg-boss)
packages/    core (hexagon) | adapters | contracts | shared
docs/        architecture/ (source of truth)
knowledge-base/   synthesized trading knowledge — READ-ONLY reference
```

## Commands (once scaffolded)

```bash
bun install
bun run dev          # server + web + worker
bun run test         # vitest workspace
bun run typecheck && bun run lint
bun run migrate
```

## Current State

Live. Backend + web are built and deployed (Railway API/worker · Supabase · Vercel web,
morai.wtf); milestones v1.0–v1.2 shipped, v1.3 in progress. Application code is active —
follow the TDD red→green + hexagonal-boundary rules above for every change.