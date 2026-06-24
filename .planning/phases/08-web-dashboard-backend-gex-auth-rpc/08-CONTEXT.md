# Phase 8: Web Dashboard Backend — GEX endpoint, contract, RPC export, Supabase Auth + CORS - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

The **backend slice** of the web dashboard: the typed, authenticated API surface the React
SPA (Phase 9) consumes. This phase delivers four things and **no UI**:

1. A **GEX (gamma exposure) analytics endpoint** — net gamma profile, flip level, call/put
   walls, per-strike GEX, GEX-by-expiry — computed from `leg_observations` by a **scheduled
   snapshot job** and served from a stored `gex_snapshot` row (cached, not per-request).
2. A **Zod contract** for the GEX response in `packages/contracts`.
3. The Hono **`AppType` export** from `apps/server` so a typed `hc<AppType>()` RPC client works.
4. **Supabase Auth + CORS** gating on the read endpoints (status, journal, brokerage,
   analytics, gex), which are currently unauthenticated.

**Out of scope (→ Phase 9, frontend):** `apps/web` scaffold, the five screens, auto-poll wiring,
login UI, the per-calendar rebuild button, coming-soon stubs, journal pre-Jun-12 UX. The frontend
phase reuses the approved UI-SPEC (moved to the Phase 9 directory).

</domain>

<decisions>
## Implementation Decisions

### GEX compute strategy
- **D-01:** **Snapshot-job, not on-read.** A scheduled pg-boss job computes the full GEX
  payload from the latest `leg_observations` each RTH snapshot cycle and writes one
  `gex_snapshot` row. The endpoint serves the most recent stored row (cheap read). Rationale:
  GEX has multiple consumers per page (Market screen, Analyzer panel, header stats) and the
  source data is already only 30-min-fresh, so re-pricing the full chain per request buys no
  freshness. Re-run within a cycle must be idempotent (0 duplicate rows).

### Authentication & exposure
- **D-02:** **Supabase Auth (full login)** gates the read endpoints. Today `/api` status,
  journal, brokerage (real positions + P&L), and analytics are **unauthenticated**; once
  `apps/web` on Vercel reaches them with CORS open, that brokerage data is internet-reachable.
  The API verifies a Supabase Auth JWT/session on read endpoints; unauthenticated → 401. CORS
  allows the Vercel web origin only. **Single account (the trader); signups closed.**
- **D-02a:** This **un-defers** the Supabase-Auth deferral recorded in
  `docs/architecture/stack-decisions.md` (D18 + the deferred-features note whose "revisit
  trigger" was *a concrete need for Supabase Auth*). Per the docs-before-code rule, the
  stack-decisions entry (and/or a new ADR) MUST be updated **before** auth code lands.

### Cross-cutting (carried from ROADMAP)
- **D-03:** **MCP-02 applies** — the GEX use-case ships **both** an HTTP route **and** an MCP
  tool (e.g. `get_gex`) in the same change, like every other use-case. Do not ship the HTTP
  endpoint alone.
- **D-04:** **Hexagon boundary** — GEX is a new application use-case: a core port + domain
  computation (reuse the existing BSM greeks engine), a driven adapter to read
  `leg_observations` and persist `gex_snapshot`, and driving adapters (HTTP route + MCP tool +
  the job handler). `core` imports `shared` only.

### Phasing
- **D-05:** **Backend (Phase 8) before frontend (Phase 9).** ROADMAP restructured this session:
  the old single "Phase 8: Web Dashboard — React frontend …" became Phase 8 (this backend
  slice) + a new Phase 9 (frontend). Frontend starts against a finished, typed, authenticated API.

### Refresh model (decided here, applies in Phase 9)
- **D-06:** The frontend will **auto-poll** live data via TanStack `refetchInterval`. The
  snapshot-job (D-01) keeps GEX reads cheap, so polling is inexpensive. Recorded here for
  continuity; implemented in Phase 9.

### Claude's Discretion
- Endpoint path/naming and MCP tool name, exact port/interface shapes, the `gex_snapshot`
  migration, the CORS allowed-origins config mechanism, and the Supabase-JWT-verification
  middleware mechanism are left to research + planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture (source of truth)
- `docs/architecture/stack-decisions.md` — D4 (TanStack Query + Hono RPC client), D11/D19
  (Vercel for `apps/web`, separate origin → CORS on the API), D18 (Supabase as DB; the
  Supabase-Auth deferral being revisited by D-02 — **update this file before auth code**).
- `docs/architecture/overview.md` — hexagon hard rules; GEX as a new use-case must obey them.

### Design contract (frontend, but lists backend action items)
- `.planning/phases/09-web-dashboard-frontend-react-spa-on-hono-rpc/09-UI-SPEC.md` — approved,
  LOCKED. Its **"Backend Data Gaps (Planner Action Items)"** section is the authoritative task
  list; the backend-relevant rows for this phase are **GEX-01** (compute), **GEX-02** (contract
  shape), **RPC-01** (`AppType` export), and **POSITIONS-01** (confirm whether
  `GET /api/positions` returns computed greeks or raw — may need a read-through-BSM layer).

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01, UI-02 (web reqs; primarily satisfied by Phase 9, but
  the API foundation lives here).

### Existing code (integration points)
- `apps/server/src/main.ts` — route wiring (`app.route("/api", …)`), the `bearerAuth` pattern,
  and the `/api/jobs/*` + `/mcp` protected groups. The auth change touches this file.
- `apps/server/src/adapters/http/analytics.routes.ts` — closest analog for a new `gex` route.
- `apps/server/src/adapters/mcp/tools.ts` — where the `get_gex` MCP tool registers (MCP-02).

### GEX math prototype (validate the endpoint against this)
- `mockups/playground-v3.html` — the working GEX computation the user iterated to.
- `mockups/gex-snapshot.json`, `mockups/gex-profile.json` — sample payloads / expected shape.
  Reference values from the prototype: γ-flip ≈ 7488, net ≈ −$47B/1%, call wall 7600, put
  wall 7400.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **BSM greeks engine** (`packages/core`): GEX re-prices the chain / sums gamma·OI — reuse the
  existing greeks math, do not re-derive.
- **pg-boss job infra** (`apps/worker` + Phase 5 job handlers): the GEX snapshot job slots into
  the existing scheduled-job machinery alongside the 30-min snapshot/refresh jobs.
- **`bearerAuth` middleware** (`apps/server/src/adapters/mcp/bearer.ts`): the existing
  read-side auth pattern; Supabase-Auth verification is the new analog for read endpoints.
- **`contracts` package**: existing Zod contracts (e.g. analytics) are the template for
  `packages/contracts/src/gex.ts` + its `index.ts` export.
- **`leg_observations`** table: the GEX source — per-contract gamma, delta, OI across the full
  SPX chain, snapshotted every 30 min from Jun-12 onward.

### Established Patterns
- **MCP-02 cross-cut:** every use-case ships HTTP + MCP together (D-03).
- **Hexagon + DDD-lite:** new use-case = core port + domain + driven adapter + driving adapters.
- **Zod at every boundary:** the GEX response, job payload, and DB row all parse through Zod.

### Integration Points
- New `gex` route registered in `apps/server/src/main.ts`.
- New `get_gex` MCP tool in the MCP tools registry.
- New GEX snapshot job registered with the worker.
- New `gex_snapshot` table via a Drizzle migration.
- Supabase-Auth verification middleware applied to the read-endpoint groups + CORS config.

</code_context>

<specifics>
## Specific Ideas

- **GEX contract shape** (from UI-SPEC GEX-02), the target for `packages/contracts/src/gex.ts`:
  `{ spot, flip, callWall, putWall, netGammaAtSpot, profile: [{ strike, gamma }],
  strikes: [{ k, gex, coi, poi, vol }], byExpiry: [{ date, gex }] }`.
- The endpoint must reproduce the playground-v3 prototype's numbers on equivalent input
  (γ-flip, walls, net gamma at spot) — use it as the validation oracle.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 9 (frontend):** `apps/web` scaffold (Vite + React + Tailwind v4 + shadcn/ui +
  TanStack Query), the five screens, auto-poll wiring, Supabase Auth login UI, the per-calendar
  rebuild button (REBUILD-01 → existing `POST /api/jobs/rebuild-journal/trigger`), the
  pre-Jun-12 journal UX (JOURNAL-01), and the three coming-soon stubs. UI-SPEC already moved to
  the Phase 9 directory.
- **Coming-soon backend feeds (future phases):** Charm/Vanna by strike (computable from the
  chain), intraday delta-flow / HIRO (needs denser-than-30-min snapshots), economic-calendar
  feed.

### Reviewed Todos (not folded)
- `03-code-review-followups.md` — matched weakly (general "phase/goal" keywords); it is Phase-03
  code-review follow-up work, not web-backend scope. Not folded.

</deferred>

---

*Phase: 08-web-dashboard-backend-gex-auth-rpc*
*Context gathered: 2026-06-23*
