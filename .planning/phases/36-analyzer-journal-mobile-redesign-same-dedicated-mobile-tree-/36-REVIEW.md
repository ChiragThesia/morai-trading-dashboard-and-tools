---
phase: 36-analyzer-journal-mobile-redesign-same-dedicated-mobile-tree
reviewed: 2026-07-11T16:50:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - apps/web/src/components/charts/MobileChartControls.tsx
  - apps/web/src/screens/Analyzer.test.tsx
  - apps/web/src/screens/Analyzer.tsx
  - apps/web/src/screens/Journal.test.tsx
  - apps/web/src/screens/Journal.tsx
  - apps/web/src/screens/JournalContainer.test.tsx
  - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx
  - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx
  - apps/web/src/screens/analyzer-mobile/MobileAnalyzerChart.tsx
  - apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx
  - apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx
  - apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts
  - apps/web/src/screens/journal-mobile/JournalMobile.test.tsx
  - apps/web/src/screens/journal-mobile/JournalMobile.tsx
  - apps/web/src/screens/journal-mobile/MobileLifecycle.tsx
  - apps/web/src/screens/journal-mobile/TradeCard.test.tsx
  - apps/web/src/screens/journal-mobile/TradeCard.tsx
  - apps/web/src/screens/journal-mobile/useJournalModel.tsx
  - apps/web/src/screens/overview-mobile/MobileRiskPanel.tsx
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 36: Code Review Report

**Reviewed:** 2026-07-11T16:50:00Z
**Depth:** standard
**Files Reviewed:** 19 (commits `8837f17^..eb3a44f`, app source only)
**Status:** issues_found

## Summary

Adversarial review of the Analyzer + Journal mobile-tree redesign against the 36-UI-SPEC
contract and the prior repo catch classes (#20 scroll/transform coordinates, #22 UTC
date math, #23 verdict-gating, #24 CSS reveals, #25 fallback-priced renders). Evidence
gathered:

- **Model extractions are verbatim.** `useAnalyzerModel` and `useJournalModel` were
  diffed line-by-line against the pre-extraction inline bodies in `Analyzer.tsx` /
  `Journal.tsx` at `8837f17^`: identical state, identical callback deps, identical memo
  deps — no stale closures, no effect-dep drift, hooks unconditional (both trees call
  the model before any early return).
- **`MobileChartControls` extraction is byte-identical** to the pre-extraction
  `MobileRiskPanel` control row + both dialogs (full-text compare against the
  `8837f17^` source, including `QUICK_JUMPS`, `DIALOG_TITLE_CLASS`, all classes,
  testids, aria-labels, and the catch-#22 local-date math). `MobileRiskPanel.test.tsx`
  has zero edits in the range and passes — Overview's phone-checked chart row is
  preserved.
- **D-17 cleanup is layout-equivalent at ≥1024px.** Analyzer: `contents lg:grid …` →
  plain `grid …`, `order-*`+`lg:order-none` → no order class (both resolve to
  `order:0`), the `-mx-3 lg:mx-0` bleed div (mx-0 = plain block at lg) removed —
  `PayoffChart`'s root is a `width:100%` block, so a direct mount in the block-level
  `Panel` is identical. Journal: `flex flex-col … lg:grid …` → plain grid with the same
  lg-resolved classes. Nothing desktop needed was deleted; the only remaining
  `analyzer-payoff-chart-bleed` reference is the intentional `toBeNull()` assertion.
- **840px pan mount:** `useLayoutEffect` deps `[trade.id, showChart]` are correct —
  fires on mount, on chart first-appear, and on trade switch (including the
  async-arrival sequence: pending unmounts the chart, settle flips `showChart` →
  effect re-fires); never on snapshot polls (user scroll preserved); null-guarded when
  the pan is unmounted. `LifecycleChart` crosshair uses `localPoint` +
  `getBoundingClientRect` (viewport-relative), so the scrolled container cannot skew
  coordinates — not a catch-#20 instance. `LifecycleChart.tsx` itself: zero diff.
- **Disclosures:** the controlled `<details open>` (documented deviation) is toggled by
  the summary's click handler; keyboard Enter/Space on `<summary>` dispatch click in
  browsers, so keyboard toggling works; expanded state is conveyed via the real `open`
  attribute (catch #24 honored — body is React-gated, never CSS-revealed). Journal's
  `chart-notes` uses a plain native `<details>` — also fine.
- **Dual dialog nesting (⋯ → Rebuild confirm):** the inner `RebuildButton` Dialog is a
  child of the outer `DialogContent`; Radix stacks dismissable layers so Escape/Cancel
  unwind one layer, and closing the outer unmounts the inner (no state leak).
- **TradeCard:** single focal affordance verified; select un-gated (catch #23); the
  rule-tags pill is a non-interactive div — no nested-interactive conflict; `fmtPnl("")`
  → NaN → dim `—` per contract.
- **Gates run:** scoped suite 143/143, **full `apps/web` suite 64 files / 774 tests
  green**, root `tsc --build --force` clean, eslint clean on all changed files.

One catch-#25-class finding survived the hunt (WR-01): the mobile tree makes the
paste→Analyze path reachable while no picker snapshot exists — a state the desktop tree
structurally could not reach — and then renders a payoff chart priced off the `spot = 0`
fallback with a fabricated `schwab` caption source.

## Warnings

### WR-01: Mobile paste during cold-start/error renders a payoff chart priced off fallback `spot = 0` with a fabricated caption source (catch-#25 class)

**File:** `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx:252-322`, `apps/web/src/screens/analyzer-mobile/MobileAnalyzerChart.tsx:96`
**Issue:** On desktop, the paste input only exists inside `CandidateRail`, which renders
only in the settled-snapshot branch — pasting with `snapshot === null` was structurally
impossible. `AnalyzerMobile` renders the paste block unconditionally (D-06 "the screen's
verb, first"), so during the persistent cold-start and error rail states (and the
loading window) a user can paste and Analyze. Then:
1. `handlePasteAnalyze` calls `parseTosOrder(pasteText, today, spot /* = 0 */, DEFAULT_RATE)`
   — `spot` feeds the BSM IV bisection (`tos-parser.ts:178`, `S: spot`), producing a
   garbage/failed IV solve;
2. the pasted candidate auto-selects → `MobileAnalyzerChart` mounts with `spot={0}` and
   a `computePayoffDomain` anchored on `[0, strike]` (`payoff-domain.ts:55-57` — spot 0
   joins the anchors), i.e. a degenerate ~0→7400+ domain with a meaningless T+0 curve;
3. the caption renders `{snapshot?.source ?? "schwab"} · {snapshot?.asOf ?? ""}` —
   a fabricated `schwab · ` provenance line when there is no snapshot at all, violating
   the honest-copy discipline (the dot is at least amber).
This is the catch-#25 pattern: an unconditional render priced off a fallback/optional
value, on a path the spec's own flow-order decision opened up without pricing guards.
**Fix:** Gate the chart block on a real snapshot (or a real spot), and never fabricate a
source:
```tsx
// AnalyzerMobile.tsx — chart block gate
{selected !== null && scenarioResult !== null && snapshot !== null && (
  <MobileAnalyzerChart … />
)}
```
(or, if pasted-only charting during outages is wanted later, gate on `spot > 0` and
render the caption as `— · —` when `snapshot === null`). Alternatively disable the
Analyze button while `snapshot === null` — but the gate above is the smaller, root-cause
fix since it also covers the error state where the analyze endpoint may still score the
paste.

## Info

### IN-01: Dead `cn` import survives in `Analyzer.tsx`

**File:** `apps/web/src/screens/Analyzer.tsx:26`
**Issue:** `cn` is imported but never used in the file (its last uses left with the
extraction/cleanup). Pre-existing before this phase, but the phase rewrote this exact
import block and carried the dead import through; neither eslint nor tsc is configured
to flag it.
**Fix:** Delete `import { cn } from "@/lib/utils";`.

### IN-02: TradeCard Space-key activation scrolls the page

**File:** `apps/web/src/screens/journal-mobile/TradeCard.tsx:62-64`
**Issue:** `onKeyDown` fires `onSelect` on `" "` but does not `preventDefault()`, so a
keyboard Space both selects the card and scrolls the document (native Space-scroll on a
non-button element with `role="button"`). Deliberate parity with the desktop `TradeRow`
idiom, but new code replicates the gap.
**Fix:** `if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(trade.id); }`
(apply to `TradeRow` in the same pass if touched).

---

_Reviewed: 2026-07-11T16:50:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
