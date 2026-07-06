# Milestones

## v1.2 Trade Picker & Dashboard Redesign (Shipped: 2026-07-06)

**Phases completed:** 8 phases (16–22), 43 plans, 90 tasks
**Timeline:** 4 days (2026-07-03 → 2026-07-06)
**Git range:** `b603e29` → `5a55f62` — 356 commits
**Closeout:** override_closeout — 7 acknowledged deferrals (see STATE.md Deferred Items; all done-but-unrecorded or advisory)

**Delivered:** Prod caught up to the phase-15 image before the re-auth window (DEPLOY-04), then the
dashboard was redesigned end-to-end — a TOS-fidelity Overview payoff dock with per-leg IV-calibrated
curves, a ranked-cards calendar Picker driven by a real `scoreCalendarCandidates` engine over live
chain + economic-events context, a three-state stream-health watchdog, event-triggered journal
snapshots, a per-trade strategy-rules recording layer, an app-wide button/affordance system, and a
per-calendar journal lifecycle graph (P&L attribution, forward vol, signed greeks).

**Key accomplishments:**

- Restored GW-05 (sidecar zero public domains, via GraphQL after a CLI re-verify re-exposed it) and captured exact pre-deploy ground truth — server/worker stale at a commitHash-null `railway up` from 21:27Z, web current at 22:12Z (220719f), two pre-existing job errors baselined, migration parity at 0013, tree docs-only ahead, suite green.
- Force-deployed the stale server + worker to the phase-15 tip via `railway up --service` (git push SKIPs them) — both landed fresh SUCCESS at 2026-07-03T19:19Z, AFTER the last phase-15 commit 0c5600f (IN-06 alert-copy fix), so timestamp correlation proves the stale-image gap is closed. Verified refreshExpiresIn key-presence on both apps, worker liveness via cron jobs firing on the new image, and access-control intact; web confirmed current at 220719f by timestamp with the dashboard sha read deferred to Plan 03. Sidecar untouched.
- Ran the D-04 manual smoke checklist against the freshly-deployed phase-15 image (get_status/get_journal/get_cot/get_macro over the MCP `/mcp` transport + curl) and found NO new regression — the only two `lastJobRuns` errors are the exact Plan 01 baseline pair, and both self-recovered (each has a later `lastSuccessAt` on the new image). The operator confirmed the live prod web app (dashboard/positions/GEX render) and the T-24h alert-surface wiring — `refreshExpiresIn` present (null, correct) on both apps in the browser's `/api/status` poll and via server curl, with `AuthExpiredBanner` shipping in web@220719f and correctly not rendering outside the window. DEPLOY-04 criteria 2 (checkpoint 1) and 3 (no regression) are met; DEPLOY-04 closes. Two follow-ups recorded (not blockers): the ~2026-07-08 live amber-banner observation and the RTH-bound live-stream check.
- resolveLegIv() — a tagged, tested client-side price→IV bridge around the frozen `invertIv` core solver, replacing the flat DEFAULT_IV guess for OVW-02
- Extended `scenario-engine.ts` with leg-aware (front/back) non-convergence exclusion in `bookPL`/`bookPLAtExpiry` and a new `buildScenarioStrip()` producing the bounded D-06 key-level set with a D-07 front-expiry header
- Extended PayoffChart.tsx with D-05's row-highlight dual-curve dim (stroke-opacity 0.3) and D-02's amber T+0 exclusion note, both driven by new backward-compatible props — no modal, no second chart, no data wiring (Plan 04 supplies the values).
- Rewrote Overview.tsx into the TOS-dock layout and wired the payoff hero to price via per-leg calibrated IV (resolveLegIv), replacing the flat DEFAULT_IV guess with honest non-convergence badging, two-channel staleness, and row-highlight — the Wave-2 integration plan that lands all four Phase-17 ROADMAP success criteria on screen
- Zero-dependency date-projection library (`toDateInputValue`, `parseLocalDateInput`, `daysBetween`, `resolveDaysForward`, `computeProjectionBounds`) that turns an `<input type="date">` value into a clamped, NaN-safe `daysForward` integer, with a fast-check round-trip property killing the UTC-vs-local day-math bug class before any UI wiring consumes it.
- PayoffChart's y-axis now scales from both P&L curves combined, x-ticks are derived from a round-number generator instead of a hardcoded array, curve colors are prop-configurable with brand-matching defaults (Analyzer untouched), and the WR-03 setState-in-render antipattern is cleared — all without changing a single pixel of the currently-shipped Analyzer chart.
- Lifted `excludedCalendars` state from PositionsTable to Overview so one Set now drives both the payoff-chart curves and the table total — closing the OVW-06 decoupling bug where unchecking a row moved the P&L total but left the chart curve unchanged.
- A native TOS-style date picker (`Date: [‹] [date input] [›] [Today]`) now projects the Overview payoff hero's today/date curve via the existing `daysForward` scenario path while the @exp curve stays fixed, and the hero's two curves + legend swatches render the pre-approved TOS magenta/cyan palette — both scoped to the Overview's `PayoffChart` instance only, leaving the Analyzer's identical chart untouched.
- The docked positions table's compact `Nd → Nd` DTE cell is now a two-line `{expiry(s)} / {DTE(s) + calendar width}` cell under an `Expiry / DTE` header, driven by a new pure, unit-tested `formatExpiryCell` helper.
- `PickerCandidate`/`pickerSnapshotResponse` Zod contract with a closed breakdown-criterion enum, plus a frozen 9-candidate fixture (8 real + 1 guard-case) ported from `playground-v4.html`'s real chain-snapshot output.
- Extended PayoffChart with two additive optional prop pairs — compareCurve/compareCurveColor (dashed-amber ⊕-compare overlay) and expectedMoveBand (±1σ tick/connector band) — a 4th round of the component's established additive-prop idiom, with Overview.tsx's existing call site left byte-for-byte unchanged.
- New `candidateToAnalyzerPosition` adapter maps a `PickerCandidate` into one throwaway `AnalyzerPosition` and proves (example + 200-run fast-check property) that its worst-case expiration P&L never exceeds the quoted debit beyond a documented BSM-derived tolerance.
- Rewrote Analyzer.tsx into the ranked-cards calendar picker — data-driven CandidateCard rail (score-breakdown bars looked up by criterion name, guard-safe) plus a payoff center that reprices the selected candidate through the one shared BSM engine, overlays a single dashed-amber ⊕-compare curve, draws the ±1σ EM band, and renders a 5-level T+0/@exp scenario strip.
- Filled the picker's right column (WhyPanel stat-grid + conditional narrative, guard-aware inline-SVG TermStructureChart, EntryExitPlan arithmetic card) and deleted the 8 now-orphaned old-Analyzer files, closing out phase 18 with a full green suite.
- Additive `source`/`gexContextStatus`/`eventsContextStatus` fields on `pickerSnapshotResponse` plus a hexagon-pure `packages/core/src/picker/application/ports.ts` exporting 9 driven ports and 6 row/domain types for every downstream Phase-19 plan to import.
- Two pure numeric domain functions — `computeFwdIv` (forward-variance identity with a never-NaN inverted-structure guard) and `findBreakevens` (bounded bisection over a long put-calendar's payoff-at-front-expiry) — both fast-check-property-covered, calling `@morai/quant` bsmPrice only, zero new dependencies.
- Two pure domain modules — `selectCandidates` (delta-targeted OTM-put calendar universe over the live chain, DTE-grid pairing, net-θ>0 filter, event-span flags) and `scoreCalendarCandidates` (the named 40/25/15/10/10 weighted score with a closed-enum breakdown and the REAL breakeven-width/expected-move ratio replacing the mockup's faked term) — the picker engine's actual scoring brain, fast-check covered, zero new dependencies.
- FRED CPI+NFP `release/dates` HTTP adapter unioned with a maintained FOMC seed into one honest `EconomicEvent[]`, persisted to a plain-`date` Postgres table via a shared memory+Postgres contract suite
- Append-history `picker_snapshot` table (whole `pickerSnapshotResponse` as one Zod-validated JSONB blob per instant) + the `readChainForPicker` latest-put-cohort read, both contract-tested against real Postgres, with migrations 0014+0015 applied to the live schema.
- computePickerSnapshot orchestrates chain+GEX+events into one honestly-tagged, top-8-ranked PickerSnapshotRow; getPicker forwards the latest row with zero recompute
- GET /api/picker/candidates Hono route + get_picker_candidates MCP tool, both thin readers of the latest picker_snapshot row parsed through the single pickerSnapshotResponse contract (PICK-02).
- Chain-triggered compute-picker job + weekly fetch-economic-events cron, with compute-gex-snapshot now enqueueing compute-picker on success — the full precompute pipeline is wired end-to-end in the worker composition root.
- Task 1 — `usePicker()` hook
- Additive `streamPingEvent` Zod schema in `@morai/contracts` plus a pure `deriveStreamStatus` state-derivation function in `apps/web/src/lib`, both test-first, locking the wire shape and status logic that 20-02 (server) and 20-03 (client) build on in parallel.
- Both duplicated GET /api/stream ping-emit sites now push `{isRth}` computed via `@morai/core`'s `isWithinRth`/`isNyseHoliday`, replacing the empty keep-alive frame — plus a barrel-export fix so `@morai/contracts` actually exposes `streamPingEvent`.
- `useLiveStream` now wires the previously-ignored SSE `ping` event into a shared elapsed-time interval that derives an honest live/quiet/stalled status (never LIVE while ticks are stalled), and `LiveStatusBadge` is restyled to the exact 3-state alarm-tone contract from 20-UI-SPEC.md with a working backoff-cancelling force-reconnect button — closing the Phase-12 "badge lies LIVE" debt.
- Two pure, property-tested detectors (rolling-window % move, cross-process cooldown) plus an additive `SnapshotRow.trigger` provenance field and use-case passthrough — all framework-free inside `packages/core`.
- Numbered migration 0016 lands the additive `calendar_snapshots.trigger` provenance column; the Postgres and memory repos map it (default 'scheduled') and both implement `ForReadingLatestSnapshotTime` via `MAX(time)` with proven memory/Postgres parity under testcontainers.
- Server-side headless detector (observeSpot -> detectLargeMove -> DB cooldown -> jobBoss.send) wires the already-arriving SPX tick to a provenance-stamped supplemental snapshot, completing SNAP-01 code.
- Three event-keyed Zod enums (enter/exit/roll rule tags, D-07/D-08 locked) plus list-shaped, OTHER-requires-note request/response contracts (D-14/D-21) — vocabulary single-sourced from @morai/core into packages/contracts.
- A no-FK `calendar_event_annotations` table (migration 0017) plus a Postgres repo + memory twin at proven contract parity, with a regression test pinning the rebuild-survival invariant that motivates the no-FK design (D-09).
- Canonical `ForReadingAnnotations`/`ForWritingAnnotations` core ports plus the `getCalendarEventsWithRules` read use-case (closing RESEARCH's "no read surface for calendar_events" gap) and the `setRuleTags` write use-case (validates against the event-type enum + D-21 OTHER-note rule, never evaluates rules).
- 1. [Rule 3 - Blocking] setRuleTags required a calendarId the plan's own route can never supply
- useRuleTags react-query hook + a Journal Notes panel rule-tag control (ENTER always / EXIT gated on CLOSE / one row per ROLL) using the Phase-21 Button toggle chip, with OTHER-requires-note gating and a neutral trade-list read-view pill — the final RULE-01 surface, closing out Phase 20.
- `computeAttributionSeries` — per-interval theta/vega/delta-gamma P&L attribution with an exact residual plug and honest gap handling, exported from `@morai/core`.
- Rewrote LifecycleChart.tsx from the retired 3-tab + scrubber engine into a five-region D-08 stacked SVG (P&L attribution hero, vol & term structure, 4 signed greek small-multiples, price vs strike) with honest per-panel gap breaks and a shared crosshair + tooltip.
- Rewired the Journal screen's center and right columns to the enriched `useLifecycle` series — masthead + D-08 stacked chart in the center, a crosshair-reactive P&L bridge / edge / greeks-now / beats rail on the right, honest too-new/error states, and a relocated RULE-01 Notes card — closing out JRNL-01.

---

## v1.1 Real-Time Schwab Streaming (Shipped: 2026-07-02)

**Phases completed:** 6 phases (10–15), 33 plans, ~100 tasks
**Timeline:** 8 days (2026-06-25 → 2026-07-02)
**Git range:** `e992c63` → `b603e29` — 285 commits, 322 files changed, +44,929/−5,332
**Requirements:** 18/18 satisfied (DOC-01, GW-01..05, JRNL-02, STRM-01..05, COT-01..02, MAC-01..02, AUTH-05..06)
**Closeout:** override_closeout — known verification overrides: 9 (see STATE.md Deferred Items; all v1.0-era or already UAT-closed)
**Audit:** milestones/v1.1-MILESTONE-AUDIT.md — status tech_debt, no blockers

**Delivered:** A single Python schwab-py sidecar became the sole Schwab boundary (REST +
stream); live position greeks stream to the browser; the journal is re-sourced through the
sidecar; COT and expanded FRED macro data feed new analytics surfaces; re-auth is alerted
and operator-runbook-driven instead of a silent weekly outage.

**Key accomplishments:**

1. Python schwab-py sidecar as third Railway service, sole Schwab boundary — OAuth + token ownership via `broker_tokens` callbacks, Postgres advisory-lock single-streamer guarantee, internal-only networking; TS `refresh-tokens` job and `apps/auth` CLI retired (GW-01..05)
2. Live streaming: LEVELONE_OPTION greeks (BSM-recomputed, never raw) + ACCT_ACTIVITY fills → authed SSE fan-out `GET /api/stream` with opaque tickets, cold-start reconcile, zero per-tick persistence (STRM-01..05)
3. Journal chain snapshots re-sourced through sidecar REST proxy with automatic CBOE fallback during auth gaps (JRNL-02)
4. Weekly COT adapter: `fetch-cot` cron → `cot_observations` → `GET /api/analytics/cot` + MCP `get_cot` (COT-01..02)
5. FRED macro expansion: 8 series (7 FRED + VVIX via CBOE) twice daily → `macro_observations` → `GET /api/analytics/macro` + MCP `get_macro` + Overview MacroCard (MAC-01..02)
6. Re-auth smoothing: T-24h `refreshExpiresIn` on both status surfaces, single-latch warning log, amber pre-expiry banner, operator runbook + `seed_token.py` flow — proven live 2026-07-02 (AUTH-05..06)

**Known tech debt (carried forward, from milestone audit):**

- Prod runs the pre-phase-15 image — T-24h alert surface not live until server+worker+web deploy (next re-auth window ~2026-07-09)
- No silent-stall watchdog on live stream (badge can show LIVE while ticks stalled)
- `apps/web` tsc --noEmit fails in 4 pre-phase-15 files; web has no typecheck gate in CI
- Phase 11 VALIDATION.md nyquist_compliant: false — per-task map never audited
- Phase 14 IN-01..03 + Phase 15 six Info-severity review findings (see audit frontmatter)

---
