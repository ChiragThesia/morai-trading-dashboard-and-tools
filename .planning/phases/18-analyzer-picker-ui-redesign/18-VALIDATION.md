---
phase: 18
slug: analyzer-picker-ui-redesign
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-04
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `18-RESEARCH.md` §Validation Architecture. Task IDs are filled by the planner;
> each row's Requirement + Test Type + Command is the fixed contract the plans must satisfy.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 (root `vitest.config.ts`, `test.projects` glob over `packages/*/vitest.config.ts` + `apps/*/vitest.config.ts`) — already installed |
| **Config file** | `packages/contracts/vitest.config.ts` (contract + fixture tests); `apps/web/vitest.config.ts` (adapter + component tests) |
| **Quick run command** | `bunx vitest run packages/contracts/src/picker.test.ts` (contract) · `bunx vitest run apps/web/src/lib/candidate-to-position.test.ts` (adapter) |
| **Full suite command** | `bun run test` (root — runs every project) + `bun run typecheck` + `bun run lint` |
| **Estimated runtime** | ~30–60 seconds full suite |

`fast-check` is already installed and used (1000-run property test in `scenario-engine.test.ts`) — property tests need no new infra.

---

## Sampling Rate

- **After every task commit:** Run the specific new/changed test file's quick command above.
- **After every plan wave:** Run `bun run test` (full suite) + `bun run typecheck` + `bun run lint`.
- **Before `/gsd-verify-work`:** Full suite green, PLUS a manual diff check that `Overview.tsx`'s
  existing `PayoffChart`/`repriceScenario` call sites are untouched (additive props default to
  absent — a non-empty `Overview.tsx` diff beyond stale-comment cleanup is a regression signal).
- **Max feedback latency:** ~60 seconds.

---

## Per-Task Verification Map

Task IDs assigned by the planner; each requirement's Test Type + Command below is the fixed
validation contract every covering plan must honor.

| Task (planner-assigned) | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| picker contract | 1 | ANLZ-01 | Zod `.parse()` (not silently-ignored `.safeParse`) is the V5 input-validation boundary for fixture + Phase-19 API | unit (oracle-payload, mirrors `gex.test.ts`) | `bunx vitest run packages/contracts/src/picker.test.ts` | ❌ W0 | ⬜ pending |
| frozen fixture | 1 | ANLZ-01 | Malformed/incomplete fixture fails at parse time, never reaches render | unit (fixture parses against schema; guard-case present) | `bunx vitest run packages/contracts/src/picker.test.ts` | ❌ W0 | ⬜ pending |
| candidate→position adapter | 1 | ANLZ-02 | `live: false` on every candidate-derived position (D-02b hypothetical/view-only) | unit + fast-check property (numRuns ≥ 100): expiration-curve worst case ≤ `debit` (debit=max-loss invariant) | `bunx vitest run apps/web/src/lib/candidate-to-position.test.ts` | ❌ W0 | ⬜ pending |
| PayoffChart compareCurve/EM band | 2 | ANLZ-02 | Additive props absent ⇒ zero `Overview.tsx` render change | component: dashed amber single line when supplied, nothing extra when `null`; EM ticks at `spot±em` at zero-P&L y, z-order never occludes curves | `bunx vitest run apps/web/src/components/charts/PayoffChart.test.tsx` | ❌ W0 (additions to existing file) | ⬜ pending |
| Picker screen — cards + breakdown bars | 2 | ANLZ-01 | Guard-case (`fwdIv: null`) renders `n/a`, zero-width bar, no throw/NaN | component (`@testing-library/react`): bars render from `candidate.breakdown` filtered by `criterion` name, never a hard-coded index | `bunx vitest run apps/web/src/screens/Analyzer.test.tsx` | ❌ W0 (full rewrite) | ⬜ pending |
| Picker screen — why-panel + plan card | 2 | ANLZ-03 | Guard-case why-panel shows guard sentence, no fabricated bracket | component + unit: forward-edge sentence branches on `fwdEdge > 0` vs guard; plan card computes `debit × profitTargetPct`/`debit × stopPct`, formats `manageShortDte`/`closeByExpiry` | `bunx vitest run apps/web/src/screens/Analyzer.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/contracts/src/picker.ts` + `picker.test.ts` — schema does not exist yet (D-01).
- [ ] `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` — frozen fixture does not
      exist yet; needs 6–8 real candidates + 1 guard-case candidate (D-03/D-03a).
- [ ] `apps/web/src/lib/candidate-to-position.ts` + `.test.ts` — the adapter does not exist yet;
      this is the genuinely untested numerical surface this phase introduces (Pitfall 1). NOTE:
      RESEARCH corrects CONTEXT — `repriceScenario` **is** already covered by
      `scenario-engine.test.ts`; the new adapter is the real gap.
- [ ] `apps/web/src/components/charts/PayoffChart.test.tsx` — new cases for
      `compareCurve`/`expectedMoveBand`; existing file/framework/conventions otherwise sufficient.
- [ ] `apps/web/src/screens/Analyzer.test.tsx` — full rewrite (all existing blocks assert retired
      position-analyzer behavior being deleted under D-04).

*Existing Vitest + fast-check + @testing-library/react infrastructure covers all phase test types — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Shipped picker reads like `mockups/playground-v4.html` variant B (3-column layout, card anatomy, colors) | ANLZ-01/02/03 | Pixel/visual fidelity to the approved mockup is not unit-assertable | Run `bun run dev`, open `/analyzer`, compare against `mockups/playground-v4.html` side-by-side |
| `Overview.tsx` `PayoffChart`/`repriceScenario` call sites unchanged after additive prop extension | ANLZ-02 | Cross-screen no-regression is a diff review, not a test | `git diff apps/web/src/screens/Overview.tsx` shows no behavioral change |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
