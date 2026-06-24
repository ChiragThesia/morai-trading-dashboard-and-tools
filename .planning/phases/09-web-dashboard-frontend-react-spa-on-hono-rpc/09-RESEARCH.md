# Phase 9: Web Dashboard Frontend (React SPA on Hono RPC) - Research

**Researched:** 2026-06-24
**Domain:** React SPA, Vite, Tailwind v4, shadcn/ui, TanStack Query, Hono RPC, Supabase Auth, visx/uPlot/ECharts, BSM kernel extraction, Vercel deploy
**Confidence:** MEDIUM (architecture patterns verified from codebase; library mechanics LOW — web search only, fast-moving ecosystem)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Shared browser-safe BSM kernel, client-side live re-pricing**
The pure BSM kernel (`bsmPrice`/`bsmGreeks`/`bsmVega`, currently `packages/core/src/journal/domain/bsm.ts` — zero-import pure) is extracted DOWN to a pure leaf package that both `core` and `web` import. No dependency arrow reversal. GEX stays server-side (Phase 8 snapshot). Docs-before-code: update `stack-decisions.md` + `monorepo-layout.md` before moving the kernel.

**D-02 — Vertical thin-slice first, then fan out**
Build Overview screen end-to-end (scaffold → auth → RPC client → TanStack Query → layout shell → Overview) → deploy to Vercel → then fan out the remaining four screens. Analyzer comes last (depends on D-01 kernel landing first).

**D-03 — Live-only, no placeholder/sample data**
Every screen wires to the real API. If a Phase-8 endpoint gap surfaces (notably POSITIONS-01), fix the endpoint — do not fake/cache in the frontend.

**D-04 — No seed/example positions**
Shipped screens render real data or the locked empty states. Analyzer starts from live positions + paste/blank only. Mockup demo labels (`ex`) are mockup-only.

**D-05 — Docs drift reconcile (docs-before-code)**
`stack-decisions.md` D3 still names Recharts; the UI-SPEC locks visx + uPlot + ECharts. Reconcile before chart code lands.

### Claude's Discretion

- Kernel home: `packages/shared` vs a new pure `packages/quant` leaf (lean: dedicated `quant` leaf keeps `shared` as Result/assert/time — planner decides).
- Exact wave/plan breakdown after Overview thin-slice; slider debounce/throttle details; shadcn `init` + component-add specifics; Supabase env wiring on Vercel; CSS-variable → Tailwind token mapping mechanics.

### Deferred Ideas (OUT OF SCOPE)

- Coming-soon backend feeds (Charm/Vanna, intraday delta-flow, economic calendar) — stubs only ship in this phase.
- Logout/settings dropdown — single-user tool; not surfaced this phase.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | React + Vite SPA on Vercel renders live journal, greeks, vol, skew/term views | Scaffold mechanics (§Standard Stack), Hono RPC client (§Architecture Patterns), Vercel deploy (§Architecture Patterns) |
| UI-02 | Status banner surfaces `AUTH_EXPIRED` + job failures | TanStack Query 30s poll of `/api/status`, banner rendered on `tokenFreshness === "AUTH_EXPIRED"` (§Architecture Patterns) |
</phase_requirements>

---

## Summary

Phase 9 is the first frontend for this project — a Vite + React + Tailwind v4 + shadcn/ui SPA deployed to Vercel. It consumes the typed Hono RPC API from Phase 8 (Railway) via `hc<AppType>()` with Supabase Auth JWT in the `Authorization` header. TanStack Query v5 owns all server state with `refetchInterval` auto-polling. Three chart libraries cover five distinct chart types (visx for SVG-based payoff/profile/equity, uPlot for synced greek strips, ECharts for GEX bars/heatmap).

The most structurally complex task is the BSM kernel extraction (D-01): the kernel at `packages/core/src/journal/domain/bsm.ts` is already zero-import and can be relocated to a new `packages/quant` leaf without reversing any dependency arrow. Both `core` and `web` then import from `@morai/quant`. This requires a docs-before-code pass (stack-decisions.md, monorepo-layout.md, architecture-boundaries rule), a tsconfig reference wiring, and an ESLint boundary update before any code moves.

The thin-slice order (D-02) derisks everything: scaffold → auth → RPC client → Overview → Vercel deploy. This proves the full stack works end-to-end before the remaining four screens and the Analyzer (which needs the quant kernel) land.

**Primary recommendation:** Build Wave 0 as: (a) docs update (D-01+D-05), (b) quant leaf extraction, (c) apps/web scaffold + auth gate + RPC client + TanStack Query + Overview screen, (d) Vercel deploy. Confirm green in prod before fanning out.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auth login gate | Browser / Client | — | Pure SPA, no SSR. Supabase Auth session stored in localStorage. Redirect to Login on 401. |
| Live data polling | Browser / Client | — | TanStack Query `refetchInterval` in SPA — no server involvement |
| AUTH_EXPIRED banner | Browser / Client | API / Backend | Browser reads `GET /api/status` poll result for `tokenFreshness`; backend owns the flag |
| Scenario math (payoff, greeks) | Browser / Client | — | D-01: client-side BSM from `@morai/quant` leaf — proven sub-1ms in mockup |
| GEX computation | API / Backend | — | Phase 8 snapshot job — never recomputed in browser |
| Chart rendering (visx/uPlot/ECharts) | Browser / Client | — | All client-side SVG/Canvas, no SSR |
| Type safety across RPC | API / Backend | Browser / Client | `AppType` from `apps/server`, consumed as type-only import in `apps/web` |
| TOS parser / IV bisection | Browser / Client | — | Pure JS in browser, no round-trip needed |
| BSM kernel (shared) | packages/quant (leaf) | — | Imported by both `core` AND `web` — must be a leaf below both |
| API contract types | packages/contracts | — | `web → contracts → shared`; web never imports core |
| Static hosting | CDN / Static (Vercel) | — | Pure Vite SPA output |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 19.2.7 | UI framework | Locked by D3; existing project-wide choice |
| vite | 8.1.0 | Build tool / dev server | Locked by D3; fast HMR, zero-config TS |
| typescript | 6.0.3 | Type safety | Workspace-wide; inherited from tsconfig.base.json |
| tailwindcss | 4.3.1 | Utility CSS | Locked by D3; v4 CSS-first, no config.js |
| @tailwindcss/vite | 4.3.1 | Tailwind v4 Vite plugin | Replaces postcss flow; single plugin entry |
| @tanstack/react-query | 5.101.1 | Server state / polling | Locked by D4 |
| hono | 4.12.27 | RPC client (`hc<AppType>()`) | Locked by D2/D4; SAME version as server |
| @supabase/supabase-js | 2.108.2 | Auth client (SPA, not SSR) | Supabase Auth per D20; `createClient` for Vite SPA |
| zod | 4.4.3 | Parse contract responses | Workspace-wide; parse-don't-cast rule |

**[VERIFIED: npm registry]** — all versions confirmed via `npm view <pkg> version` on 2026-06-24.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @visx/shape | 4.0.0 | SVG area/line/bar primitives | Payoff chart, net-gamma profile, equity curve, term/skew minis |
| @visx/gradient | 4.0.0 | LinearGradient SVG component | Teal/coral gradient fills on payoff chart |
| @visx/event | 4.0.0 | localPoint() for crosshair | Pointer position in SVG for crosshair tooltip |
| @visx/scale | 4.0.0 | d3-scale wrappers | x/y axis scale computation |
| @visx/axis | 4.0.0 | SVG axis ticks/labels | Chart axis rendering |
| @visx/group | 4.0.0 | SVG `<g>` wrapper | Chart layout groups |
| @visx/tooltip | 4.0.0 | Tooltip position util | Crosshair floating tooltip |
| uplot | 1.6.32 | High-perf multi-series line charts | Greek strips (Δ/Γ/Θ/Vega) — synced small multiples |
| uplot-react | 1.2.4 | React wrapper for uPlot | Declarative uPlot in React via ref; avoids recreating instance |
| echarts-for-react | 3.0.6 | ECharts React component | GEX by-strike bars, P&L heatmap, GEX by-expiry |
| echarts | 6.1.0 | Apache ECharts core | Peer dependency of echarts-for-react |
| lucide-react | latest | Icon library | shadcn default; no Heroicons/FontAwesome |
| shadcn (CLI) | latest | Component scaffolder | Copy-in Radix UI primitives for non-chart chrome |

**[VERIFIED: npm registry]** — all versions confirmed via `npm view` on 2026-06-24.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@supabase/supabase-js` | `@supabase/ssr` (createBrowserClient) | `@supabase/ssr` adds cookie coordination for SSR frameworks — unnecessary overhead for a pure Vite SPA. Use `supabase-js` `createClient` directly. |
| `uplot-react` | Custom `useEffect`/`useRef` wrapper | uplot-react avoids instance recreation on prop changes; hand-rolling is ~20 lines but loses the "keep alive" optimization |
| `@visx/*` individual packages | `@visx/visx` umbrella | Umbrella includes unused chart types; individual packages keep the bundle tight |
| `echarts-for-react` | Direct ECharts `useEffect`/`useRef` | echarts-for-react wraps the imperative init/resize/dispose correctly; hand-rolling is error-prone (resize observer cleanup) |

**Installation:**
```bash
# From apps/web (after scaffold):
bun add react react-dom @tanstack/react-query hono @supabase/supabase-js zod
bun add tailwindcss @tailwindcss/vite
bun add @visx/shape @visx/gradient @visx/event @visx/scale @visx/axis @visx/group @visx/tooltip
bun add uplot uplot-react
bun add echarts echarts-for-react
bun add lucide-react
bun add -d @types/react @types/react-dom typescript vite
# shadcn components (copy-in, not a dep):
npx shadcn@latest add card tabs slider toggle-group dialog input textarea badge tooltip skeleton separator button
```

---

## Package Legitimacy Audit

All packages are from well-known official maintainers with millions of weekly downloads. The `SUS` verdict from the legitimacy seam reflects `too-new` (very recent patch/minor releases — these are established packages that publish frequently). No packages are `SLOP` (unrecognized/hallucinated). All confirmed on npm registry and from their authoritative GitHub repositories.

| Package | Registry | Age | Downloads/wk | Source Repo | Verdict | Disposition |
|---------|----------|-----|--------------|-------------|---------|-------------|
| tailwindcss | npm | 10+ yrs | 121M | github.com/tailwindlabs/tailwindcss | SUS (too-new patch) | Approved — official Tailwind |
| @tailwindcss/vite | npm | ~1 yr | 38M | github.com/tailwindlabs/tailwindcss | SUS (too-new patch) | Approved — official Tailwind |
| @tanstack/react-query | npm | 5+ yrs | 58M | github.com/TanStack/query | SUS (too-new patch) | Approved — official TanStack |
| hono | npm | 4+ yrs | 50M | github.com/honojs/hono | SUS (too-new patch) | Approved — already in project |
| @supabase/supabase-js | npm | 5+ yrs | 21M | github.com/supabase/supabase-js | SUS (too-new patch) | Approved — official Supabase |
| @visx/shape | npm | 5+ yrs | 1.3M | github.com/airbnb/visx | SUS (too-new patch) | Approved — official Airbnb visx v4 |
| @visx/gradient | npm | 5+ yrs | 508K | github.com/airbnb/visx | SUS (too-new patch) | Approved — official Airbnb visx v4 |
| @visx/event | npm | 5+ yrs | 960K | github.com/airbnb/visx | SUS (too-new patch) | Approved — official Airbnb visx v4 |
| uplot | npm | 5+ yrs | 380K | github.com/leeoniya/uPlot | OK | Approved |
| uplot-react | npm | 4+ yrs | 50K | github.com/skalinichev/uplot-wrappers | OK | Approved |
| echarts-for-react | npm | 7+ yrs | 1.1M | github.com/hustcc/echarts-for-react | OK | Approved |
| echarts | npm | 10+ yrs | 3.6M | github.com/apache/echarts | OK | Approved |
| lucide-react | npm | 4+ yrs | 84M | github.com/lucide-icons/lucide | SUS (too-new patch) | Approved — shadcn default |

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious (SUS):** All SUS flags are `too-new` (recent patch releases on well-known, high-download packages from authoritative orgs). No action required beyond normal install verification. The visx packages are v4.0.0 — the v4 major release adds React 19 support. [ASSUMED: stable for production; v4 alpha/RC concerns resolved in June 2026 release based on npm pub date]

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (Vercel CDN)
  └── apps/web (Vite SPA)
        ├── Auth Gate
        │     └── supabase.auth.signInWithPassword()
        │           → Supabase Auth (hosted)
        ├── TanStack QueryClient
        │     ├── useQuery(GET /api/status, 30s) → AUTH_EXPIRED banner
        │     ├── useQuery(GET /api/gex, 30s) → Market strip + Market screen
        │     ├── useQuery(GET /api/positions, 30s) → Overview + Positions screens
        │     ├── useQuery(GET /api/journal/:id, 60s) → Journal screen
        │     └── useQuery(GET /api/analytics/*, 60s) → Overview minis
        ├── Hono RPC client (hc<AppType>)
        │     └── Authorization: Bearer <supabase-jwt>
        │           → Railway API (apps/server)
        ├── @morai/quant (BSM kernel leaf)
        │     └── bsmPrice / bsmGreeks / bsmVega
        │           → Analyzer live re-pricing (slider drag, TOS paste)
        └── Chart rendering
              ├── visx → payoff/risk profile, gamma profile, equity curve, minis
              ├── uPlot → greek strips (4-panel synced)
              └── ECharts → GEX bars, P&L heatmap, GEX-by-expiry
```

### Recommended Project Structure

```
apps/web/
├── src/
│   ├── main.tsx              # React root, QueryClientProvider, Router
│   ├── App.tsx               # Auth gate: shows <Login> or <Shell>
│   ├── lib/
│   │   ├── supabase.ts       # createClient() singleton
│   │   ├── rpc.ts            # hc<AppType>() client singleton (with auth header)
│   │   └── queryClient.ts    # QueryClient with default retry/staleTime config
│   ├── hooks/
│   │   ├── useAuthSession.ts # onAuthStateChange wrapper, 401 intercept
│   │   ├── useStatus.ts      # useQuery GET /api/status (30s)
│   │   ├── useGex.ts         # useQuery GET /api/gex (30s)
│   │   ├── usePositions.ts   # useQuery GET /api/positions (30s)
│   │   └── useJournal.ts     # useQuery GET /api/journal/:id (60s)
│   ├── screens/
│   │   ├── Login.tsx
│   │   ├── Overview.tsx
│   │   ├── Analyzer.tsx
│   │   ├── Positions.tsx
│   │   ├── Journal.tsx
│   │   └── Market.tsx
│   ├── components/
│   │   ├── Shell.tsx         # sticky header, nav tabs, market strip, AUTH_EXPIRED banner
│   │   ├── charts/
│   │   │   ├── PayoffChart.tsx    # visx
│   │   │   ├── GreekStrips.tsx    # uPlot (4-panel)
│   │   │   ├── GexBars.tsx        # echarts-for-react
│   │   │   ├── PnlHeatmap.tsx     # echarts-for-react
│   │   │   └── GammaProfile.tsx   # visx (compact + full)
│   │   └── stubs/
│   │       └── ComingSoon.tsx     # reusable dashed-border stub
│   └── index.css             # @import "tailwindcss"; @theme { ... }; :root { ... }
├── public/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
└── vercel.json               # SPA rewrites
packages/quant/
├── src/
│   ├── bsm.ts               # relocated from packages/core/src/journal/domain/bsm.ts
│   └── index.ts             # export { bsmPrice, bsmGreeks, bsmVega, BsmGreeks }
├── package.json             # name: "@morai/quant", zero deps
└── tsconfig.json            # composite: true, references: []
```

### Pattern 1: Tailwind v4 CSS-First Setup

**What:** Tailwind v4 replaces `tailwind.config.js` with an `@theme` block in your main CSS file.
**When to use:** All new Vite + React projects (including this one).

```typescript
// vite.config.ts
// Source: https://tailwindcss.com/blog/tailwindcss-v4
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': '/src' },
  },
})
```

```css
/* src/index.css */
/* Source: https://tailwindcss.com/blog/tailwindcss-v4 */
@import "tailwindcss";

/* Morai design tokens — mapped to Tailwind @theme for utility class generation */
@theme {
  --color-bg: #0a0e14;
  --color-panel: #0f1521;
  --color-panel2: #0c111a;
  --color-raise: #161d2b;
  --color-line: #1b2433;
  --color-line2: #27313f;
  --color-faint: #3a4453;
  --color-txt: #d6dbe4;
  --color-muted: #7b8696;
  --color-dim: #566273;
  --color-up: #26a69a;
  --color-down: #ef5350;
  --color-upd: #0e3b36;
  --color-downd: #3e1f23;
  --color-violet: #a78bfa;
  --color-violetd: #241d40;
  --color-amber: #f0b429;
  --color-blue: #5b9cf6;
  --color-cyan: #22d3ee;
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

/* shadcn/ui token mapping — override shadcn CSS variables to Morai palette */
/* Source: https://ui.shadcn.com/docs/tailwind-v4 */
@theme inline {
  --color-background: var(--color-bg);
  --color-foreground: var(--color-txt);
  --color-card: var(--color-panel);
  --color-border: var(--color-line);
  --color-muted-foreground: var(--color-muted);
  --color-accent: var(--color-violet);
  --color-destructive: var(--color-down);
}

:root {
  /* shadcn base variables (used by component internals) */
  --background: var(--color-bg);
  --foreground: var(--color-txt);
  --card: var(--color-panel);
  --card-foreground: var(--color-txt);
  --border: var(--color-line);
  --input: var(--color-line2);
  --ring: var(--color-violet);
  --radius: 0.5rem;
  --muted: var(--color-panel2);
  --muted-foreground: var(--color-muted);
  --accent: var(--color-violetd);
  --accent-foreground: var(--color-violet);
  --destructive: var(--color-down);
  --destructive-foreground: var(--color-txt);
}

body {
  background: radial-gradient(1100px 560px at 80% -10%, #141b29 0%, rgba(10,14,20,0) 58%), var(--color-bg);
  color: var(--color-txt);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}

@media (prefers-reduced-motion: no-preference) {
  /* animate-shimmer, glow filters go here */
}
```

**Key pitfall:** shadcn v4 projects use `@theme inline` to bridge between shadcn's `--background`/`--card` variable names and Tailwind v4's `--color-*` naming convention. Without the `@theme inline` block, Tailwind utility classes like `bg-background` won't resolve. [ASSUMED: exact syntax confirmed from shadcn docs page; may need adjustment on first `npx shadcn init` run]

### Pattern 2: shadcn Init + Components

**What:** shadcn is a copy-in component system, not a dependency. The CLI writes component files into `src/components/ui/`.

```bash
# Source: https://ui.shadcn.com/docs/installation/vite
npx shadcn@latest init
# Prompts: choose "Dark" style, "zinc" base color, CSS variables: yes
# Then override the variables in index.css with the Morai palette (see Pattern 1 above)

# Add components individually (locked list from UI-SPEC):
npx shadcn@latest add card tabs slider toggle-group dialog input textarea badge tooltip skeleton separator button
```

**IMPORTANT:** shadcn `init` writes component files. Run it once during scaffold. Do NOT re-run `init` later — it will overwrite customizations. Use `add` for individual components. [ASSUMED: stable behavior for Tailwind v4 + Vite; could surface a `components.json` version mismatch if shadcn CLI version changes between init and add]

### Pattern 3: Hono RPC Client (`hc<AppType>()`)

**What:** Type-safe client derived entirely from the server's Hono app type.
**When to use:** Every API call from `apps/web`.

The `AppType` is already exported from `apps/server/src/main.ts`:
```typescript
export type AppType = typeof app;
```

```typescript
// src/lib/rpc.ts
// Source: https://hono.dev/docs/guides/rpc
import { hc } from 'hono/client'
import type { AppType } from '../../apps/server/src/main.ts'  // type-only import

// CRITICAL: This must be a type-only import — never import the runtime server code.
// The hc() client creates type-safe wrappers for all routes in AppType.

let _supabaseSession: string | null = null

export function setAuthToken(token: string | null) {
  _supabaseSession = token
}

export const rpc = hc<AppType>(import.meta.env.VITE_API_BASE_URL as string, {
  headers: () => ({
    ..._supabaseSession ? { Authorization: `Bearer ${_supabaseSession}` } : {},
    'Content-Type': 'application/json',
  }),
})
```

**tsconfig.json for apps/web** must reference apps/server to resolve the type-only AppType import:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": []
  },
  "references": [
    { "path": "../../packages/contracts" },
    { "path": "../../packages/shared" },
    { "path": "../../packages/quant" },
    { "path": "../server" }
  ]
}
```

**ESLint boundary note:** The existing boundary rule allows `apps → apps`. Cross-app type import (`web → server`) is within the `apps` element type. The `import type` (type-only) import does not create a runtime dependency. [ASSUMED: Bun workspace + Vite bundler handles type-only cross-app imports correctly without importing server runtime code; verify during Wave 0 typecheck]

**CRITICAL: hono version parity.** `apps/web` must use the SAME hono version as `apps/server` (currently `4.12.27`). Mismatched versions cause deep type instantiation errors that are difficult to diagnose. [CITED: hono.dev/docs/guides/rpc]

### Pattern 4: TanStack Query v5 Setup + Poll Config

```typescript
// src/lib/queryClient.ts
// Source: https://tanstack.com/query/v5/docs/framework/react/guides/important-defaults
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: true,
      staleTime: 20_000,   // 20s default stale time
    },
  },
})

// src/hooks/useStatus.ts
import { useQuery } from '@tanstack/react-query'
import { rpc } from '../lib/rpc'

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const res = await rpc.api.status.$get()  // typed via AppType
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json()
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
}
```

**401 interception pattern** (prevents retrying auth errors that will never succeed):
```typescript
// In queryFn or via a custom fetch wrapper:
const res = await rpc.api.someEndpoint.$get()
if (res.status === 401) {
  queryClient.clear()
  supabase.auth.signOut()
  // navigate to /login via React Router
  throw new Error('UNAUTHORIZED')
}
```

[ASSUMED: exact route method names (`.api.status.$get()`) depend on how Phase 8 named its routes. Verify against the chained `apiRouter` in `apps/server/src/main.ts`.]

### Pattern 5: Supabase Auth in Vite SPA

**Key decision:** Use `@supabase/supabase-js` `createClient()` — NOT `@supabase/ssr`. The `@supabase/ssr` package adds cookie coordination for SSR frameworks (Next.js, SvelteKit); a pure Vite SPA doesn't need it. Session stored in `localStorage` by default. [CITED: https://github.com/orgs/supabase/discussions/28997]

```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)

// src/App.tsx (auth gate)
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { setAuthToken } from './lib/rpc'

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)  // undefined = loading

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthToken(session?.access_token ?? null)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setAuthToken(session?.access_token ?? null)
      if (!session) queryClient.clear()
    })

    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return null  // loading splash
  if (session === null) return <Login />
  return <Shell />
}
```

**getSession vs getUser:** `getSession()` reads from localStorage (no network). `getUser()` validates JWT with Supabase servers (network call). Use `getSession()` for startup; use `getUser()` only when you need to re-validate the JWT. [CITED: supabase.com/docs/reference/javascript/auth-getsession]

**Token refresh:** supabase-js handles refresh automatically on every `getSession()` call when the access token is near expiry. No manual polling for auth. [ASSUMED: behavior consistent across v2.x releases]

### Pattern 6: BSM Kernel Extraction (D-01)

**What:** Move `packages/core/src/journal/domain/bsm.ts` to a new `packages/quant` leaf package.

**Confirmed: zero-import.** The file has no imports — only TypeScript types and pure math. Relocation is mechanical. [VERIFIED: codebase read]

**Dependency arrows before:**
```
core → shared
web → contracts → shared
```

**Dependency arrows after:**
```
core → shared, quant    (core adds quant reference)
web  → contracts → shared, quant   (web adds quant reference)
quant → (nothing)       (pure leaf)
```

No arrow reversal. Hexagon stays intact. [VERIFIED: codebase dependency graph read]

**Steps (docs-before-code first):**
1. Update `docs/architecture/stack-decisions.md` — add D21 (quant leaf, BSM extraction) + fix D3 (Recharts → visx/uPlot/ECharts) per D-05.
2. Update `docs/architecture/monorepo-layout.md` — add `packages/quant/` to workspace graph and layout; add `core → quant` and `web → quant` edges.
3. Create `packages/quant/package.json`, `tsconfig.json`, `src/bsm.ts`, `src/index.ts`.
4. Add `"@morai/quant": "workspace:*"` to `packages/core/package.json` and `apps/web/package.json`.
5. Add `{ "path": "../quant" }` reference to `packages/core/tsconfig.json` and `apps/web/tsconfig.json`.
6. Update ESLint `eslint.config.js` boundary elements: add `{ type: "quant", pattern: "**/packages/quant/src/**", mode: "full" }` and add `"quant"` to the allow list for `core` and `apps` element types.
7. Update `packages/core/src/journal/domain/bsm.ts` to import from `@morai/quant` and re-export (or replace call sites in core).
8. Update call sites in `packages/core` that import `bsmPrice`/`bsmGreeks`/`bsmVega` from the local file.
9. Run `bun run typecheck && bun run lint` — must be green.
10. Add tests in `packages/quant` (parity tests vs original values, fast-check properties inherited from Phase 2 BSM tests).

**Call sites to update in core:** Search for `from.*bsm` imports in `packages/core/src/`:

```bash
rg "from.*bsm" packages/core/src/ --type ts
```

[ASSUMED: call sites likely in `journal/application/` and `brokerage/` use-cases; verify before planning tasks]

### Pattern 7: visx Area/Line Chart (Payoff + Profile)

```typescript
// Minimal visx payoff chart pattern
// Source: Airbnb visx v4 docs (verified via npm: @visx/shape@4.0.0)
import { AreaClosed, LinePath } from '@visx/shape'
import { LinearGradient } from '@visx/gradient'
import { scaleLinear } from '@visx/scale'
import { Group } from '@visx/group'
import { localPoint } from '@visx/event'

// SVG dimensions passed as props; use viewBox + preserveAspectRatio="none"
// for responsive layout matching the mockup's 1000×470 logical space
function PayoffChart({ width, height, data }: Props) {
  const xScale = scaleLinear({ domain: [6900, 7900], range: [0, width] })
  const yScale = scaleLinear({ domain: [yMin, yMax], range: [height, 0] })

  return (
    <svg width={width} height={height}>
      <defs>
        <LinearGradient id="above" from="#26a69a" to="#26a69a" fromOpacity={0.045} toOpacity={0} />
        <LinearGradient id="below" from="#ef5350" to="#ef5350" fromOpacity={0.045} toOpacity={0} />
      </defs>
      <Group>
        <AreaClosed data={todayCurveAboveZero} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)}
          yScale={yScale} fill="url(#above)" />
        <LinePath data={todayCurve} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)}
          stroke="#a78bfa" strokeWidth={2.6} />
        {/* spot vertical line, GEX walls, breakeven lines, crosshair */}
      </Group>
    </svg>
  )
}
```

[ASSUMED: visx v4 API is largely compatible with v3; the v4 release primarily adds React 19 support. API surface unchanged from prior releases. Confirm imports compile during Wave 0.]

### Pattern 8: uPlot Greek Strips

**Pattern:** Use `uplot-react` wrapper (`UplotReact`) to avoid recreating chart instances on re-render. Pass memoized `options` and `data` to prevent spurious redraws.

```typescript
// Source: github.com/skalinichev/uplot-wrappers
import UplotReact from 'uplot-react'
import 'uplot/dist/uPlot.min.css'
import { useMemo } from 'react'

function GreekStrip({ label, data, color }: Props) {
  const options = useMemo<uPlot.Options>(() => ({
    width: 220, height: 100,
    cursor: { sync: { key: 'greekStrips' } },  // sync crosshair across strips
    series: [
      {},  // x (spot)
      { stroke: color, width: 1.5 },
    ],
    axes: [{ show: false }, { show: false }],
    legend: { show: false },
  }), [color])

  return <UplotReact options={options} data={data} />
}
```

**Sync crosshair across 4 strips:** Use `cursor.sync.key` with the same string on all four uPlot instances. [ASSUMED: stable feature in uPlot 1.6.x; crosshair sync key pattern is documented in uPlot README]

**No SSR concern:** Pure Vite SPA — no SSR context. uPlot uses `window` directly but that's fine for client-only code.

### Pattern 9: ECharts (GEX bars + heatmap)

```typescript
// Source: github.com/hustcc/echarts-for-react (echarts-for-react@3.0.6, echarts@6.1.0)
import ReactECharts from 'echarts-for-react'

function GexByStrikeBars({ gexData }: Props) {
  const option = {
    backgroundColor: 'transparent',
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: gexData.map((d) => d.k.toString()) },
    series: [{
      type: 'bar',
      data: gexData.map((d) => ({
        value: d.gex,
        itemStyle: { color: d.gex >= 0 ? '#26a69a' : '#ef5350' },
      })),
    }],
  }
  return <ReactECharts option={option} style={{ height: 260 }} />
}
```

**Peer deps:** `echarts` must be installed alongside `echarts-for-react` (it's a peer dep). ECharts auto-resizes via a built-in ResizeObserver — no manual handling needed. [CITED: github.com/hustcc/echarts-for-react]

### Pattern 10: Vercel Deploy of apps/web

**vercel.json** (place in `apps/web/`, NOT monorepo root):
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**Vercel project settings:**
- **Root Directory:** `apps/web` (not monorepo root)
- **Build Command:** `bun run build` (runs `vite build`)
- **Output Directory:** `dist`
- **Install Command:** leave default (`bun install` from monorepo root)
- **Framework Preset:** Vite

**Environment variables** (set in Vercel dashboard):
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key (public)
- `VITE_API_BASE_URL` — Railway API URL (e.g., `https://morai-server.railway.app`)

**CORS:** Already handled by `apps/server` Phase 8 — `WEB_ORIGIN` env var on Railway must be set to the Vercel deployment URL after first deploy. [VERIFIED: codebase — `apps/server/src/main.ts` applies CORS with `config.WEB_ORIGIN`]

**VITE_ prefix requirement:** All env vars exposed to the browser must have the `VITE_` prefix — Vite strips them from the bundle otherwise. [CITED: vitejs.dev/config/#using-environment-variables-in-config]

[CITED: vercel.com/docs/frameworks/frontend/vite]
[CITED: vercel.com/docs/monorepos]

### Anti-Patterns to Avoid

- **Import `AppType` at runtime** (non-type import from server): bundles server code into the SPA. Always `import type { AppType }`.
- **Use `@supabase/ssr` in a Vite SPA**: adds cookie overhead unnecessary for localStorage-based sessions.
- **Reinstantiate `hc<AppType>()` per component**: creates a new client on every render. Create once in `lib/rpc.ts`.
- **Use `app.route()` statement style on the server**: breaks `AppType` chain inference. The existing server already uses the chained router pattern correctly (verified).
- **Put `VITE_*` secrets in vercel.json**: secrets belong in Vercel dashboard env vars, not in committed config.
- **Point `vercel.json` SPA rewrites at the monorepo root**: must be in `apps/web/vercel.json` when Root Directory is `apps/web`.
- **Skip docs-before-code for the quant leaf**: adding a new package without updating `monorepo-layout.md` and `eslint.config.js` first means the boundary rule blocks the import before docs are updated. Do docs first (D-01 explicitly requires it).
- **Hand-rolling the uPlot integration**: use `uplot-react` to avoid recreating the instance on each re-render. The UplotReact component keeps the chart alive across prop changes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry + backoff + window-focus refetch | Custom polling hook | TanStack Query v5 | Dedup, caching, background refetch, dev tools all included |
| Auth session storage + refresh | Custom localStorage JWT management | `supabase-js` `onAuthStateChange` | Token expiry, refresh, and PKCE flow handled automatically |
| Responsive SVG charts with crosshair | Raw SVG D3 code | visx (`@visx/shape`, `@visx/event`) | Scale, path gen, pointer events — each is a nasty edge-case zoo |
| uPlot lifecycle (init/resize/destroy) | `useEffect`/`useRef` init loop | `uplot-react` | ResizeObserver cleanup, instance recreation prevention, public API updates |
| ECharts lifecycle | `useEffect`/`useRef` manual | `echarts-for-react` | ResizeObserver, dispose on unmount, option merging — all handled |
| SPA deep link routing | Custom hash routing | React Router v7 + Vercel SPA rewrites | History API fallback, nested routes, programmatic navigation |
| Hono RPC type inference | OpenAPI codegen / manual types | `hc<AppType>()` | Zero codegen; types update automatically when server routes change |
| BSM pricing in browser | Copy-paste from server, or import core | `@morai/quant` leaf | One kernel = cross-screen P&L consistency; core boundary law prevents web → core |

**Key insight:** Every chart library in the locked stack already handles the hardest parts — event delegation, SVG viewport math, resize, animation. Custom implementations inevitably miss the edge cases that make trading charts feel wrong (e.g., uPlot's cursor sync key is non-trivial to hand-roll correctly across 4 strips).

---

## Runtime State Inventory

> Not applicable. This is a greenfield frontend phase. No rename/refactor/migration — `apps/web` does not exist yet. No existing stored data, live service config, OS-registered state, secrets, or build artifacts are at risk.

---

## Common Pitfalls

### Pitfall 1: AppType Import Pulls Server Runtime into Bundle

**What goes wrong:** `import { AppType } from '../../apps/server/src/main.ts'` (without `type`) bundles the entire server, including pg-boss, Drizzle, Hono server, and all adapters into the SPA bundle. Build fails or produces a multi-MB bundle with node-only modules.
**Why it happens:** TypeScript `import` without `type` keyword triggers bundling by Vite.
**How to avoid:** Always `import type { AppType }`. The `verbatimModuleSyntax: true` in `tsconfig.base.json` enforces type-only imports at compile time — a non-type import of a server-only module will fail the build.
**Warning signs:** Bundle size > 500KB for the initial chunk; build errors about `node:*` builtins.

### Pitfall 2: Tailwind v4 `@theme` vs `@theme inline` Confusion

**What goes wrong:** shadcn components reference `--background` (not `--color-background`). Without the `@theme inline` bridge, Tailwind's `bg-background` utility won't resolve because v4 requires `--color-*` prefixed names in `@theme`.
**Why it happens:** shadcn uses its own `--background`/`--card` convention; Tailwind v4 generates utilities from `--color-*`. The bridge is needed.
**How to avoid:** Use `@theme inline { --color-background: var(--background); ... }` to map shadcn variable names into Tailwind's utility-class namespace. The `index.css` Pattern 1 above shows the correct structure.
**Warning signs:** `bg-background` renders as transparent; card components have no background.

### Pitfall 3: shadcn `tailwindcss-animate` Breakage in v4

**What goes wrong:** `tailwindcss-animate` (often installed as a shadcn animation plugin) may conflict with Tailwind v4's new animation system. The `@plugin 'tailwindcss-animate'` directive may need to be removed or replaced.
**Why it happens:** Tailwind v4 ships with built-in animation utilities; the separate plugin conflicts.
**How to avoid:** Check after `npx shadcn@latest init` whether `tailwindcss-animate` is auto-added to `package.json`. If so, test animation-bearing components (Dialog, Skeleton shimmer) before committing. Replace with Tailwind v4 native `transition-*`/`animate-*` utilities if conflicts arise.
**Warning signs:** Dialog open/close animations stop working; Skeleton shimmer freezes.

### Pitfall 4: CORS Preflight Blocked Before First Vercel Deploy

**What goes wrong:** The Railway API's `WEB_ORIGIN` is set to a placeholder or old URL. Browser sends CORS preflight OPTIONS to Railway; Railway returns 400 (origin not matched); all API calls fail.
**Why it happens:** Phase 8 CORS requires exact origin match. The Vercel URL (`https://morai.vercel.app` or a preview URL) isn't known until the first Vercel deploy completes.
**How to avoid:** Deploy Vercel first (even a stub page), note the URL, then set `WEB_ORIGIN` on Railway. The thin-slice (D-02) naturally forces this in the right order. During development, use Vite `server.proxy` to forward `/api/*` to the Railway server (bypasses CORS entirely in dev).
**Warning signs:** All API calls return CORS errors in browser console with `Access-Control-Allow-Origin` missing.

### Pitfall 5: Missing VITE_ Prefix on Env Vars

**What goes wrong:** `import.meta.env.SUPABASE_URL` is `undefined` at runtime even though it's set in Vercel dashboard.
**Why it happens:** Vite only exposes env vars prefixed with `VITE_` to client code.
**How to avoid:** Name all env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`. Type them in a `vite-env.d.ts`:
```typescript
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_BASE_URL: string
}
```
**Warning signs:** `undefined is not a valid URL` on Supabase client init; 404 on all RPC calls.

### Pitfall 6: visx v4 React 19 Peer Dep Warning

**What goes wrong:** `bun add @visx/shape` prints a peer dependency warning about React version compatibility.
**Why it happens:** visx v4.0.0 released with React 19 support, but peer dep ranges may still list `^18 || ^19`. Bun may print warnings even if React 19 is installed.
**How to avoid:** Proceed past peer dep warnings for `@visx/*` — they are false positives if React 19 is installed. Do not downgrade React. [ASSUMED: based on npm publish date 2026-06-11 aligning with React 19 support milestone]
**Warning signs:** Warning only; not a build failure. If a hard peer dep error occurs, check the exact React version installed vs what @visx/* declares.

### Pitfall 7: TanStack Query Retry Delays on 401 Auth Failure

**What goes wrong:** A 401 from the API is retried 3× with backoff (9+ seconds of delay) before the error state displays. User sees a 9-second hang on the auth-expired banner.
**Why it happens:** Default TanStack Query retry behavior doesn't distinguish 401 from transient network errors.
**How to avoid:** In the `queryFn`, detect 401 explicitly and throw a non-retryable error:
```typescript
if (res.status === 401) {
  queryClient.clear()
  await supabase.auth.signOut()
  // navigate to login
  throw Object.assign(new Error('UNAUTHORIZED'), { status: 401 })
}
```
Or configure at QueryClient level: `retry: (count, err) => err.status !== 401 && count < 3`.
**Warning signs:** UI hangs 9+ seconds after session expires before showing the Login screen.

### Pitfall 8: uPlot CSS Missing Causes Invisible Charts

**What goes wrong:** Greek strips render as 0-height invisible elements.
**Why it happens:** uPlot requires its own CSS (`uplot/dist/uPlot.min.css`) for the chart container layout. Without it, the chart div has no height.
**How to avoid:** Import `'uplot/dist/uPlot.min.css'` in the component or in `index.css` (`@import 'uplot/dist/uPlot.min.css'`).
**Warning signs:** Strip panels are present in DOM but invisible; `height: 0`.

---

## Code Examples

### Auth Gate + Route Guard

```typescript
// src/App.tsx
function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthToken(session?.access_token ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setAuthToken(session?.access_token ?? null)
      if (!session) queryClient.clear()
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div style={{ background: '#0a0e14', minHeight: '100vh' }} />
  if (!session) return <Login supabase={supabase} />

  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  )
}
```

### AUTH_EXPIRED Banner

```typescript
// Driven by useStatus() polling GET /api/status every 30s
function AuthExpiredBanner() {
  const { data } = useStatus()
  if (data?.tokenFreshness !== 'AUTH_EXPIRED') return null

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: '#180f10', borderTop: '1px solid #5a2b2e', padding: '8px 16px',
    }}>
      <span style={{ color: '#ef5350', fontFamily: 'JetBrains Mono', fontSize: 12 }}>
        Schwab auth expired. Run <code style={{ background: '#3e1f23', padding: '1px 4px', borderRadius: 3 }}>auth setup</code> to reconnect. Data may be stale.
      </span>
    </div>
  )
}
// When banner is visible, Shell adds `paddingBottom: 38` to the page body.
```

### TOS Parser (port from playground-v3.html)

```typescript
// packages/quant/src/tos-parser.ts  OR  apps/web/src/lib/tos-parser.ts
// Source: mockups/playground-v3.html (reference implementation)
// 9 parse rules from UI-SPEC TOS Calendar Paste Parser Contract:
export type ParsedCalendar = {
  qty: number; type: 'C' | 'P'; strike: number; debit?: number
  frontDate: Date; backDate: Date; frontDTE: number; backDTE: number
  underlying: string; impliedIV: number
}

export function parseTosOrder(text: string, today: Date, spotPrice: number, riskFreeRate: number): ParsedCalendar | null {
  // Rule 1: BUY/SELL + qty
  // Rule 2: PUT/CALL
  // Rule 3: strike (last 3–5 digit number before PUT/CALL)
  // Rule 4: debit (after @)
  // Rule 5: two dates (day + 3-letter month + 2-digit year)
  // Rule 6: validate DTEs
  // Rule 7: underlying (after CALENDAR)
  // Rule 8: bisect to imply flat IV (uses bsmPrice from @morai/quant)
  // Rule 9: call/put both supported
  // Returns null on parse failure
  ...
}
```

The TOS parser is pure logic with no I/O — it belongs in `apps/web/src/lib/tos-parser.ts` (web-only) since it's an Analyzer UI concern. The IV bisection calls `bsmPrice` from `@morai/quant`. [VERIFIED: mockups/playground-v3.html contains the reference implementation]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Recharts (named in stack-decisions D3) | visx + uPlot + ECharts (locked in UI-SPEC) | Phase 9 decision | Must reconcile stack-decisions.md before chart code (D-05) |
| `tailwind.config.js` postcss flow | `@tailwindcss/vite` plugin + CSS `@theme` | Tailwind v4 (early 2025) | No config.js; no postcss; single Vite plugin |
| `@supabase/auth-helpers-*` | `@supabase/supabase-js` v2 (for SPAs) or `@supabase/ssr` (for SSR) | Supabase 2023 migration | auth-helpers deprecated; use supabase-js directly for Vite SPA |
| HSL CSS variables in shadcn | OKLCH in Tailwind v4 projects | Tailwind v4 | CSS vars declared with `@theme`; OKLCH colors preferred |
| visx v3 (React 18 only) | visx v4.0.0 (React 19 support) | June 2026 | Use v4 with React 19; peer dep warnings are false positives |

**Deprecated/outdated:**
- `tailwind.config.js`: Not supported by default in v4. Tailwind v4 requires CSS-first configuration.
- `@tailwindcss/postcss`: Replaced by `@tailwindcss/vite` for Vite projects.
- `react-query` (package name): Replaced by `@tanstack/react-query` (same library, renamed).
- `@supabase/auth-helpers-react`: Deprecated; use `@supabase/supabase-js` or `@supabase/ssr`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@supabase/supabase-js createClient()` is the right choice for a Vite SPA (not `@supabase/ssr`) | Standard Stack, Pattern 5 | Low risk — createBrowserClient from @supabase/ssr is functionally identical for SPA use; both work |
| A2 | visx v4.0.0 API is backward-compatible with v3 for the patterns used (LinePath, AreaClosed, LinearGradient, localPoint) | Pattern 7 | Low — visx v4 primarily adds React 19 compat; core chart APIs unchanged. Confirm on first `bun add @visx/shape` |
| A3 | visx v4 peer dep warning with React 19 is a false positive and does not block builds | Package Legitimacy, Pitfall 6 | Medium — if it's a hard error (not warning), may need `bun add --force` or explicit overrides |
| A4 | `import type { AppType }` cross-app works in Bun workspace + Vite without bundling server runtime | Pattern 3 | Medium — `verbatimModuleSyntax` in tsconfig should enforce this; test during Wave 0 thin-slice |
| A5 | shadcn `npx shadcn@latest init` prompts allow dark theme + CSS variables configuration compatible with the Morai palette | Pattern 2 | Low — shadcn's dark theme scaffold creates the right `:root` variables; we override values post-init |
| A6 | Vite dev proxy (`server.proxy`) can forward `/api/*` to Railway API to bypass CORS in development | Pitfall 4 | Low — standard Vite feature; confirm baseURL env handling during dev vs prod |
| A7 | BSM call sites in `packages/core` import from the local file path (not an alias); `rg "from.*bsm"` will find them all | Pattern 6 | Low — worst case is a missed call site → typecheck error during extraction |
| A8 | `uplot-react` v1.2.4 cursor sync key pattern works for 4-panel greek strips | Pattern 8 | Low — crosshair sync is a documented uPlot feature; react wrapper passes options through |
| A9 | Tailwind `@theme inline` bridge correctly maps shadcn `--background`/`--card`/`--border` to utility classes | Pattern 1 | Medium — exact `@theme inline` syntax may differ from what shadcn generates; reconcile after `npx shadcn init` |
| A10 | TOS parser IV bisection in `apps/web/src/lib/tos-parser.ts` can import from `@morai/quant` (same workspace) | Pattern for TOS parser | Low — web imports quant per the new dependency edge in D-01 |

---

## Open Questions

1. **POSITIONS-01: Does `GET /api/positions` return computed BSM greeks or raw broker positions?**
   - What we know: Phase 8 CONTEXT.md listed this as an open gap. The `positionsResponse` contract in `packages/contracts/src/brokerage.ts` returns raw broker positions (no computed greeks fields).
   - What's unclear: Whether Phase 8 added a read-through BSM layer or punted.
   - Recommendation: Confirm by reading `packages/contracts/src/brokerage.ts` and the Phase 8 PLAN.md files before building the Positions screen. If greeks are missing, the frontend needs a thin client-side computation layer using `@morai/quant` and the positions data — handle in the Positions screen hook.

2. **Hono route method names on the typed client: what are the exact route paths?**
   - What we know: The chained `apiRouter` in `apps/server/src/main.ts` is already built. The routes are in `status.routes.ts`, `gex.routes.ts`, etc.
   - What's unclear: Exact method chaining on the client (e.g., `rpc.api.status.$get()` vs `rpc.api['status'].$get()`).
   - Recommendation: Read `apps/server/src/adapters/http/*.routes.ts` before writing hooks. The Hono `app-type.assert.ts` already confirms `hc<AppType>()` compiles — use it as a working example.

3. **React Router vs built-in `location`/`history` for screen navigation?**
   - What we know: No router is currently in the project. The 5 screens need navigation. The UI-SPEC links Overview "open analyzer →" to the Analyzer with a position pre-selected.
   - What's unclear: Whether to add React Router v7 or use a simpler `useState`-based screen switcher.
   - Recommendation: React Router v6/v7 for proper deep-linking (History API) + Vercel SPA rewrites support. A `useState` switcher is simpler but doesn't support direct URL navigation or browser back. Given that Vercel deploys want deep-linking, React Router is the correct choice. [ASSUMED]

4. **Vite dev proxy config: can the dev server forward `/api/*` to the Railway API?**
   - What we know: Vite supports `server.proxy` in `vite.config.ts`. The Railway API URL is `VITE_API_BASE_URL`.
   - Recommendation: Add `server: { proxy: { '/api': { target: process.env.VITE_API_BASE_URL, changeOrigin: true } } }` to `vite.config.ts`. Use `'/api'` as base URL in dev (not the full Railway URL) to avoid CORS during development.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Build + install | ✓ | 1.3.13 | — |
| Node.js | Vite build process | ✓ | v26.3.1 | — |
| npm | Package registry queries | ✓ | 11.16.0 | — |
| vercel CLI | Deployment | ✓ | installed | — |
| Railway API (remote) | All API calls | ✓ (from Phase 8) | — | — |
| Supabase Auth (remote) | Auth gate | ✓ (from Phase 8) | — | — |
| Docker | testcontainers (if BSM tests use postgres) | [ASSUMED: available] | — | quant tests are pure; no DB needed |

**Missing dependencies with no fallback:** none — all required tools are installed.

**Note:** Google Fonts (Space Grotesk + JetBrains Mono) loaded via `<link>` in `index.html`. No fallback needed — UI-SPEC mandates these fonts; degraded appearance if fonts fail to load is acceptable.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (workspace-wide; apps/web will add `apps/web/vitest.config.ts`) |
| Config file | `apps/web/vitest.config.ts` (Wave 0 gap — must create) |
| Quick run command | `vitest run --project apps/web` |
| Full suite command | `bun run test` (workspace root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | React SPA renders on Vercel | smoke / manual | Vercel preview URL check | ❌ Wave 0 |
| UI-01 | Hono RPC client infers types from AppType | typecheck | `bun run typecheck` | ❌ Wave 0 (apps/web/tsconfig.json) |
| UI-01 | TOS parser: 9 rules + IV bisection | unit | `vitest run --project apps/web -t "parseTosOrder"` | ❌ Wave 0 |
| UI-01 | BSM kernel parity (core ↔ quant leaf) | unit + fast-check | `vitest run --project packages/quant` | ❌ Wave 0 |
| UI-01 | TOS parser round-trip: parse → BSM price ≈ debit | property | fast-check in tos-parser.test.ts | ❌ Wave 0 |
| UI-02 | AUTH_EXPIRED banner shown on tokenFreshness: 'AUTH_EXPIRED' | unit (component) | `vitest run -t "AuthExpiredBanner"` | ❌ Wave 0 |
| UI-02 | Banner hidden when tokenFreshness is not AUTH_EXPIRED | unit (component) | same file | ❌ Wave 0 |
| — | 401 from API clears query cache and redirects to Login | unit (hook) | mock hono client returning 401 | ❌ Wave 0 |
| — | Auth gate: shows Login when no session; shows Shell when session present | unit (component) | `vitest run -t "App auth gate"` | ❌ Wave 0 |

**What NOT to test in this phase:**
- Pixel-perfect chart rendering — snapshot tests are brittle for SVG charts; the UI-SPEC is the source of truth
- Vercel deploy success — manual smoke test on preview URL
- All five screens' visual layout — covered by manual review against mockups
- ECharts internal rendering — third-party; test only option shape, not canvas output

### Sampling Rate

- **Per task commit:** `bun run typecheck && vitest run --project packages/quant --project apps/web` (quant parity + web unit tests)
- **Per wave merge:** `bun run test && bun run typecheck && bun run lint`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/web/vitest.config.ts` — needed for web-specific test config (jsdom environment, react plugin)
- [ ] `apps/web/src/lib/tos-parser.test.ts` — 9-rule parser + IV bisection property tests
- [ ] `packages/quant/src/bsm.test.ts` — parity tests (quant leaf output === original core bsm.ts output for same inputs), fast-check round-trips
- [ ] `apps/web/src/components/AuthExpiredBanner.test.tsx` — render/hide behavior
- [ ] `apps/web/src/App.test.tsx` — auth gate show/hide
- [ ] React test setup: `bun add -d @testing-library/react @testing-library/user-event jsdom vitest-environment-jsdom` in `apps/web`

---

## Security Domain

**`security_enforcement` is enabled** (not explicitly disabled in config).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth JWT (already gated server-side in Phase 8); client must not persist JWT in insecure storage |
| V3 Session Management | yes | `@supabase/supabase-js` handles localStorage session; `onAuthStateChange` clears on SIGNED_OUT |
| V4 Access Control | partial | Server enforces auth; client-side gating is defense-in-depth only (single-user) |
| V5 Input Validation | yes | TOS parser input is sanitized in pure TS (no DOM injection risk); zod validates all API responses |
| V6 Cryptography | no | JWT validation is server-side only (Phase 8); browser never verifies JWT signature |

### Known Threat Patterns for SPA + Supabase Auth

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| JWT in localStorage (XSS accessible) | Information Disclosure | `VITE_SUPABASE_ANON_KEY` is public; the JWT expires (short-lived); Supabase Auth tokens are not long-lived secrets. Acceptable risk for single-user internal tool. |
| CORS wildcard | Elevation of Privilege | Already mitigated: Railway API uses exact `WEB_ORIGIN` (Phase 8 D20). |
| Exposed env vars in Vite bundle | Information Disclosure | `VITE_SUPABASE_ANON_KEY` is intentionally public (anon key has RLS-governed permissions). `VITE_API_BASE_URL` is public. No secrets in `VITE_*` vars. |
| XSS via TOS paste input | Tampering | TOS parser operates on a plain string; it never writes to the DOM. Parsed output renders via React (JSX escaping). |
| Auth token sent to Railway over HTTP | Spoofing | `VITE_API_BASE_URL` must be `https://`. Never `http://`. |

---

## Project Constraints (from CLAUDE.md)

The following directives from `CLAUDE.md` and `.claude/rules/` apply to this phase:

1. **Dependency law (architecture-boundaries.md):** `web → contracts → shared`; `web → quant` (new, after D-01). `web` MUST NOT import `core`, `adapters`, or any app server runtime code. The `import type { AppType }` pattern is the sole exception (type-only, no runtime coupling).
2. **TDD red→green (tdd.md):** No production code without a failing test first. Exempt: pure wiring in `main.tsx`, composition root, static config, styling-only changes. Required for: TOS parser, BSM quant leaf, auth gate components, hook behavior.
3. **No `any`/`as`/`!` (typescript.md):** Parse API responses through Zod contracts from `@morai/contracts`. No type assertions. TanStack Query generic `useQuery<ZodInferred<typeof schema>>` types the response.
4. **Docs before architecture changes (workflow.md):** D-01 (quant leaf) and D-05 (Recharts → visx/uPlot/ECharts) require `docs/architecture/stack-decisions.md` and `docs/architecture/monorepo-layout.md` updates BEFORE any code moves.
5. **Minimal impact (workflow.md):** Phase 9 does not touch Phase 8 code except to confirm `POSITIONS-01`. If positions endpoint needs BSM greeks added, that is a backend addition — tracked separately.
6. **No `console.log` (typescript.md):** Only `console.warn`/`console.error` permitted.
7. **ESLint boundary enforcement:** The `eslint.config.js` boundary rule must be updated to include `packages/quant` as a new element type before the quant leaf is created. The `eslint.config.js` project references must also include `apps/web/tsconfig.json` for lint to work on web files.

---

## Sources

### Primary (MEDIUM confidence)

- `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/apps/server/src/main.ts` — AppType export pattern, auth middleware, chained router
- `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/packages/core/src/journal/domain/bsm.ts` — confirmed zero-import BSM kernel
- `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/packages/contracts/src/gex.ts` — GEX contract shape (Phase 8 delivered)
- `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/eslint.config.js` — boundary rule structure for quant leaf update
- `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/tsconfig.base.json` — `verbatimModuleSyntax: true` (enforces type-only imports)

### Secondary (LOW confidence — web search only)

- [tailwindcss.com/blog/tailwindcss-v4](https://tailwindcss.com/blog/tailwindcss-v4) — `@tailwindcss/vite` plugin setup, `@theme` CSS block
- [ui.shadcn.com/docs/tailwind-v4](https://ui.shadcn.com/docs/tailwind-v4) — shadcn + Tailwind v4 compatibility, `@theme inline` bridge
- [ui.shadcn.com/docs/installation/vite](https://ui.shadcn.com/docs/installation/vite) — `npx shadcn@latest init -t vite` command
- [hono.dev/docs/guides/rpc](https://hono.dev/docs/guides/rpc) — `hc<AppType>()` header config, type-only import, monorepo considerations
- [tanstack.com/query/v5/docs/framework/react/guides/important-defaults](https://tanstack.com/query/v5/docs/framework/react/guides/important-defaults) — retry defaults, `refetchInterval`, `refetchOnWindowFocus`
- [github.com/orgs/supabase/discussions/28997](https://github.com/orgs/supabase/discussions/28997) — `supabase-js` vs `@supabase/ssr` in Vite SPA
- [vercel.com/docs/frameworks/frontend/vite](https://vercel.com/docs/frameworks/frontend/vite) — SPA rewrites, VITE_ env var requirement, output dir
- [vercel.com/docs/monorepos](https://vercel.com/docs/monorepos) — Root Directory `apps/web`, Bun workspace support
- [github.com/skalinichev/uplot-wrappers](https://github.com/skalinichev/uplot-wrappers) — `UplotReact` minimal pattern, options/data memoization
- [github.com/hustcc/echarts-for-react](https://github.com/hustcc/echarts-for-react) — `ReactECharts` component pattern, peer deps

---

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — npm versions verified; library APIs based on web search + official docs
- Architecture: HIGH — dependency graph verified from codebase; AppType export verified from source
- Pitfalls: MEDIUM — drawn from established patterns; some `[ASSUMED]` flags remain for exact CLI behavior
- BSM kernel extraction: HIGH — zero-import status verified; dependency arrows verified from codebase and eslint config

**Research date:** 2026-06-24
**Valid until:** 2026-07-08 (14 days — Tailwind v4, shadcn, and TanStack move fast; re-verify exact init commands if planning is delayed)
