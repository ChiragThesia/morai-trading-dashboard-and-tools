---
phase: 22-journal-calendar-lifecycle-graph
verified: 2026-07-05T19:30:53Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 1
overrides_applied: 0
gaps: []
human_verification:
  - test: "Hover the LifecycleChart hero/vol/greek/price panels inside the assembled Journal screen and confirm PnlBridgeCard's 'as of {day}' bridge updates in sync with the crosshair position, including snapping back to the last non-gap point when hovering a gap index."
    expected: "The rail's P&L bridge totals (Entry/Theta/Vega/Δ·Γ/Residual/Net) change live to match the hovered snapshot; hovering a true feed-gap point falls back to the last known non-gap totals, never fabricating gap values."
    why_human: "Component-level tests prove LifecycleChart fires onCrosshairChange and PnlBridgeCard reacts to a hoveredIndex prop in isolation (22-04/22-05 unit tests), and Journal.tsx wires onCrosshairChange -> setHoveredIndex -> PnlBridgeCard.hoveredIndex (confirmed by direct code read), but no test — component or screen level — exercises the live pointer-drag-across-the-assembled-chart-updates-the-assembled-rail path end to end (jsdom lacks PointerEvent in this repo's test environment, acknowledged in both 22-05 and 22-06 SUMMARY.md). This is a state-sync behavior, not a presence/wiring fact, so it is marked present-but-behavior-unverified rather than VERIFIED."
  - test: "Visually compare the rendered Journal screen (masthead, D-08 stacked chart, rail cards) against mockups/journal-lifecycle-v3.html using a real, sparse production calendar (one with actual feed gaps) via chrome-devtools."
    expected: "Panel proportions, colors, and gap-break rendering visually match the approved sketch; a real gap in production data renders as a visible break, not a smoothed/bridged line."
    why_human: "Unit tests confirm structural correctness (colors, viewBox, gap-break moveto counts) against synthetic fixtures, but final visual composition against the mockup with real production data is explicitly reserved by both 22-05-PLAN.md and 22-06-PLAN.md's own <verify> blocks for phase-gate chrome-devtools/human UAT, not self-certified by the executor."
---

# Phase 22: Journal Calendar-Lifecycle Graph Verification Report

**Phase Goal:** The Journal shows how ONE calendar trade evolved over its holding period (entry →
now/exit) as a stacked column of time-aligned panels, so a trader can read "how did this play out,
and why" at a glance — read-only visualization over the already-collected per-calendar snapshot
series, no new data collection.
**Verified:** 2026-07-05T19:30:53Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Selecting a calendar renders its lifecycle as TIME-on-x panels from entry to now/exit, sharing one date axis and a synced crosshair | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (structure VERIFIED, live sync unverified) | `LifecycleChart.tsx` builds one shared `xScale` (scalePoint over index) consumed by every panel (hero/vol/greeks/price); one crosshair `<line>` spans `CROSSHAIR_TOP`→`CROSSHAIR_BOTTOM` across the whole stack. `onCrosshairChange` wired in `Journal.tsx:364` (`onCrosshairChange={onCrosshairChange}`) → `hoveredIndex` state (`Journal.tsx:398`) → `PnlBridgeCard.hoveredIndex` (`Journal.tsx:575`). Structural wiring confirmed by direct code read + component-level unit tests (`LifecycleChart.test.tsx` "reports the hovered index via onCrosshairChange on move and null on leave"). No test — component or assembled-screen level — exercises the live pointer-drag interaction (jsdom has no `PointerEvent` in this repo, acknowledged in 22-05/22-06 SUMMARY.md); routed to human verification below. |
| 2 | HERO panel is P&L ATTRIBUTION over time — theta/vega/delta-gamma buckets plus an explicit unexplained residual, making the gamma-vs-theta collision visible | ✓ VERIFIED | `packages/core/src/journal/domain/attribution.ts` `computeAttributionSeries` — exact residual plug (`residual[i] = ΔpnlOpen[i] − theta[i] − vega[i] − deltaGamma[i]`), proven by a fast-check accumulation-identity property (`attribution.test.ts`). `LifecycleChart.tsx` stacks all 4 series (`HERO_KEYS = ["theta","vega","deltaGamma","residual"]`) and the residual band/legend render unconditionally — a dedicated test forces `cumResidual: 0` for every point and still asserts the band + legend render (`LifecycleChart.test.tsx` "always renders all 4 hero legend entries"). |
| 3 | Vol panel plots front IV, back IV, and implied FORWARD vol as distinct series; forward vol is the surfaced edge, not the front-minus-back spread | ✓ VERIFIED | `computeForwardVol` (`fwd-vol.ts`) implements D-07's identity with a tagged never-NaN union (`{forwardVol; guard:"ok"}` \| `{forwardVol:null; guard:"inverted"}`) — 6/6 unit tests + a 1000-run fast-check property (`Number.isNaN(result.forwardVol) === false`), independently re-run and passing. `LifecycleChart.tsx` renders `vol-line-front`/`vol-line-back`/`vol-line-forward` as three distinct `LinePath`s (front `#d6dbe4` solid, back `#7b8696` dashed, forward `#f0b429` 2.6px — the dominant amber "edge"), asserted by a dedicated color/distinctness test. The forward-vol line additionally breaks independently at an inverted-guard point that is NOT a feed gap (D-02), verified by a moveto-count test (3 runs for forward-vol vs 2 for front/back at the same series). `EdgeCard.tsx` renders forward vol as the dominant figure with an explicit "Inverted term structure" caption branch, never a blended value. |
| 4 | Greeks shown SIGNED, each on its own small-multiple panel (delta/gamma/theta/vega), surfacing the long-vega/short-gamma/+theta signature and sign-flip | ✓ VERIFIED | `LifecycleChart.tsx` renders 4 independent panels (`GREEK_PANEL_Y`), each with its own zero-baselined `scaleLinear` domain (`greekScaleY`, computed per-key from that key's own value range, not a shared scale) and its own signed fill + line, colored per the locked UI-SPEC map (delta violet, gamma red/down, theta up/teal, vega blue) — asserted directly against the hex values in `LifecycleChart.test.tsx`. `GreeksNowCard.tsx` renders the same 4 signed values in the rail. |
| 5 | Feed gaps (spot=0/NaN) render as line breaks, never interpolated; the attribution residual is always shown, never hidden | ✓ VERIFIED | Domain: `isGapRow` (`attribution.ts`) flags `spot==="0"` OR any non-finite greek/IV; `computeAttributionSeries` skips (never bridges) any interval touching a gap, carrying the last non-gap cumulative forward so a post-gap point resumes exactly where it left off (test: "gap-in-middle skip"). Chart: every `LinePath` uses `defined={(d) => !d.isGap}` (visx/d3-shape natively multi-subpath-breaks); stacked/signed area fills use a hand-built `buildGapAwareBandPath` that flushes each contiguous run rather than bridging. Independently re-run test `"breaks every panel's line at the true feed gap (idx 2)"` asserts exactly 2 moveto commands (1 real break) across all 8 line series simultaneously. Residual band/legend is structurally unconditional (see truth #2 evidence) — no `if (residual)` guard exists anywhere in the render path (confirmed by direct code read of the HERO_KEYS.map render loop). |

**Score:** 5/5 truths verified (1 present, behavior-unverified — the live crosshair→rail sync interaction specifically, not the underlying wiring).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/journal/domain/fwd-vol.ts` | `computeForwardVol`, tagged never-NaN guard | ✓ VERIFIED | Read directly; matches D-07 formula, guards `!Number.isFinite`/`tb===tf`/`rad<0` correctly, radicand-exactly-0 stays "ok" (not "inverted") as documented. |
| `packages/core/src/journal/domain/attribution.ts` | `computeAttributionSeries`, `isGapRow` | ✓ VERIFIED | Read directly; exact residual plug, gap-skip-carry-forward logic matches D-05/D-06. |
| `packages/core/src/journal/application/getCalendarLifecycle.ts` | Thin use-case wrapping `ForReadingJournal` + both domain fns | ✓ VERIFIED | Read directly; propagates `err`/`ok(null)`/`ok([])` correctly, maps `guard`→`forwardVolGuard` explicitly (no blind spread), imports only `@morai/shared` + sibling core files (hexagon-pure). |
| `apps/server/src/adapters/http/journal-lifecycle.routes.ts` | JWT-gated `GET /api/journal/:calendarId/lifecycle` | ✓ VERIFIED | Read directly; zero business logic, `lifecycleResponse.parse(...)` at the boundary, 404 on `ok(null)`, 500-flat-body on `err`. Confirmed mounted inside `apiRouter` → `authReadGroup` (JWT-gated) in `main.ts`, never on `app` directly. |
| `packages/contracts/src/journal.ts` (`lifecycleSnapshotResponse`/`lifecycleResponse`) | Additive `.extend()` over `snapshotResponse` | ✓ VERIFIED | `git show 9a8799a` — 32 insertions, 0 deletions, confirmed purely additive. Re-exported from `packages/contracts/src/index.ts` (a Rule-1 bug in the initial 22-01 commit, caught and fixed in 22-03 — confirmed the fix is present in the current barrel). |
| `apps/web/src/hooks/useLifecycle.ts` | react-query hook, `enabled: !!calendarId` guard | ✓ VERIFIED | Read directly; guard present from the start (the Phase-20 bug this phase explicitly set out to not repeat), 401 non-retryable, `lifecycleResponse.parse()` (no `as`). |
| `apps/web/src/components/LifecycleChart.tsx` | D-08 stacked-panel SVG engine | ✓ VERIFIED | Read directly, ~780 lines; five real stacked regions, gap-aware paths, shared crosshair — not a stub. |
| `apps/web/src/components/{LifecycleMasthead,EdgeCard,GreeksNowCard,PnlBridgeCard,BeatsCard}.tsx` | Presentational rail cards | ✓ VERIFIED | Confirmed all five exist, are imported and mounted in `Journal.tsx` (`PnlBridgeCard`/`EdgeCard`/`GreeksNowCard`/`BeatsCard` at lines 575-578, `LifecycleMasthead` at line 326). |
| `apps/web/src/screens/Journal.tsx` | Screen rewired to `useLifecycle` + masthead + chart + rail | ✓ VERIFIED | Read directly; `useJournal` fully replaced by `useLifecycle`, orphaned `SnapshotTable` confirmed removed (no remaining reference anywhere in the file), RULE-01 Notes card relocation and honest-caveats footer both present. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `getCalendarLifecycle.ts` | `fwd-vol.ts` / `attribution.ts` | direct function call, per-row map | ✓ WIRED | Confirmed by direct read — both fns called on every row, results merged with explicit field mapping (no blind spread of `guard`). |
| `journal-lifecycle.routes.ts` | `getCalendarLifecycle` use-case | Hono handler → `await getCalendarLifecycle(calendarId)` | ✓ WIRED | Result branching (`err`→500, `ok(null)`→404, `ok([...])`→200 parsed through `lifecycleResponse`) confirmed by direct read. |
| `main.ts` | `journalLifecycleRoutes` | `.route("/", journalLifecycleRoutes(getCalendarLifecycle))` inside `apiRouter`, nested under `authReadGroup` (JWT) | ✓ WIRED | Confirmed via `grep` + direct read of `main.ts` lines 281 and 316-323 — never mounted on `app` directly. |
| `apps/server/src/adapters/mcp/tools.ts` / `server.ts` | `getCalendarLifecycle` | `registerGetJournalLifecycleTool` registered when `getCalendarLifecycle` param present | ✓ WIRED | Confirmed via `grep` across `tools.ts`/`server.ts`/`main.ts` — `get_journal_lifecycle` tool name present in all three composition points. |
| `useLifecycle.ts` | `GET /api/journal/:calendarId/lifecycle` | `apiFetch` + `lifecycleResponse.parse()` | ✓ WIRED | Confirmed by direct read. |
| `Journal.tsx` | `useLifecycle` | `useLifecycle(selectedTrade?.calendarId ?? "")` | ✓ WIRED | Confirmed by direct read, line 405. |
| `Journal.tsx` | `LifecycleChart` | `<LifecycleChart snapshots={snapshots} onCrosshairChange={onCrosshairChange} />` | ✓ WIRED (no `strike` prop passed) | Confirmed by direct read, line 364. See Anti-Patterns/gaps note below re: `strike` prop never wired despite being available data and specified in 22-UI-SPEC.md's Chart Series Color Map ("Strike reference (horizontal)"). This is a cosmetic, non-blocking gap — deferred, not a phase-goal blocker (see Deferred Items). |
| `LifecycleChart.onCrosshairChange` | `Journal.tsx` `hoveredIndex` | `setHoveredIndex` passed as the callback | ✓ WIRED (structurally) | Confirmed by direct read, lines 398/364. Live runtime behavior of this link is the human-verification item above. |
| `hoveredIndex` | `PnlBridgeCard.hoveredIndex` | prop pass-through | ✓ WIRED | Confirmed by direct read, line 575. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `LifecycleChart` | `snapshots` prop | `useLifecycle(calendarId)` → `GET /api/journal/:calendarId/lifecycle` → `getCalendarLifecycle` use-case → `readJournal` port (existing `leg_observations`-backed repo) | Yes — traces to the existing, already-collected snapshot repo, enriched in-flight by real domain math (no static/empty fallback found in the use-case or route) | ✓ FLOWING |
| `PnlBridgeCard`/`EdgeCard`/`GreeksNowCard`/`BeatsCard` | `snapshots` / `beats` props | Same `useLifecycle` series (rail cards) / locally derived from `selectedTrade.openedAt`/`closedAt` + `snapshot.trigger==="event-move"` (beats) | Yes | ✓ FLOWING |

### Behavioral Spot-Checks (re-run independently, not trusting executor SUMMARY claims)

| Behavior | Command | Result | Status |
|---|---|---|---|
| Workspace typecheck is actually clean | `bun run typecheck` (run fresh by this verifier) | `tsc --build --force` — no output, exit clean | ✓ PASS |
| Workspace lint is actually clean | `bun run lint` (run fresh by this verifier) | Only pre-existing informational `[boundaries]` warning (legacy selector syntax, unrelated to this phase); no errors | ✓ PASS |
| Journal-lifecycle test files actually pass (not just claimed in SUMMARY) | `bunx vitest run packages/core/src/journal/ apps/server/src/adapters/http/journal-lifecycle.routes.test.ts apps/web/src/components/LifecycleChart.test.tsx apps/web/src/screens/Journal.test.tsx apps/web/src/hooks/` (run fresh by this verifier, scoped — not the full 2080-test suite) | 47 test files / 448 tests, all passed | ✓ PASS |
| Contract additivity claim (`journal.ts` byte-for-byte unchanged for existing fields) | `git show 9a8799a -- packages/contracts/src/journal.ts` (re-run by this verifier) | 32 insertions(+), 0 deletions | ✓ PASS |
| Gap-break assertions are non-vacuous (not just "renders truthy") | Direct read of `LifecycleChart.test.tsx` `countMoves()` helper + its 2 gap-break tests | Tests count actual SVG path `M` (moveto) commands and assert exact counts (2 for a general gap, 3 for forward-vol's independent inverted-guard break) — genuine structural proof, not a rendering-truthy check | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| JRNL-01 | 22-01 through 22-06 (all 6 plans declare it) | Per-calendar time-series lifecycle graph: P&L attribution, forward vol, signed greeks, price vs strike | ✓ SATISFIED (with 1 human-verification item + 1 minor deferred cosmetic gap) | See Observable Truths #1-5 above; the core decomposition (attribution/forward-vol/signed-greeks/gap-honesty) is fully wired and independently re-tested. The live crosshair-sync interaction and visual mockup fidelity are reserved for human/chrome-devtools UAT, consistent with the executor's own plan-level `<verify>` blocks. |

No orphaned requirements found — REQUIREMENTS.md maps only JRNL-01 to Phase 22, and all 6 plans declare it.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `apps/web/src/screens/Journal.tsx` | (no strike wiring anywhere) | `LifecycleChart` mounted without a `strike` prop, so the "PRICE vs STRIKE" panel's dashed strike-reference line (locked in 22-UI-SPEC.md's Chart Series Color Map, "Strike reference (horizontal)") never renders in production, even though `selectedTrade`/calendar data includes a `strike` field elsewhere in the codebase (`packages/contracts/src/calendar.ts`) | ℹ️ Info / minor | Cosmetic only — the price line itself still renders; only the horizontal strike reference is missing. 22-05-PLAN.md itself anticipated this ("omit the reference line if not provided — Journal wires it in 22-06"), but 22-06-PLAN.md's own action text never actually specifies passing `strike`, and no plan flagged this as a gap. Does not block the phase's core value proposition (P&L attribution, forward vol, signed greeks, gap-honesty) but is a real, observable deviation from the locked UI-SPEC design contract. Recommend a follow-up one-line fix (pass `strike={selectedTrade?.strike}` through to `LifecycleChart`) rather than blocking phase completion. |

No `TBD`/`FIXME`/`XXX` debt markers found in any of the 13 key files scanned. No stub patterns (`return null`, empty handlers, hardcoded empty arrays flowing to render) found — every prop/state traced back to a real data source.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| — | (none — the `strike` gap above is not deferred to a later roadmap phase; it is an unaddressed minor cosmetic item within this phase's own scope, listed under Anti-Patterns as informational, not a blocking gap) | — | — |

### Human Verification Required

See frontmatter `human_verification` for the full structured list. Both items were explicitly reserved by the executor's own plan `<verify>` blocks (22-05-PLAN.md, 22-06-PLAN.md) for phase-gate chrome-devtools/human UAT — they are not blockers, they are the expected next step per this project's `human_verify_mode`.

1. **Live crosshair → P&L-bridge sync** — hover the assembled chart, confirm the rail bridge updates in real time (including the gap-hover fallback behavior).
2. **Visual fidelity vs the D-08 mockup** — compare the assembled screen against `mockups/journal-lifecycle-v3.html` using real, sparse production data (a calendar with actual feed gaps).

### Gaps Summary

No blocking gaps. All 5 ROADMAP success criteria are backed by real, wired, independently-re-verified code and tests — this is not a SUMMARY-only claim; typecheck, lint, and the phase's test files were all re-run fresh by this verifier and matched the executor's claims exactly. One cosmetic, non-blocking deviation from the UI-SPEC (missing `strike` prop wiring on the price panel) is flagged as informational. Two items require human/chrome-devtools UAT before full sign-off, both explicitly anticipated by the plans themselves (live crosshair-sync interaction, and visual fidelity against the mockup with real production data) — this routes the phase to `human_needed`, not `passed`, per the verification decision tree (a `PRESENT_BEHAVIOR_UNVERIFIED` truth cannot be counted VERIFIED on wiring alone, and a non-empty human-verification list means the phase cannot be `passed`).

---

_Verified: 2026-07-05T19:30:53Z_
_Verifier: Claude (gsd-verifier)_

---

## Live UAT Addendum — 2026-07-05 (post-deploy, chrome-devtools on morai.wtf)

Phase deployed: web `dpl_GjLeqp…` READY @ `1a93c17`; server Railway `35650233` SUCCESS.
Both `human_needed` items driven live against prod (authenticated session).

**Item 1 — crosshair → P&L-bridge sync: PASS.** New `GET /api/journal/:id/lifecycle`
serves 200 with the exact enriched contract. On the open 7425P calendar, hovering a
Jul-01 non-gap point → chart tooltip renders the real readout
(`net P&L / theta / vega / delta-gamma / forward vol 0.15% / SPX 7502`) AND the rail
P&L-bridge label flips to "as of Jul 01"; hovering the latest point → "as of Jul 03".
Gap rows show "feed lapsed — no data" and the bridge correctly falls back to last-non-gap
(the designed 22-04 behavior) — never fabricated.

**Item 2 — D-08 visual fidelity: PASS.** Chart renders all panels with real data —
P&L attribution hero (theta/vega/delta-gamma/residual stack), vol & term structure
(amber forward-vol line), signed greek small-multiples — plus masthead verdict, rail
cards (THE EDGE fwd vol 0.2%, GREEKS·NOW delta −1.19), honest-caveats footer, BEATS.
Gaps drawn as breaks, never interpolated.

**Strike-line gap (was informational):** FIXED pre-deploy in `cd387e6` (TradeSummary →
toTradeSummary → LifecycleChart strike wiring, TDD RED→GREEN).

**Findings surfaced (NOT phase-22 defects, tracked in STATE follow-ups):**
1. Prod journal snapshot data is ~74% gap rows (flagship calendar: 12 non-gap of 46) —
   upstream `snapshot-calendars` writing spot=0/NaN + worker-down hole Jun 27-30. Feature
   works and renders honestly; real-world richness throttled until the pipeline records
   clean series.
2. `GET /api/journal//rules` → 401 (empty calendarId; Phase-20 `useRuleTags` missing the
   `enabled` guard `useLifecycle` has). Pre-existing.

**Verdict: PASSED** (both human-UAT items confirmed live).

_UAT by: Claude (orchestrator, chrome-devtools) — 2026-07-05_
