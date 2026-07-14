---
phase: 41
slug: analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 41 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Pure `apps/web`
> frontend restructure — no new framework, no backend surface. Vitest + @testing-library/react
> are already wired for every file this phase touches.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace `vitest run`) + @testing-library/react |
| **Config file** | `apps/web/vitest.config.ts` (existing) |
| **Quick run command** | `bun run test apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/analyzer-mobile apps/web/src/components/picker/TermStructureChart.test.tsx` |
| **Full suite command** | `bun run test` (root workspace — the phase-gate command) |
| **Estimated runtime** | ~30–60 seconds (scoped); full suite longer |

---

## Sampling Rate

- **After every task commit:** Run the scoped command for the touched file(s) (per `tdd.md` red→green).
- **After every plan wave:** Run `bun run test apps/web/src` (the whole web workspace — this phase
  touches shared cross-file state, `useAnalyzerModel.ts` consumed by BOTH trees, so a scoped run risks
  missing a mobile regression from a desktop-only change).
- **Before `/gsd-verify-work`:** Full `bun run test` (root) green + `bun run typecheck` (root AND
  apps/web tsc, catch #29) + `bun run lint`.
- **Max feedback latency:** ~60 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 41-01-01 | 01 | 1 | AUI-07 | T-41-01 / T-41-03 | live spot only when status==="live" && liveSpot!==null; score path snapshot-only | unit (renderHook) | `bun run test apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts` | ❌ W0 (new file) | ⬜ pending |
| 41-01-02 | 01 | 1 | AUI-07, AUI-06 | T-41-01 | LiveStatusBadge reflects stream status on both trees | unit (RTL) | `bun run test apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx` | ✅ extend (+ useLiveStream mock W0) | ⬜ pending |
| 41-02-01 | 02 | 2 | AUI-01, AUI-03 | T-41-02 | name escaped in cells/aria-label; sort is client-only | unit (RTL) | `bun run test apps/web/src/screens/Analyzer.test.tsx -t "rail"` | ❌ W0 (rewrite rail blocks) | ⬜ pending |
| 41-02-02 | 02 | 2 | AUI-01 | T-41-02 | table exercised, no retired card false-green | unit (RTL) | `bun run test apps/web/src/screens/Analyzer.test.tsx` | ❌ W0 (migrate card-click blocks) | ⬜ pending |
| 41-03-01 | 03 | 3 | AUI-02 | T-41-04 | verdict word from scoreStatus only, GROUP_OF membership | unit (pure) | `bun run test apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts` | ✅ extend | ⬜ pending |
| 41-03-02 | 03 | 3 | AUI-02 | T-41-03 | hero snapshot-only (no spot); not-scored gate holds | unit (RTL) | `bun run test apps/web/src/screens/Analyzer.test.tsx` | ❌ W0 (migrate scoring blocks) | ⬜ pending |
| 41-03-03 | 03 | 3 | AUI-02, AUI-06 | T-41-04 | mobile grouping mirrors desktop membership | unit (RTL) | `bun run test apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx` | ✅ extend | ⬜ pending |
| 41-04-01 | 04 | 4 | AUI-04, AUI-06 | T-41-05 / T-41-06 | display-only rounding; no exact-value helper reused | unit (RTL) | `bun run test apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx` | ✅ extend | ⬜ pending |
| 41-04-02 | 04 | 4 | AUI-05 | — | chart H=320, leg r=7, event labels | unit (RTL) | `bun run test apps/web/src/components/picker/TermStructureChart.test.tsx` | ✅ extend | ⬜ pending |
| 41-04-03 | 04 | 4 | AUI-05 | — | paste input size (styling-only exemption) | unit (regression) | `bun run test apps/web/src/screens/Analyzer.test.tsx -t "pasted calendars"` | ✅ existing stays green | ⬜ pending |
| 41-05-01 | 05 | 5 | AUI-01..07 | T-41-07 / T-41-08 | full gate; exactAbs gone; dual typecheck | suite+grep | `bun run test && bun run typecheck && bun run lint` | ✅ existing | ⬜ pending |
| 41-05-02 | 05 | 5 | AUI-01..07 | — | desktop detail unchanged; visual approval | manual/UAT | see Manual-Only Verifications | ✅ script authored | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts` — NEW file: the LIVE-04 spot-seam
      suite (mirrors `useOverviewModel.test.ts`, incl. the catch #26 stale-spot case) + GROUP_OF/
      verdictWord pure tests. Created in 41-01-01, extended in 41-03-01.
- [ ] `apps/web/src/screens/Analyzer.test.tsx` — add a `useLiveStream` `vi.mock` block (green-suite
      protection: the hook now opens a stream) BEFORE any behavior work; then a full rewrite of the
      rail (`candidate-card-*`) + scoring (`scoring-pills`/`scoring-checklist`/`checklist-theta`) +
      card-click-selection describe blocks against the new table/hero DOM (41-01/02/03).
- [ ] `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx` — add the same `useLiveStream`
      mock; assert the mobile chart-block LiveStatusBadge (41-01).
- [ ] No new test framework/config needed — Vitest + RTL already wired for this file tree.

*The Wave 0 test-migration is a first-class task, NOT a side-effect: the retired-testid rewrites live
in the SAME plan that retires the DOM (41-02 table, 41-03 hero) so the suite never goes false-green.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Table Panel caps at 70vh with a sticky `<thead>`; no dead columns; content-driven page height | AUI-03 | CSS layout (`sticky`, `max-h`, scroll) is not observable through jsdom's layout-less DOM | 41-UAT.md desktop step: scroll the candidate table at ≥1280px — header stays pinned, center/right panels stay put, page isn't 3,000px+ tall |
| Term-structure chart reads clearer (taller, prominent leg markers, event labels tracing to legend chips) | AUI-05 | Visual clarity is a human judgment, not an assertion | 41-UAT.md desktop step: open a candidate, confirm short/long markers + on-curve event labels |
| Row click → detail swap is instant/obvious; numbers read at trading precision; live badge honest | AUI-01, AUI-04, AUI-07 | End-to-end perceptual UX on the live site | 41-UAT.md desktop + mobile + live scripts on morai.wtf (user or standing chrome-devtools permission) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (manual-only rows justified above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (new useAnalyzerModel.test.ts + useLiveStream mocks + rewrites)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
