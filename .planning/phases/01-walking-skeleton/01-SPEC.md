# Phase 1: Walking Skeleton — Specification

**Created:** 2026-06-07
**Ambiguity score:** 0.13 (gate: ≤ 0.20)
**Requirements:** 13 locked

## Goal

Stand up a deployable Bun-workspaces monorepo where the hexagon boundary is mechanically enforced,
a real Supabase Postgres is reachable through one proven port+adapter pattern, and `GET /api/status`
plus the MCP `get_status` tool are **live in production on Railway** — one end-to-end vertical slice
from HTTP/MCP request through an application use-case to the database and back.

## Background

The repository is pre-code: only `docs/`, `.claude/rules/`, `knowledge-base/`, `CLAUDE.md`, and
`.planning/` exist. There is no `package.json`, no workspaces, no TypeScript, no schema, no deploy.
The architecture is fully decided and documented (`docs/architecture/`, source of truth) — this phase
is the first translation of that design into running code. Nothing in the requirements below exists
today; every "Current" is "does not exist." Reference implementations to draw from (not invent) live
in the `trade-advisor` plugin (`docs/trade-advisor-inventory.md`): OCC parsing, Result patterns,
config shape.

Three scope decisions were locked in the spec interview (see Interview Log): (1) Phase 1 includes a
**real production deploy** to Railway + Supabase, not local-only; (2) `GET /api/status` reports
**real DB health plus present-but-empty** token/job sections (their data lands in Phases 4/5);
(3) only **one** repository port is built end-to-end this phase to prove the port → Postgres-adapter →
in-memory-adapter → shared-contract-test pattern; the other repos are built in the phases that need them.

## Requirements

1. **Monorepo workspaces** (FND-01): Bun-workspaces monorepo with the four packages and the app shells.
   - Current: no `package.json`, no workspaces, no TypeScript project.
   - Target: root `package.json` defines Bun workspaces for `packages/{core,adapters,contracts,shared}`
     and `apps/{server,worker}`; one root `bun.lock`; `tsconfig.base.json` + per-workspace tsconfigs
     wired with project references so cross-package imports resolve.
   - Acceptance: from a clean clone, `bun install` succeeds with a single lockfile; `bun run typecheck`
     resolves a real cross-package import (e.g. `apps/server` → `packages/core` → `packages/shared`)
     with zero errors.

2. **Hexagon boundary enforcement** (FND-02): the dependency law fails the build, not just review.
   - Current: no lint/boundary tooling.
   - Target: ESLint flat config with a boundary rule (`eslint-plugin-boundaries` or
     `import/no-restricted-paths`) forbidding `core` from importing `adapters`, `apps`, any framework,
     or any vendor SDK; `core` may import `shared` only.
   - Acceptance: adding an `import` from `@morai/adapters` (or `hono`) into a `packages/core` file makes
     `bun run lint` exit non-zero with a boundary violation; removing it returns to green.

3. **Strict TypeScript** (FND-03): unsafe TypeScript is rejected mechanically.
   - Current: no compiler config.
   - Target: `tsconfig.base.json` in strict mode (incl. `noUncheckedIndexedAccess`,
     `exactOptionalPropertyTypes`) + ESLint rules: `no-explicit-any`, no type assertions
     (`consistent-type-assertions`), `no-non-null-assertion`, `no-floating-promises`,
     `switch-exhaustiveness-check`.
   - Acceptance: a file containing `any`, a non-null `!`, or an `as` assertion fails `bun run lint`
     and/or `bun run typecheck`; the clean scaffold passes both.

4. **Shared kernel** (FND-04): the cross-cutting primitives exist and are tested.
   - Current: none.
   - Target: `packages/shared` exports `Result<T,E>` (with `ok`/`err` constructors + `isOk`/`isErr`),
     `assertDefined`, and an `OccSymbol` parser/formatter (SPX/SPXW, strike ×1000 int convention).
   - Acceptance: Vitest unit tests cover `Result` ok/err flows, `assertDefined` throw-on-undefined, and
     an `OccSymbol` parse→format round-trip on a known symbol — all green.

5. **Root scripts** (FND-05): the standard workspace commands run.
   - Current: none.
   - Target: root scripts `dev | test | typecheck | lint | migrate` operate across the workspace;
     `vitest.workspace.ts` aggregates all suites.
   - Acceptance: each of the five scripts runs and exits 0 on the scaffolded repo (`dev` boots server +
     worker locally; `test` runs the full workspace suite).

6. **Journal-context schema** (DATA-01): the full data model is defined (even where unused this phase).
   - Current: none.
   - Target: `packages/adapters/postgres/schema.ts` (Drizzle) defines `calendars`,
     `calendar_snapshots`, `leg_observations`, `contracts`, `fills`, `orders`, `rate_observations`,
     with time-leading composite primary keys on the observation tables (`(time, calendar_id)`,
     `(time, contract)`).
   - Acceptance: `drizzle-kit` generates an initial migration from the schema with no errors; the
     generated SQL shows the time-leading composite keys on observation tables.

7. **Idempotent migrator** (DATA-02): migrations apply safely and repeatably.
   - Current: none.
   - Target: a migrator runs pending drizzle-kit migrations on server/worker boot — file-tracked,
     lexicographically ordered, each in its own transaction — over the Supabase **direct/session**
     connection.
   - Acceptance: `bun run migrate` applies the initial migration; a second immediate run reports 0
     applied and exits 0; boot of server and worker both trigger the migrator without error.

8. **One repository, both adapters, one contract test** (DATA-03, scoped): prove the port pattern.
   - Current: none.
   - Target: exactly one driven repository port is defined in `packages/core` (the `calendars`
     repository) with a Supabase-Postgres (Drizzle) implementation in
     `packages/adapters/postgres/repos/` and an in-memory implementation in
     `packages/adapters/memory/`; a single shared contract-test suite runs the same assertions against
     both, using testcontainers Postgres for the real one.
   - Acceptance: the shared contract test passes against both the Postgres and in-memory implementations;
     the in-memory run requires no Docker.

9. **Zod-parsed config** (DATA-04): configuration is validated once, loudly.
   - Current: none.
   - Target: a config module Zod-parses environment at the composition root into a typed object —
     required `DATABASE_URL` (direct), optional `DATABASE_POOL_URL`, required `MCP_BEARER_TOKEN`,
     `PORT`, `TZ`; boot fails with a readable error on missing/invalid values.
   - Acceptance: booting with a required var missing exits non-zero with a Zod error that names the
     offending var; booting with a valid env constructs the config and proceeds.

10. **Two Railway services on Supabase** (DEPLOY-01): real cloud topology.
    - Current: none.
    - Target: `apps/server` and `apps/worker` deploy as two separate Railway services, both pointed at
      a real Supabase Postgres project via env; build/start commands configured per `deployment.md`.
    - Acceptance: both Railway services report a successful deploy; the server exposes a public URL; the
      worker boots, runs the migrator, and logs "ready" connected to Supabase.

11. **Status endpoint live in prod** (DEPLOY-02): the health slice is observable in production.
    - Current: none.
    - Target: `GET /api/status` returns JSON `{ db: "ok" | "down" (real Supabase ping),
      tokenFreshness: "none yet", lastJobRuns: "none yet", version, uptime }`.
    - Acceptance: the production URL returns HTTP 200 with `db: "ok"`; a forced DB-unreachable case (tested
      locally) returns `db: "down"`; the `tokenFreshness` and `lastJobRuns` fields are present and empty.

12. **MCP server live in prod** (DEPLOY-03): Claude Code can reach the system.
    - Current: none.
    - Target: an MCP server (streamable HTTP via `@modelcontextprotocol/sdk`) is mounted at `/mcp` on
      the same Hono server, bearer-token protected; it exposes a `get_status` tool backed by the same
      use-case as `GET /api/status`.
    - Acceptance: `claude mcp add --transport http morai <prod-url>/mcp` registers the server; calling
      `get_status` returns the same payload as the HTTP route; a missing/incorrect bearer token returns 401.

13. **MCP-02 dual-adapter pattern established** (MCP-02): one use-case, both surfaces, one schema.
    - Current: none.
    - Target: the `get_status` use-case ships **both** a Hono route and an MCP tool, both deriving their
      response shape from a single Zod schema in `packages/contracts`; this is recorded as the standing
      pattern for every future use-case.
    - Acceptance: `packages/contracts` exports one `statusResponse` schema imported by both adapters;
      changing the schema on only one side fails `bun run typecheck` (drift is caught at compile time).

## Boundaries

**In scope:**
- Bun-workspaces monorepo scaffold: `packages/{core,adapters,contracts,shared}`, `apps/{server,worker}`.
- Mechanical enforcement: ESLint hexagon boundaries, strict-TS lint + compiler rules.
- `shared` kernel: `Result`, `assertDefined`, `OccSymbol` (tested).
- Full Drizzle schema (7 journal-context tables) + idempotent migrator.
- Exactly ONE repository (`calendars`) as port + Postgres adapter + in-memory adapter + contract test.
- Zod-parsed config at the composition root.
- Real production deploy: two Railway services + a real Supabase project.
- `GET /api/status` (real DB health, empty token/job sections) live in prod.
- MCP `/mcp` endpoint + `get_status` tool (bearer-protected) live in prod.
- The MCP-02 one-use-case-two-adapters-one-schema pattern, established on `get_status`.

**Out of scope:**
- CBOE / FRED / Schwab adapters — Phase 2 (CBOE+FRED) and Phase 4 (Schwab); no external market data this phase.
- BSM engine (IV inversion, greeks) — Phase 2.
- Calendar registration, the snapshot job, the journal read surface — Phase 3 (the MVP anchor).
- Every repository other than `calendars` (snapshots, leg_observations, contracts, fills, orders, rates) — built in the phase that needs each.
- Real background jobs / pg-boss queue + schedules — Phase 5; in Phase 1 the worker only boots + migrates.
- `broker_tokens` table + token encryption — Phase 4 (status reports "none yet" without the table).
- Derived analytics (skew, term structure) — Phase 6.
- Web UI (`apps/web`) and Vercel — deferred (D19); not scaffolded this phase.
- Supabase-native features (Realtime/Auth/RLS/auto-REST) — deferred (D18); Supabase used as plain Postgres.

## Constraints

- **Stack locked** (`docs/architecture/stack-decisions.md`): Bun · Hono (+RPC, Zod) · Supabase Postgres
  16 + Drizzle · Vitest (+fast-check, testcontainers, msw) · MCP streamable HTTP. No substitutions.
- **TDD red→green mandatory** — no production code without a failing test run first; commit at green only.
- **Hexagon dependency law** — `core` imports `shared` only; vendors/frameworks live in adapters; every
  driven port has an in-memory implementation maintained alongside the real one.
- **Supabase connection** — migrations + (future) pg-boss use the **direct/session** `DATABASE_URL`
  (LISTEN/NOTIFY + advisory locks), never the transaction pooler (D18).
- **Strict TypeScript** — no `any`, no `as`, no `!`; `Result<T,E>` for fallible flows; Zod at every boundary.
- **Secrets** — Supabase/Railway secrets via env only; never in repo, logs, or test fixtures.

## Acceptance Criteria

- [ ] `bun install` from a clean clone succeeds with one `bun.lock`; `bun run typecheck`, `bun run lint`, `bun run test` all exit 0.
- [ ] A `core → adapters` (or `core → hono`) import makes `bun run lint` fail with a boundary error.
- [ ] A file using `any`, `as`, or `!` fails `bun run lint`/`typecheck`.
- [ ] `packages/shared` tests cover `Result`, `assertDefined`, and an `OccSymbol` round-trip — green.
- [ ] `drizzle-kit` generates the initial migration (7 tables, time-leading composite keys) without error.
- [ ] `bun run migrate` is idempotent: second run applies 0 migrations and exits 0.
- [ ] The `calendars` contract-test suite passes against BOTH the Postgres and in-memory adapters.
- [ ] Booting with a missing required env var exits non-zero with a Zod error naming the var.
- [ ] Two Railway services (server, worker) deploy successfully against a real Supabase project.
- [ ] The production URL returns 200 for `GET /api/status` with `db: "ok"` and present-but-empty token/job fields.
- [ ] `claude mcp add --transport http morai <prod-url>/mcp` registers; `get_status` returns the same payload as the HTTP route; bad bearer → 401.
- [ ] `packages/contracts` exports one `statusResponse` schema used by both adapters; a one-sided change fails `bun run typecheck`.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                |
|--------------------|-------|------|--------|------------------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Deploy scope locked: real prod deploy this phase     |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | Status payload + single-repo scope decided           |
| Constraint Clarity | 0.85  | 0.65 | ✓      | Stack + hexagon + Supabase connection rules locked   |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 12 pass/fail criteria                                |
| **Ambiguity**      | 0.13  | ≤0.20| ✓      |                                                      |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

| Round | Perspective     | Question summary                              | Decision locked                                                       |
|-------|-----------------|-----------------------------------------------|------------------------------------------------------------------------|
| 1     | Boundary Keeper | Deploy scope of Phase 1?                       | Real prod deploy: provision Supabase + Railway, live `/api/status` URL  |
| 1     | Boundary Keeper | What does `/api/status` report with no tokens/jobs yet? | Real DB health + present-but-empty token/job sections (forward-compatible) |
| 1     | Simplifier      | How many repos built this phase?              | One (`calendars`) end-to-end to prove port+dual-adapter+contract-test; others later |

---

*Phase: 01-walking-skeleton*
*Spec created: 2026-06-07*
*Next step: /gsd-discuss-phase 1 — implementation decisions (how to build what's specified above)*
