---
phase: 9
slug: web-dashboard-frontend-react-spa-on-hono-rpc
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `09-RESEARCH.md` → ## Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace-wide; `apps/web` adds its own config) |
| **Config file** | `apps/web/vitest.config.ts` (Wave 0 — must create, jsdom env + react plugin) |
| **Quick run command** | `bun run typecheck && vitest run --project packages/quant --project apps/web` |
| **Full suite command** | `bun run test && bun run typecheck && bun run lint` |
| **Estimated runtime** | ~30–60 seconds (quick); full suite per existing workspace timings |

---

## Sampling Rate

- **After every task commit:** Run `bun run typecheck && vitest run --project packages/quant --project apps/web` (quant parity + web unit)
- **After every plan wave:** Run `bun run test && bun run typecheck && bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

> Populated by the planner / Nyquist auditor once tasks exist. Behavior→test rows below
> are lifted from RESEARCH.md's Requirements→Test Map and bind to UI-01/UI-02.

| Behavior | Requirement | Test Type | Automated Command | File Exists | Status |
|----------|-------------|-----------|-------------------|-------------|--------|
| BSM kernel parity (core ↔ `quant` leaf, same inputs → identical output) | UI-01 | unit + fast-check | `vitest run --project packages/quant` | ❌ W0 | ⬜ pending |
| TOS parser: 9 rules + implied-IV bisection | UI-01 | unit | `vitest run --project apps/web -t "parseTosOrder"` | ❌ W0 | ⬜ pending |
| TOS parser round-trip: parse → BSM price ≈ debit | UI-01 | property (fast-check) | `vitest run --project apps/web -t "parseTosOrder"` | ❌ W0 | ⬜ pending |
| Hono RPC client infers types from `AppType` | UI-01 | typecheck | `bun run typecheck` | ❌ W0 | ⬜ pending |
| AUTH_EXPIRED banner shows on `tokenFreshness: "AUTH_EXPIRED"` | UI-02 | unit (component) | `vitest run --project apps/web -t "AuthExpiredBanner"` | ❌ W0 | ⬜ pending |
| Banner hidden when `tokenFreshness` not AUTH_EXPIRED | UI-02 | unit (component) | `vitest run --project apps/web -t "AuthExpiredBanner"` | ❌ W0 | ⬜ pending |
| 401 from API clears query cache → redirect to Login | UI-02 | unit (hook) | `vitest run --project apps/web -t "auth gate"` | ❌ W0 | ⬜ pending |
| Auth gate: Login when no session, Shell when session present | UI-01 | unit (component) | `vitest run --project apps/web -t "App auth gate"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> **No separate pre-phase Wave 0.** This phase has no standalone Wave-0 plan — the test
> infrastructure is created **in-phase, RED-first**, as the leading tasks of the early TDD
> plans, and gates everything downstream via `depends_on`:
> - `packages/quant` parity tests + fast-check → **Plan 09-02** (Wave 2, RED before the kernel move)
> - `apps/web/vitest.config.ts` (jsdom + react) + RTL/jsdom dev deps → **Plan 09-03** (Wave 3 scaffold)
> - `AuthExpiredBanner` + auth-gate component tests → **Plan 09-04** (Wave 4, RED-first)
> - TOS-parser + IV-bisection tests → **Plan 09-09** (Wave 7, RED-first)
>
> `wave_0_complete: true` reflects that every item below is owned by a specific plan task; the
> files materialize when those plans execute. No screen/chart task runs before its test infra.

- [ ] `apps/web/vitest.config.ts` — jsdom environment + react plugin
- [ ] React test setup: `@testing-library/react`, `@testing-library/user-event`, `jsdom` (dev deps in `apps/web`)
- [ ] `packages/quant/src/bsm.test.ts` — parity vs original `core` bsm.ts + fast-check round-trips
- [ ] `apps/web/src/lib/tos-parser.test.ts` — 9-rule parser + IV-bisection property tests
- [ ] `apps/web/src/components/AuthExpiredBanner.test.tsx` — render/hide behavior
- [ ] `apps/web/src/App.test.tsx` — auth gate show/hide

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| React SPA builds + renders on Vercel | UI-01 | Deploy-time smoke; not unit-testable | Open Vercel preview URL, confirm all five screens render |
| Five screens match the LOCKED UI-SPEC visuals | UI-01 | SVG/canvas pixel snapshots are brittle; UI-SPEC is source of truth | Visual review each screen against `mockups/*.html` + 09-UI-SPEC.md |
| Chart rendering (visx/uPlot/ECharts) | UI-01 | Third-party canvas/SVG output; test option/data shape, not pixels | Manual check payoff/greek-strips/GEX bars render with correct data |

*Pixel-perfect chart rendering, Vercel deploy success, and ECharts internal rendering are explicitly NOT auto-tested (per RESEARCH.md "What NOT to test").*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (each owned by a plan task — see Wave 0 Requirements note)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24
