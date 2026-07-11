---
phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-
reviewed: 2026-07-11T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - apps/web/src/components/AuthExpiredBanner.test.tsx
  - apps/web/src/components/AuthExpiredBanner.tsx
  - apps/web/src/components/PositionCard.test.tsx
  - apps/web/src/components/PositionCard.tsx
  - apps/web/src/components/Shell.tsx
  - apps/web/src/components/charts/PayoffControls.test.tsx
  - apps/web/src/components/charts/PayoffControls.tsx
  - apps/web/src/components/system/Button.tsx
  - apps/web/src/components/system/ChipRail.test.tsx
  - apps/web/src/components/system/ChipRail.tsx
  - apps/web/src/components/system/index.tsx
  - apps/web/src/components/system/system.test.tsx
  - apps/web/src/lib/position-format.test.ts
  - apps/web/src/lib/position-format.ts
  - apps/web/src/screens/Analyzer.test.tsx
  - apps/web/src/screens/Analyzer.tsx
  - apps/web/src/screens/Journal.test.tsx
  - apps/web/src/screens/Journal.tsx
  - apps/web/src/screens/MarketRail.test.tsx
  - apps/web/src/screens/MarketRail.tsx
  - apps/web/src/screens/Overview.test.tsx
  - apps/web/src/screens/Overview.tsx
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 35: Code Review Report

**Reviewed:** 2026-07-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

This phase is layout/presentation-only (no data layer, no business-logic changes), so the
highest-risk surface is the desktop-regression class (`lg:`-revert correctness) and the
mobile-only interactions this phase newly introduces. Most of the desktop-revert machinery
checks out: `SIZE_CLASS.touch`'s `lg:` triplet reverts to `xs`'s exact padding/text-size
values (the extra `lg:min-h-0` beyond `xs`'s string is a deliberate, UI-SPEC-mandated
flex-item-shrink fix, not a drift risk, in the one place it's used — `PayoffControls`'
`flex-wrap` row); `MarketRail`'s `lg:[&>div]:!block` targets exactly one direct-child
`div`, so the force-visible-at-desktop cascade is sound; the `hidden lg:table` /
`lg:hidden` table↔card pairing and the `PillHeader`'s triple-block chip duplication both
use real `display:none` gating (not `sr-only`/opacity), so the a11y-tree double-announce
risk RESEARCH flagged is correctly avoided; `Overview`'s grid `order-*` values (1/2/3
matching pre-existing DOM order) and `Analyzer`'s `display:contents` + `order-*` +
`lg:order-none` reverts are verified via explicit DOM-order/`getAttribute("style")`
assertions, not just claimed. The `Overview.tsx` grid's `lg:grid-cols-[320px_minmax(0,1fr)_360px]`
string was already present pre-phase and is untouched — genuinely byte-identical there.

One BLOCKER survived: the new mobile `PositionCard`'s tap-to-expand Δ/Γ/Θ/Vega interaction
— the headline new interaction this phase adds — is permanently non-functional for any
position that doesn't yet have a linked exit verdict, because `Overview.tsx`'s card-list
`expanded` computation was copy-pasted verbatim from the desktop table's *verdict-detail-row*
gate (which correctly requires `verdict !== null`, since that row has nothing else to show)
rather than being given its own un-gated boolean. This traces back to the UI-SPEC's own
reference implementation, not an implementation deviation, so plan/summary conformance to
the UI-SPEC doesn't catch it, and no test in `PositionCard.test.tsx` or `Overview.test.tsx`
exercises the mobile card's expand interaction end-to-end (the former passes `expanded` as
a raw prop, bypassing Overview's derivation; the latter never fires a tap on a
`position-card-*` element). Two WARNING-level findings round this out: `Analyzer` and
`Journal`'s `lg:` grid templates gained a `minmax(0,1fr)` track that didn't exist
pre-phase (a real, if generally-safe, CSS Grid track-sizing change contradicting the
phase's repeated "pixel-identical at `≥1024px`" claim), and `Shell`'s `100vh`→`100dvh`
migration dropped the `100vh` fallback line, so a browser without `dvh` support loses the
`<main>` `min-height` declaration entirely rather than gracefully degrading.

## Critical Issues

### CR-01: PositionCard's tap-to-expand Δ/Γ/Θ/Vega grid is permanently dead for any position without a linked exit verdict

**Status:** fixed — `5efae18`. Mobile card list's `expanded` now derives from
`expandedRowKey === r.key` alone, independent of verdict presence; the desktop
table's verdict-detail-row gate (line 424) is unchanged. RED test added to
`Overview.test.tsx` first (taps a card with no linked verdict, asserts the
Δ/Γ/Θ/Vega grid appears) — failed pre-fix, passes post-fix.

**File:** `apps/web/src/screens/Overview.tsx:616` (mobile card list), contrast with the
correct usage at `apps/web/src/screens/Overview.tsx:424` (desktop table)

**Issue:** The mobile card list computes each card's `expanded` prop as:

```tsx
// Overview.tsx:611-634 — mobile card list
const expanded = expandedRowKey === r.key && verdict !== null;
return <PositionCard ... expanded={expanded} onSelect={onSelectRow} ... />;
```

This is the exact same formula the desktop `<table>`'s `tbody` map uses at line 424 — but
there it correctly gates whether to render a *verdict-detail* `<tr>` (`VerdictDetailBody`,
lines 544-551), which genuinely has nothing to show when `verdict === null`. `PositionCard`
reuses this same boolean for a completely different feature: revealing the Δ/Γ/Θ/Vega grid
(`PositionCard.tsx:97-104`), the ONLY way to see a position's greeks on mobile (the desktop
table always shows greeks as static columns; the card never does, until expanded). Because
`expanded` is `false` whenever `verdict === null` — regardless of `selectedRowKey` — tapping
such a card fires `onSelect` (updates `selectedRowKey`) but the card's `aria-expanded` stays
`"false"` and the grid never renders. `verdict === null` is a normal, reachable state: any
row where `verdictByRowKey.get(r.label)` has no entry (a freshly opened calendar the exit
advisor hasn't scored yet, or any gap in advisor coverage) — not a rare cold-start-only
condition. On mobile this is total information loss for that position's greeks, since there
is no other UI surface showing them (unlike desktop). This traces to the 35-UI-SPEC's own
reference implementation (`35-UI-SPEC.md` §"3. `PositionCard` — new component", mount
snippet: `expanded={selectedRowKey === r.key && verdict !== null}`), so the plan/summary's
"followed the UI-SPEC verbatim" conformance doesn't surface it.

No test catches this: `PositionCard.test.tsx`'s expand tests pass `expanded` as a raw boolean
prop (bypassing Overview's derivation entirely), and `Overview.test.tsx`'s 35-04 dual-render
tests only assert card count and `textContent` — nothing fires a click/tap on a
`position-card-*` element to exercise the expand path.

**Fix:** Give the card list its own un-gated expand boolean, independent of verdict
presence; leave the table's verdict-detail-row gate untouched (it's correct as-is):

```tsx
// Overview.tsx mobile card list — was: `expandedRowKey === r.key && verdict !== null`
const cardExpanded = expandedRowKey === r.key;
return (
  <PositionCard
    key={r.key}
    row={r}
    ...
    verdict={verdict}
    expanded={cardExpanded}
    onSelect={onSelectRow}
    ...
  />
);
```

## Warnings

### WR-01: Analyzer's and Journal's `lg:` grid templates gained a `minmax(0,1fr)` track that didn't exist pre-phase, contradicting the "pixel-identical at ≥1024px" claim

**Status:** accepted — conscious desktop improvement. `minmax(0,1fr)` is the standard
CSS Grid blowout guard and matches `Overview.tsx`'s pre-existing, untouched
`lg:grid-cols-[320px_minmax(0,1fr)_360px]` pattern in the same file set — not reverted.
Added to the Desktop Regression Tripwire checklist (`35-06-SUMMARY.md`) as a manual
eyeball item for UAT rather than code changed back to a bare `1fr`.

**File:** `apps/web/src/screens/Analyzer.tsx:767`, `apps/web/src/screens/Journal.tsx:564`

**Issue:** Pre-phase, both screens' desktop grid used an inline `style` with a bare `1fr`
track: `style={{ gridTemplateColumns: "300px 1fr 330px" }}` (Analyzer) and a Tailwind class
`grid-cols-[250px_1fr_290px]` (Journal) — both unconditional (applying at every width, part
of the "fixed-pixel grids with zero responsive fallback" bug this phase exists to fix).
Post-phase, both convert to a `lg:`-gated Tailwind class with `minmax(0,1fr)` in place of
the bare `1fr`: `lg:grid-cols-[300px_minmax(0,1fr)_330px]` / `lg:grid-cols-[250px_minmax(0,1fr)_290px]`
— confirmed intentional (`Analyzer.test.tsx` explicitly asserts the `minmax(0,1fr)` string).
A bare `1fr` track's implicit minimum size is `auto` (same rule as flexbox's default
`min-width: auto`), so it can grow past its `fr` share to accommodate a child's intrinsic
min-content width; `minmax(0, 1fr)` explicitly overrides that floor to `0`, changing the
desktop (`≥1024px`) track-sizing algorithm from what shipped before this phase — not merely
adding new mobile behavior behind a media query. In the vast majority of cases this is
harmless or a strict improvement (it's the standard fix for the "grid blowout" overflow bug,
and it's the same pattern `Overview.tsx`'s pre-existing, untouched `lg:grid-cols-[320px_minmax(0,1fr)_360px]`
already used), but it is a genuine deviation from the phase's own repeated "desktop
(`≥1024px`) is pixel-identical throughout" / "byte-identical" contract, in exactly the kind
of narrow edge case (a wide unbreakable string forcing track growth) that a side-by-side
1280px screenshot diff (the MOBILE-06 tripwire) may not exercise unless test content happens
to trigger it.

**Fix:** Either accept this as a documented, deliberate deviation (it matches an
already-shipped pattern elsewhere in the app and is very likely strictly safer), or, if
byte-identical desktop output is a hard requirement, keep the desktop-only value truly
identical to before (`lg:grid-cols-[300px_1fr_330px]` / `lg:grid-cols-[250px_1fr_290px]`)
and rely on the outer container's overflow handling for the mobile-only concern instead.

### WR-02: Shell's `100vh`→`100dvh` migration drops the `100vh` fallback — unsupported browsers lose the `min-height` declaration entirely

**Status:** fixed — `4d3f89b`. `<main>` now carries both declarations in order
(`min-h-[calc(100vh-48px)] min-h-[calc(100dvh-48px)]`); the later `dvh` rule wins
where supported, the `vh` rule survives where it isn't.

**File:** `apps/web/src/components/Shell.tsx:99`

**Issue:** `<main className="min-h-[calc(100vh-48px)]">` became
`<main className="min-h-[calc(100dvh-48px)]">` — a straight 1:1 class substitution, not an
addition. Tailwind's arbitrary-value syntax emits exactly one CSS declaration for this
class: `min-height: calc(100dvh - 48px)`. In a browser that doesn't recognize the `dvh` unit,
CSS parsing rules drop the entire declaration as invalid (not "fall back to `vh`" — there is
no fallback value in the same declaration to fall back to), leaving `<main>` with no explicit
`min-height` at all rather than the pre-phase `100vh`-based one. `dvh` support is broad today
(evergreen Chrome/Firefox, Safari ≥15.4), so this is unlikely to bite in practice, but the
project doesn't document a minimum supported browser floor, and the standard technique for
this exact migration is two stacked declarations (the later, `dvh`-based one wins where
supported; the earlier `vh`-based one survives as the fallback where it isn't) — which this
change doesn't preserve.

**Fix:** Keep both declarations so an unsupported browser still gets the `vh`-based value:

```tsx
<main className="min-h-[calc(100vh-48px)] min-h-[calc(100dvh-48px)]">{children}</main>
```

## Info

### IN-01: PositionCard's `liveStatus` prop is threaded through three call sites but never consumed

**Status:** fixed — `6270dcd`. Dropped `liveStatus` from `PositionCardProps`, the
Overview card-list call site, and the `PositionCard.test.tsx` fixture. `Overview.tsx`'s
`PositionsTable`-level `liveStatus` (drives the desktop table's `isStale` styling) is
unrelated and untouched.

**File:** `apps/web/src/components/PositionCard.tsx:28,38-49`

**Issue:** `PositionCardProps.liveStatus` (`LiveStreamStatus`) is declared in the prop type
and passed at all three plumbing points (`PositionCard.tsx` itself never destructures it;
`Overview.tsx`'s card-list map still threads `liveStatus={liveStatus}` on every render). This
is a documented, deliberate simplification (35-UI-SPEC and the 35-04 SUMMARY both note the
per-cell live-flash chrome isn't ported to the card), but the prop itself is dead weight —
it adds a required prop and a re-render dependency for a value the component never reads.

**Fix:** Either consume `liveStatus` for something real (e.g., dim the card the same way the
table dims stale cells) or drop it from `PositionCardProps` and its one call site until it's
needed — reduces the component's public surface with no behavior change today.

---

_Reviewed: 2026-07-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
