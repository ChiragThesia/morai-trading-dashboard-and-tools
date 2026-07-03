# Pitfalls Research — v1.2 Trade Picker & Dashboard Redesign

**Domain:** Options candidate-scoring engine, economic-event calendar, live-dashboard UI
redesign, IV calibration solver, stream watchdog, trade-rules engine — added to an existing
production options-analytics system (Morai).
**Researched:** 2026-07-03
**Confidence:** MEDIUM (project-specific pitfalls HIGH — grounded in existing docs/code;
external domain pitfalls MEDIUM — cross-checked web sources, no official-docs citation)

## Critical Pitfalls

### Pitfall 1: Scoring runs against a stale or partial chain snapshot without saying so

**What goes wrong:**
The picker calls `scoreCalendarCandidates` over the live SPX chain, but the chain fetch is
either (a) minutes old because a 30-min snapshot cron or CBOE-fallback path served it, or (b)
partially populated because the sidecar streamer only tracks ~500 symbols and the picker needs
strikes outside that window. The engine silently scores against a chain that no longer reflects
tradable prices, and the UI shows ranked cards with no visible staleness signal — the user acts
on numbers that were true two snapshots ago.

**Why it happens:**
The existing regression gate "SPX OI=0 → SPY proxy" and the CBOE-UTC-timestamp gotcha both
prove this system already has multiple chain sources with different freshness and correctness
characteristics (live stream, 30-min REST snapshot, CBOE delayed fallback). A new picker built
against "the chain" without pinning which source and its age inherits all of that ambiguity
silently, because none of the existing paths were designed to expose freshness to a scoring
consumer — they were designed to expose freshness to a human reading a journal chart.

**How to avoid:**
- Every chain snapshot fed to the scoring engine carries an explicit `observedAt` timestamp and
  `source` tag (stream / REST-30min / CBOE-fallback); the scoring port signature requires it, not
  optional metadata.
- Define and enforce a max-staleness threshold per source (e.g., stream data > 5 min old is
  treated as REST-tier, not live-tier) — reject or flag scoring runs outside it rather than
  scoring anyway.
- Surface staleness in the picker UI on every ranked card (age badge), not just in a debug log.
- Reuse the CBOE-timestamp-is-UTC lesson explicitly: any new adapter feeding the picker gets a
  timestamp-timezone test before it ships, not after a silent-wrong-answer incident.

**Warning signs:**
- Picker scores differ from the Analyzer's live view for the same expiry pair at the same wall
  clock time with no explanation.
- No `observedAt` field on the data structure the scoring function consumes.
- Manual UAT only tested during RTH with a warm cache — never tested against a cold/stale chain.

**Phase to address:**
Picker engine phase (`scoreCalendarCandidates` + events adapter) — must be a day-one contract
decision, not a hardening pass after the engine works on happy-path data.

---

### Pitfall 2: FwdIV radicand goes negative and the engine either crashes or silently returns garbage

**What goes wrong:**
Criterion 1 in `calendar-selection-criteria.md` requires
`FwdIV = sqrt((T2·σ2² − T1·σ1²)/(T2 − T1))`. Under term-structure inversion (documented
project-wide as a known real condition — see the IV-engine-discrepancy incident, which was
itself triggered by a backwardated read), the radicand goes negative. `Math.sqrt` of a negative
number is `NaN` in JS/TS, which then silently propagates through comparisons (`NaN > 0` is
`false`, `NaN` sorts unpredictably) rather than throwing — a candidate can rank incorrectly (not
crash) with no visible error.

**Why it happens:**
Backwardation is exactly the market state where forward-vol edge signals matter most (front IV
rich vs the curve), so the failure mode is not an edge case to defer — it is a first-class
outcome the scoring engine must classify. Developers reach for `Math.sqrt` first and only notice
the `NaN` problem when a sort order looks wrong, because `NaN` doesn't throw.

**How to avoid:**
- Radicand check is explicit and typed: `radicand < 0` returns a tagged result variant (e.g.
  `{ kind: 'inverted', ... }`), never a bare `NaN` number flowing into comparisons — matches the
  project's `Result<T,E>` / no-`any` discipline already mandated by `.claude/rules/typescript.md`.
  A raw `Math.sqrt(negative)` returning silent `NaN` is exactly what that rule exists to prevent.
- Decide the domain behavior once, in the plan/spec phase, not while coding: does inversion mean
  "exclude candidate", "score zero on this criterion but keep others", or "flag as inverted and
  let criterion 2 (slope) dominate"? Criterion 2 already treats slope-down as "avoid" — the two
  criteria should agree on what inversion means for a candidate's final rank.
- Property-test the FwdIV function directly against inverted-curve fixtures (fast-check, already
  a project dependency) — assert it never returns `NaN` or `Infinity` to a caller.

**Warning signs:**
- A candidate with clearly inverted-looking legs appears mid-pack in rankings instead of
  flagged/excluded.
- `NaN` or `undefined` anywhere in scoring output during manual QA.
- No explicit test fixture with `σ_front > σ_back` and `T_front < T_back` in the same direction
  that produces inversion.

**Phase to address:**
Picker engine phase — same phase as Pitfall 1, since both are core scoring-engine correctness
issues that must be nailed down before wiring real data into the UI.

---

### Pitfall 3: Economic-event dates hardcoded once, then go stale or drift across DST

**What goes wrong:**
FOMC releases at 2:00pm ET, CPI and NFP at 8:30am ET — but "ET" is EST/EDT depending on the
calendar date, and the BLS/Fed publish each year's schedule separately (FOMC meeting calendar,
BLS CPI/NFP schedule) rather than on a fixed recurring rule. A calendar seeded once (e.g. a
static JSON of 2026 dates baked in during this milestone) silently goes wrong in two ways: (a) it
never gets 2027 dates and the event-flag criterion (3/4 in the scoring doc) starts treating
event-adjacent expiries as clean, and (b) if event times are stored as a fixed UTC offset instead
of America/New_York wall-clock, event windows shift by an hour across the March/November DST
transitions.

**Why it happens:**
Both FOMC and BLS publish once-a-year calendars precisely because the underlying schedule isn't
a clean recurring rule (FOMC meets ~8 times a year on irregular dates; BLS release day depends on
month-length and weekday alignment). A developer who hardcodes "2nd Wednesday" or a fixed offset
gets it right for one cycle and wrong for the next, and there's no immediate error — the event
flag just silently stops firing or fires on the wrong day.

**How to avoid:**
- Store event datetimes as `America/New_York` local time + explicit date, converted to UTC at
  read time with the IANA tz database (never as a precomputed fixed UTC offset) — this is the
  same class of bug as the already-documented "CBOE timestamps are UTC not ET" gotcha, just in
  the opposite direction (wall-clock stored, needs correct offset resolution, not a naive one).
- Treat the event calendar as data with a refresh/re-seed process, not a one-time migration.
  Document the annual re-seed step (docs/operations, matching the existing re-auth runbook
  pattern) so "add next year's FOMC dates" doesn't get forgotten the way the phase-15 image
  deploy nearly did.
- Add a startup/cron sanity check: if the last known event date is more than N months in the
  past, log a warning (cheap, catches "we shipped 2026 and it's now 2027" before it silently
  degrades scoring).

**Warning signs:**
- Event dates stored as plain UTC timestamps with no timezone field or IANA identifier.
- No code path that ever adds new dates — the table/JSON was populated once during
  implementation and nothing references updating it.
- Event flag stops appearing on cards that should be flagged, with no error anywhere.

**Phase to address:**
Economic-events adapter phase (picker engine phase, per ROADMAP build-order item 4) — the
timezone-storage decision must be made when the adapter's schema is designed, not discovered
during the first DST transition after ship.

---

### Pitfall 4: Bisection/Newton IV calibration solver hangs or converges to garbage on deep-ITM or illiquid legs

**What goes wrong:**
The scenario-engine per-position IV calibration (v1.2 feature 4) inverts price → IV per leg.
Deep-ITM legs and wide-spread/thin-volume strikes have near-zero vega, which is exactly the
regime where root-finders misbehave: Newton-style updates (`Δσ = f(σ)/vega`) blow up or oscillate
when vega is tiny, and pure bisection converges but can take many iterations or converge to a
technically-valid-but-meaningless IV when the input price itself is unstable (bid/ask spread
wider than the price's sensitivity to vol). The 141-DTE live book noted in project context makes
this concrete: far-dated legs plus any strike drift into deep ITM/OTM is a real, not
hypothetical, path the calibration solver will hit.

**Why it happens:**
Root-finders are usually built and tested against liquid ATM examples where convergence is fast
and unambiguous; the failure modes only show up once real illiquid/deep-ITM data flows through,
which tends to happen after the happy path already shipped.

**How to avoid:**
- Cap iterations and impose a hard convergence tolerance; when the cap is hit, return a tagged
  "solver did not converge" result (same `Result<T,E>` discipline as Pitfall 2) — never return
  the last iterate silently as if it were a valid IV.
- Use mid price, never raw bid or ask, as the solver's price input; the project already knows
  this class of problem from the Schwab-vs-TOS IV discrepancy doc, which names "mid convention"
  as one of the very things different platforms disagree on — be explicit about which convention
  this new solver uses and document it next to the existing discrepancy doc.
- Consider a vega floor: if vega falls below a threshold, don't trust the inverted IV for scoring
  purposes — flag the leg as "illiquid, IV unreliable" rather than feeding a shaky number into
  downstream P&L scenarios.
- Property-test the calibration function against fixtures spanning ATM, deep ITM, deep OTM, and
  near-zero-vega synthetic inputs (fast-check already in the stack) — this is the same testing
  discipline already applied to the BSM engine (BSM-01..03, property-tested).

**Warning signs:**
- Calibration takes visibly longer or times out for specific legs during manual QA.
- Calibrated IV for a deep-ITM leg looks wildly different from a nearby-strike ATM leg's IV with
  no economic explanation.
- No explicit iteration cap / convergence-failure path in the solver's type signature.

**Phase to address:**
Overview v2 redesign + scenario-engine IV calibration fix phase (ROADMAP build-order item 2) —
this is named as a "fix," implying the existing behavior already has a known gap; the pitfall is
fixing the visible symptom without adding the convergence-failure and mid-price-convention
guards that prevent the next silent-wrong-number incident.

---

### Pitfall 5: Stream stall watchdog false-positives during legitimately quiet markets, or worse, stays silent during a real stall

**What goes wrong:**
A naive watchdog ("no message received in N seconds → mark stream down") either fires constantly
during low-volume periods (lunch lull, pre-open, holiday-adjacent sessions) — training the
operator to ignore or disable the alert — or, tuned too loose to avoid that, fails to catch the
actual silent-stall failure mode this feature exists to fix (the v1.1 known-debt item: "no
silent-stall watchdog on the live stream," where the UI badge lies "LIVE" while data is frozen).

**Why it happens:**
Message cadence on a live options/position stream is inherently bursty and volume-dependent —
there is no fixed "should have received a message by now" interval that's correct both during
RTH price action and during a quiet open-position hold with no ticks. Watchdogs built around raw
silence duration conflate "no new data because market is quiet" with "no new data because the
connection died," which are operationally very different and require different responses.

**How to avoid:**
- Decouple the watchdog from market-data cadence: use an app-level heartbeat/ping-pong on the
  stream transport itself (the sidecar's SSE fan-out), independent of whether position/option
  data actually changed — a heartbeat proves the pipe is alive even when there's nothing to say.
- Distinguish RTH from non-RTH in the watchdog's expectations: during RTH, an absence of *any*
  message (heartbeat or data) for the timeout window is a real stall; outside RTH, only the
  heartbeat channel needs to be checked, not data cadence.
- Make the watchdog state visible and distinct from "LIVE": e.g. `LIVE` / `QUIET` (heartbeat ok,
  no data) / `STALLED` (heartbeat missed) — this directly fixes the documented v1.1 gap where the
  badge only knows `LIVE` vs `disconnected`, not `frozen-but-still-connected`.
- Test the false-stall path explicitly: replay a known quiet-market fixture (or a synthetic
  heartbeat-only period) through the watchdog and assert it does NOT fire — the project's
  Phase-12 test-3 harness pattern (CDP-offline EventSource injection) is the reusable template
  for simulating stream conditions in tests; extend it to simulate quiet-vs-dead instead of only
  online-vs-offline.

**Warning signs:**
- Watchdog fires during known-quiet historical windows in a replay test.
- Watchdog has a single timeout constant with no RTH/non-RTH branch.
- No test exercises the "connected but frozen" state distinctly from "disconnected."

**Phase to address:**
Tail phase item "live-stream stall watchdog" (ROADMAP build-order item 5) — but the RTH-vs-quiet
distinction and heartbeat-vs-data-cadence decoupling must be a design decision made before
implementation starts, since retrofitting it after a naive silence-timeout ships means re-doing
the state machine, not just tuning a constant.

---

### Pitfall 6: Big-bang Analyzer→picker and Overview v2 rewrites break working screens for weeks

**What goes wrong:**
Both UI redesigns (Overview v2 "TOS dock" and Analyzer→picker "ranked-cards rail") replace
screens that are in daily personal use by the sole user (this is a live trading tool, not a
staging demo). A full rewrite-and-cutover approach means the old Analyzer/Overview is frozen (no
bug fixes land there) for the full redesign duration, and the new screen must be 100% functionally
complete before it can replace the old one — any missed feature is discovered only at cutover,
when the fallback is "revert the whole redesign."

**Why it happens:**
UI redesigns feel like all-or-nothing changes because the visual language changes completely
(new mockup, new layout), which tempts a wholesale replace-the-route approach instead of an
incremental one. This is a known-failure pattern broadly: big-bang rewrites commonly run over
time/budget estimates and deliver zero value until the entire thing is done, with an all-or-
nothing cutover risk.

**How to avoid:**
- The project's own build order already mitigates this by sequencing: Overview v2 ships to prod
  *before* picker work starts (ROADMAP item 2 vs item 3/4), and the Analyzer→picker redesign is
  built "against candidate-contract fixtures/stubs (contract-first; engine fills it later)"
  (ROADMAP item 3) — this is already a strangler-style incremental approach; preserve that
  discipline rather than collapsing the two ROADMAP items into one big rewrite PR.
  - Reject the temptation to also swap the real scoring engine in during the same PR/phase as the
    UI redesign — ROADMAP already separates "redesign against stubs" (item 3) from "wire real
    engine" (item 4); don't recombine them under schedule pressure.
- Ship each redesign behind a route/flag if feasible so the old screen stays reachable until the
  new one is verified in real use, not just in UAT — single-user apps still benefit from a quick
  revert path when "verified in daily trading use" is the real bar, not a demo click-through.
- Explicitly re-run the existing regression gates (SPX OI=0 proxy, GEX put-sign, CBOE-UTC) against
  the redesigned screens — a UI rewrite that touches how data is fetched/rendered can silently
  reintroduce a previously-fixed display bug even if the underlying API contract didn't change.

**Warning signs:**
- A single PR/phase touches both visual redesign and the data source it renders.
- No way to view the old screen once the new one is merged (no flag, no parallel route).
- UAT only covers the new screen's happy path, not the existing regression-gate scenarios.

**Phase to address:**
Overview v2 redesign phase and Analyzer→picker redesign phase (ROADMAP items 2 and 3) — the
contract-first stub approach is already the plan; the risk is scope creep collapsing it back into
a big-bang change during execution.

---

### Pitfall 7: Strategy-rules engine (L4) grows into a generic rules DSL nobody but this milestone needs

**What goes wrong:**
The stated goal is narrow: "record the enter/exit/roll RULES per trade + which rule fired" for a
single user's SPX calendar strategy (backlog note, ROADMAP). It's easy to over-deliver: a
generic condition/action rule engine with configurable operators, rule priorities, a rule editor
UI, versioned rule sets, etc. — none of which is needed when there is exactly one strategy, one
user, and the actual requirement is closer to "an enum of rule types + a text field for which one
fired + an attach point on `entry_thesis`."

**Why it happens:**
"Rules engine" as a term pattern-matches to generic business-rule-engine architectures from
enterprise software, which is a much bigger and more general problem than "record which of a
short, closed list of trading rules caused this action." The generality tax (rule DSL parser,
condition combinators, priority resolution) buys configurability nobody asked for — the YAGNI
failure mode of adding structure for hypothetical future rule types before a second concrete rule
type ever appears.

**How to avoid:**
- Re-read the actual requirement before designing: it's a ledger/attribution feature (L4 in the
  documented 4-layer model: ledger → greeks time-series → attribution → rules), not a rules
  execution engine — the system does not need to *evaluate* rules against live data and act, it
  needs to *record* which named rule the human judged fired, alongside the entry thesis.
  Attribution (L3) is the analytical layer that already computes θ/vega/δ/event decomposition;
  the rules layer is a thin recording layer over the ledger, not a decision engine.
  Confirm this scope boundary explicitly in the phase's plan doc before implementation.
- Start with a closed enum of rule types (whatever's in the trader's actual playbook today) plus
  a free-text field for anything unanticipated, rather than a fully generic condition grammar. Add
  structure only when a second real trade surfaces a pattern that the enum can't express.
  - Reuse the existing `entry_thesis` attach point (Phase 5 D-07) rather than inventing a new
    schema alongside it — this was flagged as the minimal attach point already; extending it is
    the low-risk path.
- Defer any "improve the algo" analysis (the stated end-goal — see which rules correlate with
  good outcomes) to a query/read-side concern over recorded data, not a feature of the
  rules-recording write path.

**Warning signs:**
- The rules schema has a generic `condition` field (JSON logic, expression string) instead of a
  closed enum plus free text.
- Any UI for "editing rule definitions" exists before a second rule type has actually been used.
- The phase plan describes evaluating/firing rules automatically rather than recording a human
  judgment about which rule fired.

**Phase to address:**
Strategy-rules engine (L4) tail phase (ROADMAP build-order item 5) — the scope boundary must be
set at spec/plan time; this is the phase most likely to balloon without an explicit "closed enum,
not a DSL" constraint written into its plan.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Ship picker scoring without an `observedAt`/staleness field, add it later | Faster first cut of `scoreCalendarCandidates` | Retrofitting staleness into every call site + UI card after the fact; silent-stale-score incidents in the meantime | Never — add the field on day one, it costs nothing when the type exists from the start |
| Hardcode 2026 FOMC/CPI/NFP dates as static JSON, defer the refresh mechanism | Unblocks event-flag criterion this milestone | Silently stops flagging events after year-end with no error | Acceptable for this milestone ONLY if a startup staleness-warning check ships alongside it (cheap) so the gap is visible, not silent |
| Skip the solver-non-convergence tagged result, return best-effort IV | Simpler calibration function signature | A downstream scenario P&L silently uses a garbage IV from an illiquid deep-ITM leg | Never for the calibration solver — this is exactly the class of bug the IV-discrepancy incident already cost a wrong trade decision |
| Ship the watchdog with a single fixed silence timeout, tune RTH/non-RTH split later | One state machine instead of two | Alert fatigue (false positives) trains the operator to ignore/disable it before the RTH split ever ships | Acceptable only as a very short-lived first cut behind a flag the operator can mute; must not be the shipped state |
| Build the Analyzer→picker redesign and the real scoring engine in the same phase | Fewer phase-transition overheads | Collapses the contract-first isolation the ROADMAP already planned; a scoring bug and a UI bug become indistinguishable during UAT | Never — ROADMAP already separates these into items 3 and 4, keep it that way |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|--------------------|
| Economic-event calendar (FOMC/CPI/NFP, no existing adapter) | Storing event times as fixed UTC offsets baked in at seed time | Store as `America/New_York` local wall-clock + IANA tz conversion at read time; matches lesson already learned the hard way with CBOE-UTC timestamps (just inverted direction) |
| Live SPX chain feed → picker scoring | Scoring engine reads whichever chain source happens to be freshest without recording which one | Scoring port requires an explicit `source` + `observedAt` on every input snapshot; reject/flag scoring against stale or CBOE-fallback data rather than treating all sources as equivalent |
| Sidecar SSE stream → watchdog | Watchdog inspects only option/position data messages for cadence | Add a transport-level heartbeat independent of data messages; watch heartbeat cadence, not data cadence, to distinguish "quiet" from "dead" |
| Scenario-engine IV calibration → BSM engine | New calibration solver reuses ad hoc `Math.sqrt`/Newton math instead of the project's existing property-tested BSM/solver module | Extend the existing BSM engine's solver conventions (mid-price input, documented in `docs/iv-engine-discrepancy-and-solver.md`) rather than writing a parallel, untested root-finder |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Scoring engine re-fetches/recomputes the full chain per candidate instead of once per scoring run | Picker UI feels sluggish as candidate count grows; redundant DB/API calls | Fetch chain once per scoring invocation, pass the snapshot down to all per-candidate scoring functions as pure input | Noticeable once the strike-enumeration-by-delta-target approach expands candidate count beyond a handful |
| Bisection solver with no iteration cap runs unbounded on a pathological illiquid leg | One bad leg stalls the whole scenario calibration request | Hard iteration cap + convergence-failure result type (see Pitfall 4) | First time a real illiquid deep-ITM leg hits the live book — plausible given the 141-DTE live positions already noted |
| Watchdog polling on a tight interval to catch stalls fast | Unnecessary CPU/log churn on a single-user, low-throughput system | Heartbeat-driven detection (event-based) rather than tight polling loops | Not a real scale concern for this project (single user), but tight polling still adds noisy logs that mask real signals during debugging |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Economic-event or scoring data pulled from a new third-party API without going through the existing adapter/port boundary | Bypasses the hexagonal boundary law (core imports only shared); a vendor-specific detail leaks into `packages/core` | New economic-events source is a driven adapter (`packages/adapters`) behind a port, same pattern as CBOE/Schwab — enforced by existing ESLint boundary rules |
| Rules-engine or picker feature adds a new unauthenticated route by accident while iterating quickly on UI | Same single-bearer-token/Supabase-JWT model must apply; a forgotten auth gate mirrors the Phase-8 `/api/status` healthcheck auth-gate bug already hit once in this project | Every new HTTP + MCP route pair follows the same auth pattern as existing routes; verify with the same checklist that caught the prior gate bug |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Ranked picker cards show a score with no indication of chain staleness or which criteria drove the rank | User trusts a number that may already be stale, or can't tell why one candidate outranked another | Surface `observedAt` age + a per-criterion breakdown (matches the scoring table's per-criterion structure already designed in `calendar-selection-criteria.md`) directly on the card |
| Watchdog badge only distinguishes LIVE vs disconnected | User can't tell "frozen but still connected" from "genuinely live," which is the exact v1.1 known gap this feature exists to close | Three-state badge: LIVE / QUIET (idle, heartbeat ok) / STALLED (heartbeat missed) |
| New Overview/Analyzer screens ship without a way to see the old layout during the transition | If a redesigned screen has a subtle regression, the only recovery is a full revert/redeploy | Flag or parallel route to fall back to the old screen without a deploy, at least until the new screen has survived a few real trading days |

## "Looks Done But Isn't" Checklist

- [ ] **Picker scoring engine:** Often missing an explicit chain-staleness contract — verify
  every scoring call records `source` + `observedAt` and the UI renders it, not just that scores
  compute correctly on a warm cache.
- [ ] **FwdIV / calibration solvers:** Often missing the negative-radicand / non-convergence
  path — verify with fixtures that force inversion and near-zero vega, not just typical ATM
  inputs; confirm neither path returns `NaN`/`any` silently.
- [ ] **Economic-events adapter:** Often missing timezone-correct storage and a refresh path —
  verify dates are stored with an explicit IANA timezone (not a bare UTC timestamp) and that
  there's a documented process for adding next year's dates.
- [ ] **Stream watchdog:** Often missing the RTH-vs-quiet distinction — verify a replay of a
  known quiet period does NOT trigger a false stall, and a replay of a genuine stall during RTH
  DOES trigger.
- [ ] **UI redesigns:** Often missing a re-run of the existing regression gates (SPX OI=0 proxy,
  GEX put-sign, CBOE-UTC) against the new screens — verify these are in the phase's verification
  checklist explicitly, not assumed still-passing because the API didn't change.
- [ ] **Strategy-rules engine:** Often missing an explicit scope boundary — verify the schema is
  a closed enum + free text, not a generic rule/condition grammar, before calling the phase done.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|-----------------|
| Scoring silently used stale chain data | LOW | Add the `observedAt`/`source` field retroactively (it's additive), backfill nothing (scores were never stored as history at this stage), re-verify against a live snapshot |
| FwdIV `NaN` shipped to prod | MEDIUM | Patch the radicand guard, add the fixture test that would have caught it, audit any persisted picker results for the affected window and re-score |
| Event calendar goes stale after year-end | LOW | One-time re-seed of the new year's dates; add the startup staleness-warning check so this doesn't recur silently |
| Watchdog alert fatigue led operator to mute it | MEDIUM | Re-tune with the RTH/quiet split, replay historical quiet-period fixtures to prove no false positives before re-enabling, communicate the change (single user, so this is a personal runbook update) |
| Big-bang UI rewrite broke a working screen | HIGH | Revert to old screen via flag/route if one exists (cheap); if not, full redeploy of the prior version while the redesign is fixed forward — this is precisely why a flag/parallel-route is worth the small upfront cost |
| Rules engine over-built into a generic DSL | MEDIUM | Strip down to closed enum + free text; migrate any already-recorded generic-condition data into the enum, accept some information loss for entries that don't map cleanly |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Stale/partial chain scoring | Picker engine phase | Scoring port type requires `observedAt`+`source`; UAT includes a deliberately-stale-snapshot scenario |
| FwdIV radicand < 0 | Picker engine phase | Property test with inverted-curve fixtures asserts no `NaN`/`Infinity` output |
| Event-date timezone/revision errors | Economic-events adapter (picker engine phase) | Unit test asserts correct UTC conversion across a DST boundary date; startup staleness-warning check exists |
| Bisection/Newton non-convergence | Overview v2 + scenario-engine IV calibration fix phase | Property test spanning ATM/deep-ITM/deep-OTM/near-zero-vega fixtures; convergence-failure result type covered by a test |
| Watchdog false positives / missed stalls | Tail: live-stream stall watchdog phase | Replay tests for both a known-quiet period (no false trigger) and a simulated RTH stall (trigger) |
| Big-bang UI rewrite risk | Overview v2 + Analyzer→picker redesign phases | Contract-first stub approach preserved per ROADMAP; existing regression gates re-run against new screens before ship |
| Over-engineered rules engine | Strategy-rules engine (L4) tail phase | Plan doc states closed-enum-plus-free-text scope explicitly; UAT rejects any PR introducing a generic condition grammar |

## Sources

- Project-internal (HIGH confidence, ground truth):
  - `.planning/PROJECT.md` — v1.2 scope, known debt, constraints
  - `.planning/research/calendar-selection-criteria.md` — verified/refuted scoring criteria,
    FwdIV formula and inversion guard, event-premium criteria
  - `docs/iv-engine-discrepancy-and-solver.md` — mid-price convention, no-canonical-IV root
    cause, solver design precedent
  - `.planning/ROADMAP.md` — v1.2 build order, strategy-rules-engine backlog note (L4, 4-layer
    model), event-triggered-snapshot backlog note
  - `packages/core/src/analytics/`, `packages/core/src/streaming/` — existing BSM/GEX/streaming
    module boundaries the new features must extend, not duplicate
- Web (MEDIUM confidence, cross-checked across multiple independent results per topic):
  - Federal Reserve meeting calendar pages — FOMC 2:00pm ET release convention
  - BLS schedule pages (bls.gov/schedule) — CPI/NFP 8:30am ET release convention, annual
    schedule + revision practice
  - Interactive Brokers Quant News, HyperVolatility (Medium) — Newton-Raphson near-zero-vega
    non-convergence, bisection-fallback hybrid solver pattern
  - websocket.org, oneuptime.com, websockets.readthedocs.io — heartbeat/ping-pong timeout
    best practices, false-positive watchdog patterns
  - ThetaScanner, general options-screener vendor docs — stale-snapshot and illiquid-hit pitfalls
  - Strangler Fig pattern write-ups (Medium, algomaster.io, Future Processing) — big-bang vs
    incremental rewrite risk comparison
  - YAGNI references (lawsofsoftwareengineering.com, GeeksforGeeks) — premature-configurability
    over-engineering pattern

---
*Pitfalls research for: Morai v1.2 Trade Picker & Dashboard Redesign*
*Researched: 2026-07-03*
