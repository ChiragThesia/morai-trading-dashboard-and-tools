# Phase 19: Picker Engine + Economic Events - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the Phase-18 **fixture** behind the ranked-cards picker with a **real
`scoreCalendarCandidates` engine** (core domain) plus a **new economic-events context**.
The engine scores put-calendar candidates over the latest chain + GEX snapshot into the
**already-frozen `pickerSnapshotResponse` contract** (Phase 18, `packages/contracts/src/picker.ts`);
the Analyzer UI swaps its synchronous fixture import for live async data with **no layout change**.

In scope (PICK-01/02/03):
- `scoreCalendarCandidates` (core) over the 8 verified criteria from
  `calendar-selection-criteria.md`; REFUTED criteria never encoded (contract `breakdown` enum
  is already closed to them); FwdIV radicand<0 → tagged guard, never NaN.
- A **precomputed, chain-triggered** compute-picker job → `picker_snapshot` table (append-history);
  `GET /api/picker/candidates` HTTP route + `get_picker_candidates` MCP tool read the latest row.
- A **new economic-events module + table** (FOMC/CPI/NFP, IANA tz, cron-refreshed) feeding per-leg
  event-window flags into scoring; internal-only — flags ride inside the candidates payload, no
  separate events API/MCP surface.
- UI fixture→live swap: loading/error/empty/stale states the synchronous fixture never had.

Out of scope (deferred):
- REFUTED criteria (IV-rank gates, −1..−3% IV-diff band, debit-%-of-back band) — never encoded.
- PICK-04 slope-signal backtest over `leg_observations`; PICK-05 event-premium surprise weighting.
- Any separate economic-events HTTP/MCP surface (v1.2 lock).

</domain>

<decisions>
## Implementation Decisions

### Candidate universe (PICK-01)
- **D-01:** Strikes = **delta-targeted OTM puts** — ATM + ~30Δ/20Δ/10Δ (research criterion 5:
  parameterize by delta, not raw strike; CML precedent). GEX proximity stays a **scoring** bonus
  (criterion 7), keeping selection and scoring cleanly separated. Exact delta rungs = planner.
- **D-02:** Expiry pairing — front leg **≥21 DTE at entry (typically 21–30), flexible**; back leg
  ≥21 days beyond front. User: "multitude of DTE… we like at least 21–30 for front usually. Refine
  this, go with some default for now." Planner picks a concrete default grid; keep it tunable.
- **D-03:** Response carries **top-N ranked 6–8** by score (matches the playground-v4 mockup card
  count the UI already renders). Planner sets the exact cap.

### Compute model (PICK-01/02)
- **D-04:** **Precomputed, chain-triggered job** (user choice over on-demand). A `compute-picker`
  job runs after `compute-gex-snapshot` (needs the GEX context for criterion 7), scores over the
  latest chain + GEX snapshot, and writes a `picker_snapshot` row. The HTTP route + MCP tool just
  read the latest row. Staleness = the stored snapshot's `observedAt`. Matches the existing
  GEX/analytics precompute architecture. New: table + job + trigger wiring.
- **D-05:** `picker_snapshot` stores the **whole `pickerSnapshotResponse` as one Zod-validated
  JSONB blob** (read-whole, no query-by-inner-field need; contract stays the single shape).
- **D-06:** **Keep history** — append one blob per `observedAt` (~13/day RTH). Consistent with the
  project's journal-history ethos and hands PICK-04 (slope backtest) free training data. Route
  reads latest.

### Scoring formula fidelity (PICK-01)
- **D-07:** The **mockup `buildCandidates()` (playground-v4.html lines 246–284) IS the engine to
  port + generalize** into `packages/core` (generalize its hardcoded strikes/spot to D-01's
  delta-targeted selection over the live chain; reuse `@morai/quant` BSM for greeks/pricing).
- **D-08:** Encode the mockup weights **40 slope / 25 fwdEdge / 15 gexFit / 10 event / 10 beVsEm**
  as **documented named-constant tunables** ("not empirically calibrated — tune later PICK-04/05").
  Shipped rankings then match the approved mockup. No reweighting up front.
- **D-09:** Replace the faked 5th term. The mockup fakes `beVsEm` with a crude ATM-vs-OTM strike
  preference (`K===7500?1:0.7`); Phase 19 **computes the real BE-vs-EM ratio** (breakeven-width ÷
  ±1σ expected-move) with a documented-tunable threshold. Research flags the *threshold* (not the
  metric) as uncalibrated. No faked term ships under a name that lies about what it measures.

### Event-flag semantics (PICK-01/03)
- **D-10:** A leg **"spans" an event** when the event date falls in **`(today, legExpiry]`** — the
  whole remaining life (matches the mockup `legEvents()` + the research word "spans"). Simple,
  conservative, no extra tunable window param.
- **D-11:** **Front-leg-only penalty** (research criterion 4: front realized-vol spike ≈ max loss;
  back-leg events are informational/displayed only). Default: penalize **all three FOMC/CPI/NFP**
  with **documented per-event tunable weights** (default 0.5, gentler for NFP allowed). User: "you
  decide" — planner sets which events penalize; default all-three-tunable.

### Economic-events module (PICK-03) — RESEARCH REQUIRED
- **D-12:** **Do NOT settle for a hand-edited static FOMC seed.** User: "build a module that handles
  this right and saves things in our DB as a new table. Proper external module that gets the dates
  accurate… maybe Schwab can give us this. **Research is required.**" → **RESEARCH the most accurate
  programmatic source** for FOMC/CPI/NFP dates (candidates: **Schwab market-data**, **FRED
  `releases/dates`** for CPI/NFP, **Fed/BLS** published schedules). Prefer an authoritative external
  feed → new DB table (IANA tz). **A static hand-maintained FOMC seed is the FALLBACK only if no
  reliable programmatic source exists.** This revisits PICK-03's "static hand-refreshed FOMC seed"
  wording — user authority overrides the roadmap phrasing.
- **D-13:** New economic-events **table + adapter** (NOT the existing `calendar_events`, which is the
  journal's OPEN/CLOSE/ROLL events). Follow the `macro_observations` / `fetch-cot` adapter+cron
  patterns. Existing `fred.ts` only hits `series/observations` — a `releases/dates` endpoint would
  be a new method on it (if FRED wins the research).
- **D-14:** Cron cadence **weekly** (user "you decide" → default to the `fetch-cot` Friday cadence;
  CPI/NFP schedules publish far ahead, weekly refresh is ample, keeps the worker cron table uniform).

### Snapshot source + staleness (PICK-01/02, success criterion 3)
- **D-15:** **Add a `source` field** to `pickerSnapshotResponse` — additive, non-breaking, mirroring
  the chain pipeline's provider provenance (**enum `schwab` | `cboe`**: Schwab primary vs CBOE
  fallback — the same distinction silently masked before). Satisfies PICK-01's `observedAt/source`
  requirement, which the frozen contract's `asOf`-only shape doesn't meet. The Phase-18 fixture
  gains a `source` value.
- **D-16:** **Per-card staleness** (user choice over one header chip). Each candidate card shows the
  snapshot's as-of + source so every card is self-contained. (All cards share one snapshot; user
  explicitly wants it repeated per card.)

### Degraded-context honesty (PICK-01)
- **D-17:** When the **GEX snapshot** is stale/missing (criterion 7) or the **econ-events table** is
  empty/stale at compute time (cold start / the research-risky feed failed), **tag it — never
  silent**. Additive **snapshot-level status fields** on `pickerSnapshotResponse`
  (e.g. `gexContextStatus` / `eventsContextStatus`: `ok` | `stale` | `missing`); the affected term
  contributes 0 **and** the UI shows "GEX unavailable" / "events unavailable". Mirrors the fwdIv
  guard so a falsely-clean score never ships (this is exactly the false-clean the research warns of).

### Live-data states (PICK-02)
- **D-18:** **Distinct honest empty messages** — cold-start (no `picker_snapshot` row yet):
  "Picker warming up — first scoring run pending." Snapshot present but 0 candidates passed the
  net-θ>0 filter (criterion 6): "No put calendars meet net-θ>0 over the {asOf} snapshot." Never a
  blank rail; tell the user *why*.
- **D-19:** Loading + fetch-error **mirror the existing react-query hook pattern** (`useCot` /
  `useMacro`): loading skeleton in the ranked rail, error card with retry. User "you decide" →
  default to the established pattern; zero new pattern.

### Claude's Discretion
- Exact delta rungs (D-01), the concrete default DTE grid (D-02), the top-N cap value (D-03),
  score-tie determinism (stable sort by id), and fixture retention-for-tests — planner's call.
- Which events penalize + exact per-event penalty weights (D-11) — planner, default all-three-tunable.
- Cron cadence exact time (D-14) — planner, default weekly Friday like `fetch-cot`.
- `get_picker_candidates` MCP return **mirrors the HTTP `pickerSnapshotResponse`** (MCP-02
  one-schema) — the trimmed-text-summary alternative was dropped.
- Precise `picker_snapshot` DDL, index, and pruning policy for the append-history table (D-06).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 19 entry (goal + PICK-01/02/03 success criteria)
- `.planning/REQUIREMENTS.md` — Picker Engine section (PICK-01/02/03) + the "Out of Scope" and
  "Refuted must-never-encode" rows
- `.planning/phases/18-analyzer-picker-ui-redesign/18-CONTEXT.md` — the contract-first decisions
  (D-01 rich contract, D-02 reuse `repriceScenario`, D-03 fixture) the engine now fills

### Scoring research (the engine's spec)
- `.planning/research/calendar-selection-criteria.md` — the 8–9 verified criteria + the 6 REFUTED
  ones + open questions (BE-vs-EM/θ/vega thresholds uncalibrated; Vasquez slope backtest = PICK-04).
  **The "New data requirement" section (economic event calendar) is the D-12 research seed.**

### Design target + the engine to port
- `mockups/playground-v4.html` — **variant B is the shipped design**; **`buildCandidates()` (lines
  246–284) + `fwdIV()`/`legEvents()` (238–244) are the reference engine to port + generalize (D-07)**.
  Score formula lives here (lines 267–271).

### The frozen contract (this phase touches it — additive only)
- `packages/contracts/src/picker.ts` — `pickerSnapshotResponse` + `pickerCandidate` + `breakdownEntry`
  (closed enum). Phase 19 **adds** `source` (D-15) and `gexContextStatus`/`eventsContextStatus`
  (D-17) — additive, non-breaking. Fixture `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts`
  updates to satisfy the new fields.

### In-repo reuse targets
- `apps/web/src/screens/Analyzer.tsx` — the picker screen; swaps `pickerSnapshotFixture` import →
  live react-query fetch (D-18/D-19). Currently 100% synchronous fixture-driven.
- `apps/web/src/lib/scenario-engine.ts` (`repriceScenario`) + `PayoffChart` — payoff/EM reuse (from Phase 18).
- `@morai/quant` (BSM greeks/pricing kernel) — the engine's greeks/debit math (D-07).
- `packages/adapters/src/http/fred.ts` — existing FRED `series/observations` adapter (a
  `releases/dates` method would extend it, if FRED wins D-12 research).
- `packages/adapters/src/memory/macro-observations.ts` + `postgres/repos/macro-observations.ts` +
  migration `0013_macro_observations.sql` — the adapter+repo+migration pattern for the new
  economic-events table (D-13).
- `apps/worker/src/schedule.ts` — `fetch-cot` weekly cron + the chain-trigger wiring
  (snapshot-calendars→compute-analytics→compute-gex-snapshot) the `compute-picker` job hooks after (D-04/D-14).
- `apps/server/src/adapters/mcp/tools.ts` — where `get_picker_candidates` MCP tool lands.

### Rules (mandatory)
- `.claude/rules/architecture-boundaries.md` — core imports shared only; contracts import zod+shared;
  adapters thin; new use-case ⇒ HTTP route + MCP tool + in-memory twin in the same PR.
- `.claude/rules/tdd.md` — red→green; **numerical code (scoring, FwdIV, BE-vs-EM) needs fast-check
  property tests**; Postgres repos use testcontainers; FRED/external HTTP uses msw.
- `.claude/rules/typescript.md` — no `any`/`as`/`!`; `Result<T,E>`; Zod at boundaries.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`mockups/playground-v4.html` `buildCandidates()`** — a complete, working scoring engine (fwdIV
  identity + guard, θ>0 filter, GEX-fit tiers, event penalty, dedupe, top-8). Port + generalize into
  core rather than invent (D-07). Constants at lines 267–271 become named tunables (D-08).
- **`@morai/quant` BSM kernel** — greeks + put pricing the engine needs (net θ/vega/delta, debit).
- **`fred.ts` / `macro-observations` adapter+repo+migration trio** — the exact shape for the new
  economic-events adapter (D-13); msw + testcontainers patterns already established.
- **`fetch-cot` cron + chain-trigger graph in `schedule.ts`** — model for the weekly events cron
  (D-14) and the `compute-picker` chain-trigger after `compute-gex-snapshot` (D-04).
- **`useCot` / `useMacro` react-query hooks** — the loading/error pattern the picker swap mirrors (D-19).

### Established Patterns
- Precompute-then-read: heavy analytics run as chain-triggered jobs writing snapshot rows; routes
  are thin readers. The `compute-picker` job (D-04) follows this exactly.
- Contract-first: the frozen `picker.ts` is the single shape for engine output + HTTP + MCP; Phase 19
  only makes **additive** field changes (D-15/D-17) so the UI swap stays import-only for layout.
- Guard-tag-never-silent: `fwdIvGuard` set the precedent; D-17 extends it to GEX/events context.

### Integration Points
- New: `economic_events` table + adapter (memory twin + postgres repo + migration + msw HTTP source).
- New: `picker_snapshot` table (append-history JSONB) + `compute-picker` job chained after
  `compute-gex-snapshot`, reading the chain snapshot + GEX + economic-events context.
- New: `GET /api/picker/candidates` route + `get_picker_candidates` MCP tool (both read latest
  `picker_snapshot`, both type to `pickerSnapshotResponse`).
- Edit: `packages/contracts/src/picker.ts` (+`source`, +context-status fields) + fixture; `Analyzer.tsx`
  fixture→live swap + new states.

### Constraints
- **Zero new dependencies** (v1.2 lock) — native controls / existing primitives only.
- Core imports `shared` only; contracts import `zod`+`shared`; Drizzle confined to `adapters/postgres`.
- TDD red→green; fast-check for the scoring/FwdIV/BE-vs-EM math; testcontainers for the two new repos;
  msw for the events HTTP source.
- REFUTED criteria must never be encoded (the `breakdownEntry` enum already structurally excludes them).

</code_context>

<specifics>
## Specific Ideas

- The engine is the **mockup made real**: port `buildCandidates()`, generalize hardcoded
  strikes/spot to delta-targeted selection over the live chain, keep the 40/25/15/10/10 weights as
  the shipped default so the screen reads like the approved mockup.
- **Real BE-vs-EM** replaces the mockup's faked ATM-strike proxy — the one place the engine should
  be *more* honest than the mockup, not a faithful copy.
- The **economic-events source is the risky, research-gated part** — the user explicitly wants it
  "done right" from an accurate external feed (Schwab? FRED? Fed/BLS), not a hand-typed seed. If the
  feed is unavailable at compute time, scoring tags "events unavailable" rather than scoring falsely
  clean (D-17).
- Staleness is honesty-first throughout: per-card as-of+source (D-16), `source` provenance (D-15),
  degraded-context tags (D-17), distinct cold-start vs empty messages (D-18).

</specifics>

<deferred>
## Deferred Ideas

- **PICK-04** — slope-signal backtest over `leg_observations` (validate Vasquez on SPX time-series).
  The append-history `picker_snapshot` table (D-06) is the free data seed for it. Not this phase.
- **PICK-05** — event-premium weighting by surprise magnitude (research open question). Event terms
  ship as simple flags/penalties (D-10/D-11) this phase.
- **Separate economic-events HTTP/MCP surface** — explicitly out of scope for v1.2 (PICK-03:
  internal-only, flags ride in the candidates payload).
- **Screener filters** (strike-view all/ATM/put-wall, DTE-range user filter) — Phase-18 deferred;
  revisit once live candidates exist. Not required by PICK-01/02/03.
- **Empirical calibration** of the weights + BE-vs-EM / θ/vega thresholds — research backlog; Phase 19
  ships documented tunables (D-08/D-09), not validated numbers.

None beyond the above — discussion stayed within phase scope.

</deferred>

---

*Phase: 19-picker-engine-economic-events*
*Context gathered: 2026-07-04*
