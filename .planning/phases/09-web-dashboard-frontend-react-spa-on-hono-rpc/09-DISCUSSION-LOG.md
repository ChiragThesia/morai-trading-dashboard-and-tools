# Phase 9: Web Dashboard Frontend — React SPA (apps/web) on Hono RPC - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 09-web-dashboard-frontend-react-spa-on-hono-rpc
**Areas discussed:** Scenario-math location, Build/demo sequencing, Backend-gap tolerance, Analyzer demo data

---

## Scenario-math location (Analyzer live re-pricing)

| Option | Description | Selected |
|--------|-------------|----------|
| Shared quant kernel, client-side | Extract pure BSM kernel from `core` to a browser-safe leaf; both `core` and `web` import it; live in-browser re-pricing; same code both sides → no reconcile | ✓ |
| Hybrid: client + backend job reconcile | User's initial idea — compute in-browser, also fire backend job, reconcile if different | |
| Server-computed only | Every slider change calls a backend scenario endpoint; web stays contracts-only | |
| Port playground JS ad-hoc | Copy playground-v3 math into web components (second BSM impl) | |

**User's choice:** Shared quant kernel, client-side (D-01).
**Notes:** User initially proposed a hybrid (browser compute + backend compute job + reconcile-on-diff),
reasoning BSM is "heavy compute." Pushed back with numbers: the Analyzer prices only the user's 1–4
positions (~12k closed-form BSM evals/drag, sub-1ms — proven by `playground-v3.html`); the genuinely
heavy GEX (full chain) is already a Phase-8 server snapshot. Since client and server would run the
*identical* kernel on identical float64, reconcile is a no-op → rejected. User then asked whether moving
the kernel out of `core` breaks hexagonal architecture. Verified `bsm.ts` is already zero-import pure;
explained that moving it *down* to a pure leaf reverses no dependency arrow (`core → leaf`, `web → leaf`
both legal), and the forbidden edge is `web → core` which we avoid. User agreed. docs-before-code:
update stack-decisions.md + monorepo-layout.md graph before the move.

---

## Build/demo sequencing

| Option | Description | Selected |
|--------|-------------|----------|
| Overview thin-slice first | One screen end-to-end (scaffold→auth→RPC→poll→shell→Overview→Vercel), then fan out | ✓ |
| Analyzer first | Hardest screen first (quant engine, 3 chart libs, TOS parser) | |
| All five in parallel | Scaffold shell, build all screens concurrently as waves | |

**User's choice:** Overview thin-slice first (D-02).
**Notes:** De-risks the whole stack on the simplest screen before parallelizing. Analyzer deferred to
later — it depends on the shared quant kernel (D-01) landing first.

---

## Backend-gap tolerance

| Option | Description | Selected |
|--------|-------------|----------|
| Live-only, fix gaps in backend | Every screen wires to real API; a gap is a Phase-8 bug, fixed at source | ✓ |
| Allow tracked placeholders | A screen may ship against sample/cached data with a follow-up | |

**User's choice:** Live-only (D-03).
**Notes:** Confirmed POSITIONS-01 (does `GET /api/positions` return computed greeks?) is verified in
research; if a gap exists, fix the endpoint, don't fake in the UI.

---

## Analyzer demo data

| Option | Description | Selected |
|--------|-------------|----------|
| No seed data (live + locked empty states) | Mockup `ex` placeholders are mockup-only; ship real data or locked empty states | ✓ |
| Seed example calendars | Pre-populate the analyzer for demonstration | |

**User's choice:** No seed data (D-04).
**Notes:** User was emphatic — "phase 8 gives us the live data and all the setup; this should be wiring
up and setting up the UI." Resolved without a formal vote.

---

## Claude's Discretion

- Kernel home: `packages/shared` vs a new pure `packages/quant` leaf (lean: dedicated `quant`).
- Wave/plan breakdown after the Overview thin-slice; slider debounce/throttle; shadcn init +
  component-add; Supabase env wiring on Vercel; CSS-var → Tailwind token mapping.

## Deferred Ideas

- Coming-soon backend feeds (Charm/Vanna, intraday delta-flow, economic calendar) — only stubs ship
  this phase; feeds are future phases.
- Logout / settings dropdown — not this phase (single-user; reload/clear session suffices).
- Docs drift (D-05): stack-decisions.md D3 names Recharts; reconcile to the LOCKED visx/uPlot/ECharts.
