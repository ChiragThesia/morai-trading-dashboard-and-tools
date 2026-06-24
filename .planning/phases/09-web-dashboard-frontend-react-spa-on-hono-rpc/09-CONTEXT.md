# Phase 9: Web Dashboard Frontend — React SPA (apps/web) on Hono RPC - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

The **frontend slice** of the web dashboard. Scaffold `apps/web` (Vite + React + Tailwind v4 +
shadcn/ui + TanStack Query + Supabase Auth client) and build the **five approved screens**
(Overview, Analyzer, Positions, Journal, Market) per the **LOCKED** `09-UI-SPEC.md`, consuming
the typed Hono RPC client (`hc<AppType>()`) that Phase 8 exports.

This phase is **wiring + UI**, not new product surface. Phase 8 delivers the live data and all
backend setup (GEX snapshot, Supabase Auth gate, CORS, RPC `AppType`); Phase 9 connects the UI
to it:
- Live data (greeks, positions, GEX) auto-polls via TanStack `refetchInterval` (intervals locked
  in UI-SPEC).
- Supabase Auth login gates the app; 401 → clear session → Login.
- Status banner surfaces `AUTH_EXPIRED` + job failures.
- The three coming-soon features (Charm/Vanna, intraday delta-flow, economic calendar) render as
  badged stubs — never errors, never omitted.
- Journal handles trades older than the Jun-12 chain-history start gracefully (entry/exit badge).

**Out of scope:** any backend capability (lives in Phase 8 or future phases); the coming-soon
*feeds* themselves (only their stubs ship here); new screens beyond the five.

</domain>

<spec_lock>
## Design Contract (LOCKED via UI-SPEC.md)

`09-UI-SPEC.md` is **approved and LOCKED** — the binding visual + interaction contract.
Requirements **UI-01, UI-02** are satisfied by building to it. Downstream agents MUST read it
before planning or implementing. Do **not** re-litigate any of the following (all locked there):

- **Palette** — full token table from mockup `:root` (bg/panel/line/up/down/violet/amber/blue/cyan…),
  60/30/10 breakdown, semantic-color-only rules.
- **Typography** — exactly 4 size tokens (`label`/`body`/`subhead`/`display`), Space Grotesk +
  JetBrains Mono, tabular-nums, compact number display ($1.2M/$3.4B), U+2212 minus.
- **Chart libraries (non-negotiable)** — visx (payoff, net-gamma profile, equity curve, term/skew
  minis), uPlot (greek strips), Apache ECharts (GEX bars, P&L heatmap).
- **Copywriting** — every screen's headings, badges, labels, empty/loading/error/destructive copy.
- **Interaction contracts** — per-screen layout grids, the Analyzer 3-column cockpit, payoff
  z-order, crosshair tooltip, sliders/ranges, scrubber, etc.
- **Login screen** — Supabase Auth gate, centered card, copy, focus management.
- **AUTH_EXPIRED banner** — fixed bottom strip, blood-dark styling, no dismiss, driven by
  `GET /api/status` `tokenFreshness`.
- **Auto-poll intervals** — Status/market/GEX/positions 30s, journal/analytics 60s;
  `refetchOnWindowFocus`; 3-retry back-off → region error state, never full-page crash.
- **TOS calendar paste parser** — 9 parse rules + implied-IV bisection.
- **Coming-soon stubs** — three badged placeholders, exact copy + dashed-border visual spec.

**In scope (build):** the five screens + login + banner + stubs, all wired to live API per spec.
**Out of scope (locked elsewhere):** palette/type/chart/copy/layout decisions (this file does not
override the UI-SPEC).

</spec_lock>

<decisions>
## Implementation Decisions

### Analyzer scenario math — where it runs
- **D-01:** **Shared browser-safe BSM kernel, client-side live re-pricing.** The Analyzer
  re-prices payoff curves, greek strips, P&L heatmap, and the TOS-parser implied-IV **locally in
  the browser on slider drag** (live, no API round-trip — proven sub-1ms by `playground-v3.html`).
  - The **pure BSM kernel** (`bsmPrice`/`bsmGreeks`/`bsmVega`, currently
    `packages/core/src/journal/domain/bsm.ts` — already zero-import pure) is **extracted DOWN to a
    pure leaf package** that both `core` and `web` import. This reverses **no** dependency arrow
    (`core → leaf` ✓, `web → leaf` ✓); hexagon stays intact. The forbidden edge `web → core` is
    **not** used.
  - **No reconcile loop / no backend scenario job.** Client and server run the *same* kernel on
    the same float64 → identical output; there is nothing to reconcile. (Rejected the
    "compute-in-browser + fire backend job + reconcile-if-diff" idea — it reconciles to a no-op and
    adds job + race handling for zero gain.)
  - **Genuinely-heavy GEX stays server-side** — the full-chain net-gamma profile / walls come from
    the **Phase 8 GEX snapshot** (already a scheduled job), not recomputed in the browser. The
    cheap/expensive split the UI needs already exists.
  - **One kernel = cross-screen consistency:** the Analyzer's live P&L preview and the
    Positions/Journal server-computed P&L MUST agree for the same calendar. A single shared kernel
    guarantees they match (a second browser copy would risk visible divergence).
  - **docs-before-code:** update `docs/architecture/stack-decisions.md` + `monorepo-layout.md`
    dependency graph (new pure leaf / new `web → leaf` edge) **before** moving the kernel.

### Build sequencing
- **D-02:** **Vertical thin-slice first, then fan out.** Build **one screen end-to-end** to
  de-risk the whole stack before parallelizing: scaffold (`apps/web`) → Supabase Auth gate → Hono
  RPC client (`hc<AppType>`) → TanStack Query provider + poll → layout shell + sticky header +
  market strip → **Overview screen** (simplest charts) → **deploy to Vercel**. Once that slice is
  green and live, fan out the other four screens. **Analyzer comes later** — it depends on the
  shared quant kernel (D-01) landing first and is the hardest screen.

### Backend-gap tolerance
- **D-03:** **Live-only — no placeholder/sample data in shipped UI.** Every screen wires to the
  real API. If a Phase-8 endpoint gap surfaces mid-build (notably **POSITIONS-01** — confirm
  whether `GET /api/positions` returns computed greeks or raw), it is a **backend bug**: fix the
  endpoint at the source (small backend addition) rather than fake/cache in the frontend. Matches
  "Phase 8 gives us the live data."

### Demo / example data
- **D-04:** **No seed/example positions.** The mockup's `ex` (demo) position labels and seeded
  calendars are **mockup-only scaffolding**. Shipped screens render real data or the **locked
  empty states** ("No open positions…", "No journal history yet…"). The Analyzer starts from live
  positions + paste/blank only.

### Docs drift to reconcile (docs-before-code)
- **D-05:** `stack-decisions.md` **D3** still names **Recharts** for charting; the UI-SPEC locks
  **visx + uPlot + ECharts**. Reconcile the stack-decisions entry to match the LOCKED UI-SPEC
  before chart code lands (same docs-before-code pass as D-01's kernel move).

### Claude's Discretion
- Kernel home: `packages/shared` vs a new pure `packages/quant` leaf (lean: a dedicated `quant`
  leaf keeps `shared` as Result/assert/time — planner decides).
- Exact wave/plan breakdown after the Overview thin-slice; slider debounce/throttle details;
  shadcn `init` + component-add specifics; Supabase env wiring on Vercel; CSS-variable → Tailwind
  token mapping mechanics.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contract (binding — LOCKED)
- `.planning/phases/09-web-dashboard-frontend-react-spa-on-hono-rpc/09-UI-SPEC.md` — the full
  visual + interaction contract for all five screens, login, banner, stubs, TOS parser, poll
  intervals. **LOCKED — read before any UI work.** Its "Backend Data Gaps" table lists the
  Phase-9-owned items (WEB-01 scaffold, JOURNAL-01 pre-Jun-12 UX, REBUILD-01 rebuild button,
  POSITIONS-01 confirm).

### Architecture (source of truth — update BEFORE code per docs-before-code)
- `docs/architecture/stack-decisions.md` — **D4** (TanStack Query + Hono RPC client), **D19**
  (Vercel host for `apps/web`, CORS), **D3** (charting — currently says Recharts; **reconcile to
  visx/uPlot/ECharts**, D-05). Add the BSM-kernel-leaf decision here (D-01).
- `docs/architecture/monorepo-layout.md` — dependency graph (`web → contracts → shared`,
  "web never imports core"). **Update for the new pure leaf + `web → leaf` edge** before moving the
  kernel.
- `.claude/rules/architecture-boundaries.md` — the dependency law the kernel move must respect.
- `docs/architecture/overview.md` — hexagon hard rules.

### Upstream backend (what Phase 9 consumes)
- `.planning/phases/08-web-dashboard-backend-gex-auth-rpc/08-CONTEXT.md` — Phase 8 decisions:
  GEX snapshot-job (D-01), Supabase Auth gate + single account (D-02), MCP+HTTP cross-cut (D-03),
  `AppType` RPC export, GEX contract shape.

### Requirements
- `.planning/REQUIREMENTS.md` — **UI-01** (React+Vite SPA on Vercel renders journal/greeks/vol/
  skew/term), **UI-02** (status banner surfaces `AUTH_EXPIRED` + job failures).

### Existing code (integration points)
- `packages/core/src/journal/domain/bsm.ts` — the **pure** BSM kernel to extract down to a leaf
  (zero imports; `bsmPrice`/`bsmGreeks`/`bsmVega`).
- `packages/contracts/` — Zod schemas the typed RPC client consumes (incl. Phase-8 `gex`).
- `packages/shared/src/` — current pure leaf (Result, assert, OccSymbol, time).

### Mockups (visual + client-logic oracle)
- `mockups/playground-v3.html` — the **reference client-side quant implementation** (payoff,
  greek strips, heatmap, TOS parser, implied-IV bisection) — port its math to the shared kernel /
  React components; it proves sub-1ms live re-pricing.
- `mockups/overview-v1.html`, `analyzer*`/`positions-v1.html`, `journal-v1.html`, `market-v1.html`
  — per-screen visual source the UI-SPEC was generated from.
- `mockups/gex-snapshot.json`, `mockups/gex-profile.json` — sample GEX payload shapes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`bsm.ts` pure kernel** (`packages/core/src/journal/domain/`): already zero-import; the source
  of truth for client-side scenario math once relocated to a leaf.
- **`packages/contracts`**: typed Zod schemas → `hc<AppType>()` gives the web client end-to-end
  type safety without codegen (D4).
- **`packages/shared`**: the existing pure leaf; candidate home (or sibling to a new `quant` leaf).
- **Phase-8 GEX snapshot + endpoint**: serves the heavy full-chain GEX; the frontend reads it,
  never recomputes it.

### Established Patterns
- **Dependency law:** `web → contracts → shared`; **web never imports `core`/`adapters`**. The
  kernel move respects this by relocating math to a leaf, not by web reaching into core.
- **Docs-before-code:** architecture/boundary/tech changes update `docs/architecture/*` first.
- **TanStack Query** owns server state (poll + cache); auth state lives in the query client; 401 →
  clear + redirect to Login.

### Integration Points
- New `apps/web` workspace (Vite + React + Tailwind v4 + shadcn/ui + TanStack + `@supabase/ssr`).
- New pure leaf package (`packages/quant` or `shared` addition) imported by both `core` and `web`.
- Typed RPC client points at the Phase-8 API (Railway) over HTTPS with CORS for the Vercel origin.
- Vercel deploy target for `apps/web`.

</code_context>

<specifics>
## Specific Ideas

- `playground-v3.html` is the concrete "I want it like this" for the Analyzer's live math and TOS
  parser — it already runs the full scenario engine in-browser, smoothly, on slider drag. The
  shared kernel should reproduce its numbers (and the Phase-8 GEX endpoint reproduces its
  γ-flip ≈ 7488 / net ≈ −$47B/1% / walls 7400·7600 reference values).

</specifics>

<deferred>
## Deferred Ideas

- **Coming-soon backend feeds (future phases):** Charm/Vanna by strike, intraday delta-flow
  (HIRO-style, needs denser-than-30-min snapshots), economic-calendar feed. **This phase ships
  only their badged stubs** — the feeds are out of scope.
- **Logout / settings dropdown:** not surfaced this phase (single-user tool; reload/clear session
  suffices, per UI-SPEC). Future phase if needed.

None of these expand Phase 9 scope — discussion stayed within "wire the five locked screens to
live data."

</deferred>

---

*Phase: 09-web-dashboard-frontend-react-spa-on-hono-rpc*
*Context gathered: 2026-06-24*
