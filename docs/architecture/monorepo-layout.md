# Monorepo Layout — Bun Workspaces

## Top-Level

```
morai-trading-dashboard-and-tools/
├── apps/
│   ├── web/                  # React + Vite SPA — DEFERRED (D19), built later, hosted on Vercel
│   ├── server/               # Hono API + MCP endpoint (Railway)
│   └── worker/               # pg-boss job runner (Railway)
├── packages/
│   ├── core/                 # THE HEXAGON — domain + application, per bounded context
│   ├── adapters/             # driven adapters: postgres, schwab, cboe, fred, jobqueue
│   ├── contracts/            # Zod API schemas shared web ↔ server
│   ├── shared/               # Result, assertDefined, OccSymbol, time utils
│   └── quant/                # BSM kernel — pure math leaf, zero runtime deps (D21)
├── docs/
│   └── architecture/         # this doc set
├── knowledge-base/           # synthesized trading knowledge (read-only reference)
├── .claude/
│   └── rules/                # STRICT working rules for this repo
├── CLAUDE.md
├── package.json              # workspaces root
├── tsconfig.base.json        # strict compiler config (see rules/typescript.md)
└── eslint.config.js          # flat config + boundary enforcement
```

## Workspace Dependency Graph (enforced by ESLint + tsconfig refs)

```
apps/web ────────▶ packages/contracts ──▶ packages/shared
                 │                     ─▶ packages/core (values only, see carve-out below)
                 ▶ packages/quant  ◀─────────────────────────────────────────┐
apps/server ─────▶ packages/core ▲ packages/adapters ▲ packages/contracts    │
apps/worker ─────▶ packages/core │ packages/adapters │                        │
packages/adapters ▶ packages/core (ports only) + packages/shared              │
packages/core ───▶ packages/shared + packages/quant ──────────────────────────┘
packages/quant ──▶ (nothing — pure leaf, zero deps)
```

Rules:
- `core` imports **nothing** but `shared` and `quant`. No framework, no vendor SDK, no node
  builtins beyond pure-computation safe ones.
- `web` never imports `core` or `adapters` — it speaks HTTP via `contracts` types
  (Hono RPC client) and uses `quant` for client-side BSM math (D21).
- **Narrow carve-out (RULE-01, Phase 20 D-07):** `contracts` may import `core`'s pure Zod
  **value/enum modules** (e.g. `rule-tags.ts`'s `enterRuleTag`/`exitRuleTag`/`rollRuleTag`)
  so a recording vocabulary that becomes both a DB-boundary constraint and an HTTP/MCP
  contract is defined exactly once — the alternative (hand-copying the same string literals
  into both packages) drifts silently the first time one side is edited. This does **not**
  open the door to importing core ports, use-cases, or any domain type carrying business
  logic into `contracts` — only plain value-holding Zod schemas. Enforced narrowly by the
  `boundaries/dependencies` rule in `eslint.config.js` (`contracts → core` edge, same file).
- `quant` is a pure math leaf — it imports nothing. Both `core` and `web` may import it.
  The `web → quant` edge does NOT reach `core`; the hexagon stays intact.
- `apps/*` are composition roots — the only places where core meets adapters.

## apps/web

Hosts the React + Vite SPA deployed to Vercel (D19, D21). May import:

- `packages/contracts` — Zod API schemas + inferred types for the typed Hono RPC client
- `packages/shared` — Result, assertDefined, time utils
- `packages/quant` — BSM kernel for client-side live Analyzer re-pricing (D21)
- `apps/server` — **type-only** import of `AppType` for `hc<AppType>()` (never runtime)

`web` never imports `core` or `adapters` directly.

## apps/server

```
apps/server/src/
├── main.ts                   # composition root: env parse, adapter construction, wiring
├── adapters/
│   ├── http/                 # Hono routes (inbound adapter) — Zod parse → use-case → respond
│   │   ├── journal.routes.ts
│   │   ├── marketData.routes.ts
│   │   └── status.routes.ts
│   └── mcp/                  # MCP tools (inbound adapter) — same use-cases, MCP transport
│       └── tools.ts
└── config.ts                 # Zod env schema
```

Serves **API + MCP** in production (one Railway service). The `apps/web` SPA is deferred and will
deploy separately to Vercel (D19) — the server does not serve static UI for now.

## apps/worker

```
apps/worker/src/
├── main.ts                   # composition root: pg-boss start, schedule registration
├── schedule.ts               # cron table (single source of schedule truth)
└── handlers/                 # inbound adapters: parse payload → call use-case
    ├── snapshotCalendars.ts
    ├── computeDerived.ts
    ├── refreshTokens.ts
    └── syncFills.ts
```

## packages/adapters

```
packages/adapters/src/
├── postgres/                 # Drizzle schema + migrations + repository implementations
│   ├── schema.ts
│   ├── migrations/
│   └── repos/                # implement ForStoring*/ForGetting* ports
├── schwab/                   # OAuth two-app facade, retry/backoff, Zod-parsed responses
├── cboe/                     # CBOE data client
├── fred/                     # DGS3MO risk-free rate
├── jobqueue/                 # pg-boss behind the JobQueue port
└── memory/                   # in-memory implementations of every port — used by tests
```

`memory/` is a first-class citizen: every driven port gets an in-memory implementation,
maintained alongside the real one. This is what makes acceptance tests fast and TDD viable.

## packages/quant

```
packages/quant/src/
├── bsm.ts       # bsmPrice / bsmGreeks / bsmVega — relocated from core (D21)
└── index.ts     # barrel: export { bsmPrice, bsmGreeks, bsmVega, BsmGreeks }
```

Pure math leaf. Zero runtime dependencies. Imported by both `packages/core` (server-side
computed P&L) and `apps/web` (client-side Analyzer live re-pricing). This is the shared
kernel that guarantees cross-screen P&L consistency (D21). See `stack-decisions.md` D21.

## packages/contracts

Zod schemas for every API request/response + inferred types. Server routes validate with them;
web client gets types from them. **Contracts change = PR includes both sides.**

## Versions & Tooling

- Single lockfile (`bun.lock`) at root. `bun install` once.
- Shared `tsconfig.base.json`; each workspace extends it.
- One root `vitest.config.ts` with `test.projects` running all per-package test suites.
- Scripts at root: `bun run dev` (server+web+worker concurrently), `bun run test`,
  `bun run lint`, `bun run typecheck`, `bun run migrate`.
