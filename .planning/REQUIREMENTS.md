# Requirements: Morai v1.3 Picker Intelligence

**Defined:** 2026-07-09
**Core Value:** The journal — plus, this milestone: the engine that picks entries with the user's
real criteria learns to manage exits, proves its rules on his own history, and inherits the rest
of his playbook. Every rule research-grounded — "no feeling."

## v1.3 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Ops rider (defect fixes the new features consume)

- [x] **OPS-01**: snapshot-calendars no longer writes empty/gap journal rows — open-calendar
      series are complete going forward (root-cause the ~74% gap-row windows)
- [x] **OPS-02**: compute-bsm-greeks commits work in batches so a full-cohort drain survives the
      900s pg-boss handler cap without the timeout+retry dance

### Macro & regime data (day-one plumbing — no backfill exists)

- [x] **MACRO-01**: VIX3M ingested daily from FRED (`VXVCLS`) into macro_observations alongside
      the existing 8 series
- [x] **MACRO-02**: Regime/breadth indicator set researched online and admitted only with
      documented evidence (candidates: RSP:SPY equal-weight breadth ratio, VIX9D/VIX and
      VVIX/VIX ratios, term-structure state, FRED movement series) — each indicator carries a
      source + rationale in docs, mirroring picker-rules.md discipline
- [x] **MACRO-03**: Evidence-admitted indicators are ingested/computed on a daily cadence with
      as-of dates stamped (EOD data never presented as intraday)

### Regime board (Overview tab)

- [x] **BOARD-01**: Overview tab shows a visible regime/breadth board: each indicator with
      current value, threshold state (calm/warning/crisis banding), and as-of date
- [x] **BOARD-02**: Each board indicator exposes its "why" (source + threshold rationale) the
      same way the Analyzer scorecard exposes rule provenance
- [x] **BOARD-03**: Board data ships HTTP + MCP (MCP-02 convention)

### Exit advisor

- [x] **EXIT-01**: Every open calendar gets a verdict each pipeline cycle — HOLD / TAKE (with
      ladder rung +5/+10/+15%) / STOP (−25/−50%) / EXIT-pre-event — from a typed exit-rule
      registry mirroring rules.ts
- [x] **EXIT-02**: Verdicts derive from the validated journal fill-ledger P&L basis (never a
      recomputed parallel P&L) and the latest calendar snapshot (netMark, term structure, greeks)
- [x] **EXIT-03**: TERM trigger fires on live front−back IV inversion ≥0.5pp; GAMMA trigger on
      spot >2% off strike with front <7 DTE; EVT trigger on tier-1 event ≤3d from front expiry
- [x] **EXIT-04**: Each verdict names the rule that fired and its raw metric (no bare verdicts,
      no fabricated confidence percentages)
- [x] **EXIT-05**: Verdicts are session/staleness-gated with hysteresis banding — no flapping on
      AH-indicative marks or gap rows
- [x] **EXIT-06**: ROLL verdict: when front <14 DTE, spot within ±1% of strike, profit <15%, and
      no blocking event — advisor suggests a haircut-priced replacement front (+14–21 DTE)
- [x] **EXIT-07**: Analyzer shows a held-positions panel with per-calendar verdict chips + the
      exit ruleSet rendered from the engine (entry-methodology symmetry)
- [x] **EXIT-08**: MCP tool answers "what should I do with my open calendars?" with the same
      verdict payloads
- [x] **EXIT-09**: Only verdict CHANGES are surfaced as alerts; STOP and EXIT-pre-event escalate
      distinctly (no alert spam)
- [x] **EXIT-10**: Advisor never executes — advise + alert only (STRM-04 read-only boundary)

### PICK-04 backtest harness

- [x] **BT-01**: Operator CLI replays stored chains (leg_observations since 2026-06-12) through
      the SAME pure entry + exit rule functions with point-in-time correctness (no lookahead;
      as-of ≤T filtering)
- [x] **BT-02**: Replay of a historical cohort reproduces the recorded live picker_snapshot score
      for that cohort (leakage oracle — catches percentile leakage and late-solved-BSM lookahead)
- [x] **BT-03**: Harness reproduces the 13 closed calendars' validated outcomes (direction +
      rough magnitude) with fill-haircut applied on entry AND exit — mechanics validation
- [x] **BT-04**: Per-rule directional attribution + leave-one-rule-out ablation reported with
      every number stamped `n=` and date range; report persisted append-only (backtest_runs)
- [x] **BT-05**: The harness never writes weights — outputs are directional evidence flags a
      human reads; weight promotion stays gated until n≥30 real closed trades

### Playbook gates & sizing

- [x] **PLAY-01**: Market-level crisis gates: picker computes nothing new to enter when VIX ≥ 25
      or VIX/VIX3M ≥ 0.95 (banded/dated — lean penalty-over-cliff per the retired-gate lessons;
      board shows the gate state)
- [x] **PLAY-02**: Anti-criteria brakes: max open calendars, loss cooldown (recent realized loss
      pauses new entries), sustained-trend filter — thresholds from the trade-advisor playbook,
      confirmed with user at phase discuss
- [x] **PLAY-03**: Sizing tiers: recommended contract count per VIX regime tier (discrete,
      user-set — never a derived optimum)
- [x] **PLAY-04**: Event-calendar bucket: second universe path for short-gap (3–10d) calendars
      that intentionally own an event, scored with event-appropriate rules
- [x] **PLAY-05**: autoTuneTargetDelta: VIX-tuned target-delta preference applied to the band
      scan (additive, after crisis-gate infra lands)

### In-app Schwab re-auth wizard (Phase 37, added 2026-07-13)

Operational hardening added mid-milestone: replace the local CLI OAuth dance with an in-app,
banner-driven Reconnect wizard so the operator re-auths Schwab from the browser (or phone)
without a service restart. Requirements derived from `37-CONTEXT.md` locked decisions +
`37-UI-SPEC.md` (no separate discuss-phase requirement IDs existed until now).

- [ ] **REAUTH-01**: Sidecar exposes two admin endpoints — `POST /sidecar/admin/reauth/start`
      (mints a Schwab authorize URL per app via `get_auth_context`, no local callback server)
      and `POST /sidecar/admin/reauth/exchange` (exchanges the returned redirect URL for tokens
      via `client_from_received_url`, written through the existing `token_store` encryption).
      Both endpoints require the `SIDECAR_ADMIN_TOKEN` shared-secret header.
- [ ] **REAUTH-02**: The OAuth CSRF `state` is a single-use Postgres nonce (`reauth_nonces`,
      migration 0024) with a 10-minute TTL, validated AND consumed atomically on exchange
      (`DELETE ... RETURNING`) so a replayed exchange can never succeed twice.
- [ ] **REAUTH-03**: Per-app success is a `refresh_issued_at` freshness re-check (anchored within
      5 minutes), never a bare HTTP 200; the wizard's exchange writer anchors `refresh_issued_at`
      so the AUTH_EXPIRED banner actually clears.
- [ ] **REAUTH-04**: After a successful exchange the sidecar re-inits its Schwab clients AND
      cancels+recreates the streamer/keepalive background tasks in-process while holding the
      advisory lock (no restart, never two live streamer sessions); trader-success + market-failure
      keeps trader's fresh token and offers retry of only the failed app.
- [ ] **REAUTH-05**: The server proxies `/api/reauth/{start,exchange}` behind the existing Supabase
      JWT (operator-only, any authed user), forwarding with the admin-token header; error responses
      are generic (never echo the code/state/redirect URL). No MCP tool mints or exchanges auth
      URLs — this privileged surface is HTTP-only (MCP explicitly scoped out).
- [ ] **REAUTH-06**: The web `AuthExpiredBanner` gains a **Reconnect** button (both red and amber
      states) opening a modal wizard (Trader 1/2 → Market 2/2 per UI-SPEC); on the `morai.wtf`
      callback landing the SPA captures `?code=&state=`, strips them via `history.replaceState`
      before any render, and auto-resumes/exchanges silently; the code/redirect URL never renders
      or logs anywhere in our stack.
- [ ] **REAUTH-07**: Docs + deploy: `stack-decisions.md` records the wizard-as-primary /
      CLI-as-fallback decision; `schwab-reauth-runbook.md` gains the UI path (CLI stays fallback);
      `SIDECAR_ADMIN_TOKEN` + `SCHWAB_WEB_CALLBACK_URL` are set on both Railway services before
      deploy; the next real re-auth (~2026-07-20) is performed through the wizard as the human UAT.

### Live market data via sidecar (Phase 38, added 2026-07-13)

The sidecar becomes the sole LIVE market-data source. Two flows: fan SPX spot out to browsers
as an additive SSE event, and add live VIX-family quotes for the regime rail — DISPLAY-LIVE,
GATE-EOD. Requirements derived from `38-CONTEXT.md` locked decisions (Areas 1 & 2, Q1–Q4);
no separate discuss-phase requirement IDs existed until now.

- [ ] **LIVE-01**: Additive stream contract — `streamSpotEvent {spot, ts}` and
      `streamIndicesEvent {vix, vvix, vix9d, vix3m, ts}` in `packages/contracts/src/stream-events.ts`,
      each `ts` a `z.string().datetime()` that REJECTS `+00:00` and requires a trailing `Z`.
      New events only — `streamLiveGreekEvent`/`streamPingEvent` unchanged so old clients are
      unaffected (CONTEXT Area 1 Q1, WR-03 additive-only precedent).
- [ ] **LIVE-02**: SPX spot is fanned to browsers with ZERO new Schwab calls — the server
      broadcasts the already-arriving `underlyingPrice` (sidecar-sse.ts `observeSpot` site) as a
      named `spot` SSE event, coalesced on-change with a max of ~1 frame/sec per symbol; no
      unchanged-value keepalives (CONTEXT Area 1 Q2). A malformed/late frame never severs the
      stream for other browsers (swallow-and-log, CR-01/T-12-05-04).
- [ ] **LIVE-03**: The sidecar polls `$VIX/$VVIX/$VIX9D/$VIX3M` via `market_client.get_quotes`
      on a fixed ~20s interval (no RTH gate on the poll — CONTEXT Area 1 Q4), reads `lastPrice`
      (bid/ask/mark may be absent for indices), tolerates a per-symbol failure without dropping
      the others, and emits one Z-suffixed `indices` frame onto the existing `event_queue`. The
      exact Schwab ticker strings/response shape are verified live (`get_quotes` smoke test) BEFORE
      the parser is built around them (Assumption A1, Open Question 1).
- [ ] **LIVE-04**: `useLiveStream` exposes `liveSpot`/`liveIndices` on their own freshness stamp
      (a spot-only feed never paints the greeks badge live). EVERY spot surface — header SPX chip,
      Overview payoff spot marker + T+0 recompute, gamma-profile marker, net-greeks, mobile hero —
      reads ONE live-aware spot seam (both `useOverviewModel` spot AND the direct `gex.spot` reads
      in `Overview.tsx` collapse onto it, Pitfall 1). Honest badge: the live value shows ONLY while
      stream status is `live`; quiet/stalled falls back to the stored EOD/snapshot value with
      existing stale styling — never a silent `liveSpot ?? gex.spot` lie (catch #26, CONTEXT Area 2
      Q1/Q2).
- [ ] **LIVE-05**: DISPLAY-LIVE / GATE-EOD LAW — the regime rail's three broker-quotable gauges
      (`vix-term-structure` = VIX/VIX3M, `vvix`, `vix9d-vix` = VIX9D/VIX) display live values with
      band coloring recomputed client-side from the live value against the response's effective
      `bandWarn`/`bandCrisis` (the same `@morai/core` banders the server uses). The entry-gate
      verdict chip, the stored `indicator.band`, and the `/api/analytics/regime` EOD
      `macro_observations` source stay UNTOUCHED; `hy-oas` stays FRED; FRED ingestion is unchanged.
      Live tint only while status is `live`; the "EOD · as of…" footer reverts on quiet/stalled
      (CONTEXT Area 2 Q1/Q2, v1.3 flapping risk #3).

### Regime rail — all rows as gauges + teaching tooltips (Phase 39, added 2026-07-13)

Extend the existing bullet-gauge idiom (Phase 31/38) to the rates block and COT rows, and
rewrite every ⓘ tooltip to teach. Display-only rework — no backend, no contracts, no gate
inputs. Requirements derived from `39-CONTEXT.md` locked decisions + the APPROVED
`39-UI-SPEC.md` (rev 2); no separate discuss-phase requirement IDs existed until now.

- [ ] **GAUGE-01**: The presentational bullet-gauge track (the `role="meter"` markup +
      `axisPct`/`clampedAxisPct` math) is extracted from `RegimeBoard.tsx` into a shared
      `apps/web/src/components/system/BulletGauge.tsx` with `banded` and `neutral` variants.
      The four existing regime rows are refactored onto it with ZERO visual change — the
      existing `RegimeBoard.test.tsx` gauge assertions (meter role, aria-* clamping, band
      segment positions, marker color/testids) stay green UNMODIFIED as the regression guard.
- [ ] **GAUGE-02**: The six rates rows (Fed Funds, SOFR, 1M, 3M, 10Y−2Y, 10Y−3M) render
      bullet gauges. Fed Funds/SOFR/1M/3M are NEUTRAL position-only tracks — marker on a fixed
      0–8% range, plain `bg-line2` track, `bg-dim` marker, NO band segments and NO verdict
      colors (the regime-board evidence law: no verdict-coloring without documented research).
      10Y−2Y/10Y−3M are BANDED via client-side `RATE_BANDS` named constants (calm `> 0.0` /
      warning `≤ 0.0` / crisis `≤ -0.50` `[ASSUMED]`), display-only and evidence-documented —
      never a picker/regime gate input (gate stays blind).
- [ ] **GAUGE-03**: The five COT rows (Dealer, Asset Mgr, Leveraged, Other rept, Non-rept)
      render NEUTRAL direction-tinted bullet gauges — plain `bg-line2` track, no band segments,
      marker `bg-up` when net ≥ 0 / `bg-down` when net < 0 (the existing long/short convention,
      never amber, no warning tier possible). The WoW `▲`/`▼` arrow + signed/magnitude
      formatting are kept; axes are per-class fixed visual ranges. COT net/WoW typography moves
      onto the shared secondary-value tier (11px).
- [ ] **GAUGE-04**: Every gauge row's ⓘ tooltip renders the four-part teaching structure —
      WHAT (plain English) / WHY (SPX-calendar relevance) / BANDS (thresholds, or "position
      only" for neutral) / SOURCE (quiet provenance) — with the copy rendered VERBATIM from
      `39-UI-SPEC.md`'s LOCKED tooltip payload (executors never paraphrase or invent financial
      claims). The four existing regime rows keep their server-provided `source`/`rationale` as
      the SOURCE line; rate/COT rows use the static SOURCE strings authored in the UI-SPEC.
- [ ] **GAUGE-05**: The yield-curve inversion bands for `t10y2y`/`t10y3m` are added to
      `docs/architecture/regime-board.md`'s evidence table BEFORE any component encodes them
      (docs-before-code), with cited threshold rationale (`knowledge-base/grouped-data/macro_rates.md`)
      and an `[ASSUMED]` disclosure on the −0.50 crisis tier. The picker gate and regime-gate
      resolution take ZERO new inputs from these bands — they are a client-visual-only display
      band (rates come from `useMacro`, not `useRegimeBoard`).

### Journal history repair — never lose a calendar's greek/vol story (Phase 40, added 2026-07-14)

The journal's per-calendar 30-min series (greeks, front/back IV, term slope, marks, spot,
P&L) is the product's core value ("why did my calendar act the way it did") — and live data
shows it is starved: both open calendars are 100% gap rows (back-leg NaN), zero rows since
Jul 8, and no calendar has any row before Jul 6 despite `leg_observations` holding the full
chain (marks + BSM greeks) since Jun 12. Live-write-only + "never backfill" turns every
outage, late registration, or stale-leg skip into a permanent hole. Fix the data layer;
the lifecycle chart already renders everything.

- [ ] **HIST-01**: Root-cause and fix the far-dated back-leg NaN — open calendars' back leg
      (e.g. `SPX 261130P07600000`) carries NaN `bsm_iv`/greeks in `leg_observations` while the
      front leg is healthy, which poisons every journal row (`isGap`) and (post-OPS-01) silences
      snapshots entirely. Diagnose where it breaks (contract missing from fetch window / mark
      missing / IV inversion failure / BSM batch starvation) and fix so any leg with a usable
      mark in `leg_observations` gets IV + greeks. Honest-gap law stays: a leg with NO market
      data renders as a gap, never a fabricated value.
- [ ] **HIST-02**: A pure rebuild use-case derives `calendar_snapshots` rows for a calendar
      from historical `leg_observations` — for each 30-min RTH slot between `openedAt` and
      `min(closedAt, now)`, resolve both legs' observations for that slot and build the row
      with the SAME pure functions the live writer uses (`computeLegPairMetrics`,
      `computeSnapshotPnl`) — no formula drift. Fill-only semantics: upserts never overwrite an
      existing non-gap row; gap rows MAY be replaced by healed non-gap rows.
- [ ] **HIST-03**: Self-heal replaces "historical rows are never backfilled": a recurring
      worker job (chained after the existing snapshot/analytics cycle or scheduled) detects
      missing or gap slots for OPEN calendars over a bounded lookback and repairs them from
      `leg_observations` once usable data exists. The OPS-01 live freshness gate stays (never
      write stale marks as fresh) — but a skipped cycle now heals instead of scarring.
- [ ] **HIST-04**: Operator repair path — a CLI (pattern: existing backfill/rebuild CLIs) that
      rebuilds the full journal history for one calendar or all calendars (one-time repair of
      the 17 existing calendars), and registration of a calendar (manual or auto) triggers a
      backfill from its `openedAt` so late registration never loses the entry-day story.
- [ ] **HIST-05**: Series hygiene — at most one scheduled row per 30-min slot per calendar
      (today: hourly NaN row + a near-duplicate recompute row ~10-15 min later inflate the
      series to ~19 rows/day with frozen marks); event-move rows stay distinct via the existing
      `trigger` field; rebuild/self-heal never writes rows outside `openedAt`..`closedAt`.

## Future Requirements

Deferred. Tracked but not in the v1.3 roadmap.

- **Weight promotion/demotion from backtest evidence** — blocked until n≥30 real closed trades
- **Auto roll-order construction** — order-entry boundary; advise only
- **Tick-level exit re-evaluation** — contradicts STRM-04 + 30-min cadence

## Out of Scope

Explicit exclusions with reasoning.

| Feature | Reason |
|---------|--------|
| Auto-execution of exits/rolls | Read-only boundary (STRM-04); Morai never places orders |
| Confidence %/probabilities on verdicts | No calibration basis at n=13 — fabricated precision |
| Backtest DSL / generic strategy language | YAGNI — one trader, one strategy family, one engine |
| Kelly / optimal-f sizing | Needs a reliable edge estimate the sample cannot provide |
| Rule-parameter optimization against the 13 trades | Overfitting formalized; params stay user-locked |
| Per-pair crisis gates (term-inversion revival) | Retired 2026-07-09 — deleted trades with edge; crisis lives at market level |
| ML regime-classification model | Two threshold gates suffice; live advice stays in the trade-advisor plugin |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MACRO-01 | Phase 23 | Complete |
| MACRO-02 | Phase 24 | Complete |
| MACRO-03 | Phase 24 | Complete |
| BOARD-01 | Phase 24 | Complete |
| BOARD-02 | Phase 24 | Complete |
| BOARD-03 | Phase 24 | Complete |
| OPS-01 | Phase 25 | Complete |
| OPS-02 | Phase 25 | Complete |
| EXIT-01 | Phase 26 | Complete |
| EXIT-02 | Phase 26 | Complete |
| EXIT-03 | Phase 26 | Complete |
| EXIT-04 | Phase 26 | Complete |
| EXIT-05 | Phase 26 | Complete |
| EXIT-06 | Phase 26 | Complete |
| EXIT-07 | Phase 26 | Complete |
| EXIT-08 | Phase 26 | Complete |
| EXIT-09 | Phase 26 | Complete |
| EXIT-10 | Phase 26 | Complete |
| BT-01 | Phase 27 | Complete |
| BT-02 | Phase 27 | Complete |
| BT-03 | Phase 27 | Complete |
| BT-04 | Phase 27 | Complete |
| BT-05 | Phase 27 | Complete |
| PLAY-01 | Phase 28 | Complete |
| PLAY-02 | Phase 28 | Complete |
| PLAY-03 | Phase 28 | Complete |
| PLAY-04 | Phase 28 | Complete |
| PLAY-05 | Phase 28 | Complete |
| REAUTH-01 | Phase 37 | Planned |
| REAUTH-02 | Phase 37 | Planned |
| REAUTH-03 | Phase 37 | Planned |
| REAUTH-04 | Phase 37 | Planned |
| REAUTH-05 | Phase 37 | Planned |
| REAUTH-06 | Phase 37 | Planned |
| REAUTH-07 | Phase 37 | Planned |
| LIVE-01 | Phase 38 | Planned |
| LIVE-02 | Phase 38 | Planned |
| LIVE-03 | Phase 38 | Planned |
| LIVE-04 | Phase 38 | Planned |
| LIVE-05 | Phase 38 | Planned |
| GAUGE-01 | Phase 39 | Planned |
| GAUGE-02 | Phase 39 | Planned |
| GAUGE-03 | Phase 39 | Planned |
| GAUGE-04 | Phase 39 | Planned |
| GAUGE-05 | Phase 39 | Planned |
| HIST-01 | Phase 40 | Planned |
| HIST-02 | Phase 40 | Planned |
| HIST-03 | Phase 40 | Planned |
| HIST-04 | Phase 40 | Planned |
| HIST-05 | Phase 40 | Planned |

**Coverage:** 28/28 v1.3 requirements mapped, 0 orphans. Phase order:
23 (VIX3M, first-and-alone) → 24 (regime board) → 25 (ops rider) → 26 (exit advisor) →
27 (backtest, depends on 26) → 28 (playbook gates, depends on 24 + 27).
