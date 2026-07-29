# Current-State Audit — Morai calendar / analyzer stack

Repo root: `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools`.
All paths below are repo-relative. Branch at audit time: `fix/chain-root`, head `6622dec`.
Source: four code-reading audits, plus twelve facts re-verified in the audit pass
(marked **[verified]**).

## Corrections applied after a verification pass

A later pass re-measured the load-bearing counts and found five wrong. The body below is
left as written; **these corrections win** wherever they conflict.

| Claim in the body | Correct value |
|---|---|
| `packages/core/src/picker` is "3,162 production / ~4,700 test" | **4,224 production / 5,254 test / 9,478 total.** The body's two figures sum 1,616 short of the total it also quotes, so the "−7,700 net lines" estimate understates the production cut by roughly a thousand lines |
| `apps/web` tsc: "25 errors in 6 files", "8 from `Analyzer 2.tsx`", "goes to 17" | **20 errors in 8 files**; `Analyzer 2.tsx` accounts for **11** (7× TS2307, 4× TS7006); deleting it takes the count to **9**, not 17 |
| "only one read carries `root`" (stated 3×) | `leg-observations.ts:169` also selects `contracts.root`, and `:421` + `calendar-snapshots.ts:154` filter on it. The defensible claim is narrower: `picker-chain.ts` is the only read that hands `root` to a *chain-row* consumer; `readSmile` (`:369-371`) drops it |
| "no per-expiry ATM-IV history table anywhere", filed under *Cannot, at any price* | Literally true, functionally wrong. `leg_observations` is PK `(time, contract)` with `bsm_iv` per row, append-only, joinable to `contracts` — a per-expiry ATM-IV series, and therefore a slope and Forward-Factor series, is a `GROUP BY` away with **no migration**. The binding constraint is **depth (~30 days)**, not schema. Filing it as a schema gap points at building a table; filing it as a depth gap points at waiting, which is the truth |
| "DDL for 24 tables" | **25** (`rg -c 'pgTable\(' schema.ts`) |
| "14 injected deps" | `computePickerSnapshot.ts:103-141` declares 15 fields, 12 of them ports |

Two things the body never mentions, both real:

1. **`packages/quant` is an undocumented fifth package.** `packages/core` depends on it
   (`packages/core/package.json:12`) while `CLAUDE.md`'s layer table says core may import
   "`packages/shared` only". Every plan that promotes math into core and calls `bsmGreeks`
   is already outside the documented boundary law. Per the repo's own rule that is a docs
   edit before an architecture change.
2. **`apps/web/src/lib/parsed-calendar-to-candidate.ts` is a fourth site hand-building a
   candidate**, and it is one of the 20 tsc errors. The duplication table below misses it.

Every production-database number in the body (the 1,190 corrupt contracts, the OI zeroing,
the history depth, the null risk-reversal rows) was traced to the handoff document rather
than to a query the audit shows. All of them have since been re-measured directly and are
recorded with their queries in [measurements.md](./measurements.md).

## Superseded — the browser's copy of the math is gone

`apps/web/src/lib/chain-math.ts` is **deleted**, and with it the audit's central duplication
finding. `useChainModel` now reads `GET /api/chain/priced`, so the cohorts, per-leg greeks, ATM
reference and vertical skew are the calendar engine's, and the two-leg math is `pairMetrics`.
Wherever the body below cites `chain-math.ts:NNN`, read it as history. This closes landmines
**4**, **9**, **10** and **14** (one engine, one spot, one clock, one settlement-aware T) and the
first four rows of the duplication table in §3. Still open and unchanged: **12** — the risk
reversal is the one column left in the browser, because it spans both wings and a server twin
would put `calendar/domain` into `analytics/domain`, which architecture-boundaries §7 forbids. It
therefore still resolves carry per expiry off the GEX snapshot, which is a different convention
from the one carry every other number on that table is now priced on.

---

## 1. Verdict in five sentences

Yes, it is too complicated, but not where it looks: the arithmetic is roughly 40 lines of real
formulas over four shared kernels — `computeFwdIv` (`packages/core/src/picker/domain/fwd-iv.ts:30-36`),
`bsmGreeks` (`packages/quant/src/bsm.ts:125-145`), `haircutFill`
(`packages/core/src/picker/domain/candidate-selection.ts:235-238`) and `interpolateRiskReversal`
(`packages/core/src/analytics/domain/risk-reversal.ts:80-92`) — wrapped in about 5,200 production
lines and 5,900 test lines across three engines that each rebuild the same calendar. The picker
engine is the worst offender: 3,162 production lines and ~4,700 test lines produce a top-8 ranked
list that the web UI deliberately refuses to read (`apps/web/src/screens/useAnalyzerModel.ts:111`
**[verified]**), so its only human-facing consumer is an MCP tool
(`apps/server/src/adapters/mcp/tools.ts:701`) and a settings-modal diff
(`apps/web/src/screens/RuleSettingsModal.tsx:126`). The browser holds a second, independent copy
of calendar math (`apps/web/src/lib/chain-math.ts`, 252 lines **[verified]**) that prices legs at
whole-day `dte/365.25` (`chain-math.ts:200`) while the server prices the same contracts at a
settlement-aware T (`candidate-selection.ts:173-186`) — the same convention mix that
`candidate-selection.ts:406-408` records as having made theta read visibly low against TOS. Below
the engines the data layer is honest but narrower than the engines assume: only one read carries
`root` (`packages/adapters/src/postgres/repos/picker-chain.ts:86`), the only per-strike IV history
table has zero readers (`skewSmile` appears nowhere under `apps/` **[verified]**), and 1,190
contracts carry a wrong `root` **and** an off-by-one `expiration` that poisoned their `bsm_iv`
(`plans/analyzer-chain-HANDOFF.md:189-206`; writer still unfixed at
`packages/core/src/journal/application/fetchChain.ts:143` **[verified]**). The honest simplification
is not "delete the math" — it is delete two of the three engines, promote the pure math into one
core module, cut the 9-term score to 4 terms and the 3-tier VIX gate to one comparison, and fix the
ingest writer first, because no engine-side care can detect cross-root contamination.

---

## 2. The map

Verdict vocabulary: **keep** (untouched), **reuse** (keep, but call it instead of re-writing it),
**simplify** (shrink in place), **delete**, **replace** (rewrite, behaviour is wrong today).

### Layer: `apps/web` — client chain/calendar surface

| Path | LOC | What it does | Verdict | Why |
|---|---|---|---|---|
| `apps/web/src/lib/chain-math.ts` | 252 **[verified]** | 8 per-column formulas: `hSkew`, `vSkewVsAtm`, `edge`, `atmStrike`, `atmIv`, `legGreeks`, `netCalendarGreeks`, `calendarDebit` | **simplify → move to core** | 100% pure, deps are `@morai/core` + `@morai/quant` which core already has (`packages/core/package.json:13`); `atmIv` (`:160`) is the only per-expiry ATM-IV in the repo |
| `apps/web/src/lib/chain-risk-reversal.ts` | 112 **[verified]** | Solves delta per row, hands `SmileQuote[]` to core's interpolator | **simplify → move to core** | 40 lines of code under 72 of comment; privately re-declares `DAYS_PER_YEAR` (`:28`) and hardcodes `/1000` (`:94`) |
| `apps/web/src/lib/chain-contract.ts` | 17 **[verified]** | Re-exports 4 symbols from `@morai/contracts` | **delete** | 2 lines of code, 15 of comment; 4 importers (`useChain.ts:2`, `useChainModel.ts:42`, `Analyzer.test.tsx:19`, `useChainModel.test.ts:20`) |
| `apps/web/src/hooks/useChainModel.ts` | 368 **[verified]** | Wing toggle + 2 leg picks; groups rows into `(root, expiration)` cohorts, prices legs, computes pair math + TOS line | **simplify** | The two `useMemo` bodies (`:211-278`, `:285-324`) call no hooks — they are pure functions; lifting them leaves a ~120-line hook |
| `apps/web/src/components/chain/ChainBrowse.tsx` | 395 **[verified]** | Cohort table + single-open strike ladder | **simplify** | `:34-88` is a private sort engine `DataTable` should own (`DataTable.tsx:24` shows the retired `CandidateTable` needed the same) |
| `apps/web/src/components/chain/ChainPair.tsx` | 215 **[verified]** | Renders the pair, 8 derived stats, 3 odd-pair flags, legend | **keep** | Zero math; ~70 lines are the legend prose that teaches Edge beats H-Skew |
| `apps/web/src/components/chain/chain-format.tsx` | 81 **[verified]** | `Num`/`dec`/`pct`/`pts`/`shortYmd`/`strikeLabel` | **keep** | The ×100 vol-point display scaling lives here (`:40-47`); one copy for both surfaces is right |
| `apps/web/src/screens/Analyzer.tsx` | 472 **[verified]** | Shell: wing toggle, provenance header, 4-state body, Pair panel, risk-profile paste panel | **keep** | No chain math; only `formatObserved` (`:57-62`) and candidate strings (`:415-418`) |
| `apps/web/src/lib/tos-order.ts` | 120 **[verified]** | `buildTosCalendarOrder` + `buildTosPairOrder` | **reuse** | Root-driven `[AM]` tag (`:111`) is the live-UAT fix; carries a 3rd `isThirdFriday` (`:22-24`) and hardcodes qty `+1` and symbol `SPX` |
| `apps/web/src/lib/resolve-carry.ts` | — | Lookup into `gex.impliedCarry` by exact expiration | **simplify** | Falls back to flat `{0.045, 0.013}` with no visible marker (`:18-26`) |
| `apps/web/src/lib/tos-parser.ts` | — | Back-solves ONE flat IV from the debit, default 0.15 (`:72-76`) | **replace** | The Pair → Risk-profile handoff discards both real per-leg IVs (`useAnalyzerModel.ts:253-254`) |
| `apps/web/src/screens/Analyzer 2.tsx` | 688 | Old ranked-picker Analyzer | **delete** | Untracked, imported by nothing, imports 4 modules that no longer exist; alone causes 8 of the 25 `cd apps/web && tsc --noEmit` errors. File still on disk **[verified]** |

### Layer: `packages/core/src/picker/domain` — the incumbent engine

| Path | LOC | What it does | Verdict | Why |
|---|---|---|---|---|
| `candidate-selection.ts` | 514 **[verified]** | Universe scan: puts → liquidity → expiry buckets → triple loop (front expiry × strike × back expiry) → greeks → net-theta gate | **simplify** | Loop is load-bearing; `selectEventCandidates` (`:489-514`) has no caller, two `gateDrops` fields never increment (`:318` **[verified]**), `autoTuneTargetDelta` (`:118-130`) rests on one blog post, `bsmPrice`/`DeltaRung` imported unused (`:36`, `:41`) |
| `rules.ts` | 565 **[verified]** | 9 weights, every normalizer, liquidity predicate, 6 fraction functions, 2 metadata tables | **simplify** | ~90 lines are the engine (`:28-85`, `:106-251`); `RULE_SET_METADATA` (`:271-400`) is 130 lines of English prose in a domain module; `:402-565` (163 lines) serves the retired event bucket |
| `entry-gate.ts` | 371 **[verified]** | VIX/VIX3M gate: staleness, 4 arm/disarm rungs, continuous penalty band, 4-tier ladder | **simplify** | Honest core ~25 lines; three threshold systems in one file, header at `:237-239` concedes ladder and rungs "move independently"; hysteresis is fed by string-matching the previous snapshot's `reasons` (`:243-252`) |
| `scoring.ts` | 340 **[verified]** | Forward IV, expected move, breakevens, 9-term weighted sum, exit plan | **simplify** | Sum (`:231-241`) is fine; `scoreEventCandidates` (`:326-340`) dead, `context` (`:244-257`) is weight-0 "calibrating", `thetaCapturePct` (`:259-278`) costs 3 extra `bsmPrice` calls nothing reads |
| `rule-config.ts` | 117 **[verified]** | Flat `overrides?.x ?? CONSTANT` merge | **keep** | Cleanest file in the engine and the only place a reader sees which knobs are live |
| `breakevens.ts` | 119 **[verified]** | 200-point grid + 50-iteration bisection on the front-expiry payoff | **keep** | No closed form exists; returns `[]` rather than fabricating. Nit: `:65` uses `/365` and floors at 0.001 |
| `fwd-iv.ts` | 36 **[verified]** | Forward-variance identity with a tagged `inverted` guard | **keep** | 6 lines carrying 25 of 100 score points; the guard pattern the rest of the engine cites |
| `realized-vol.ts` | 32 **[verified]** | stdev(n−1) of log returns × √252, null-honest | **keep** | Only realized-vol implementation in the repo |
| `types.ts` | 127 **[verified]** | `RawCandidate`, `ScoredCandidate`, closed `BreakdownCriterion` union | **keep** | `:67` structurally blocks refuted criteria; rot: `ContextEntry` (`:84-89`) and `thetaCapturePct` (`:99`) feed nothing |
| `sizing.ts` | 90 **[verified]** | VIX tier → contract count | **delete or inline** | 90 lines and three representations (`:36`, `:51`, `:82-88`) of `{low:2, normal:2, elevated:1, crisis:0}` |
| `brakes.ts` | 88 **[verified]** | max-open brake, −25% loss cooldown, cutoff date | **simplify** | Both evaluators are one line (`:40`, `:62-65`); `cooldownCutoff` (`:81-88`) is an unbounded `for(;;)` walking days as an oracle |
| `event-rules.ts` | **0 — does not exist** | — | **delete its test** | Only `event-rules.test.ts` (67 lines) is on disk **[verified]**; it guards `EVENT_RULE_SET_METADATA` in `rules.ts:461`, which has no production consumer |

### Layer: `packages/core/src/picker/application`

| Path | LOC | What it does | Verdict | Why |
|---|---|---|---|---|
| `computePickerSnapshot.ts` | 763 **[verified]** | The only orchestrator: 7 steps, 14 injected deps, persists one row | **simplify** | ~250 lines are not the pipeline: a hand-rolled type guard for already-Zod-validated data (`:324-360`), a re-declared criterion enum (`:364-378`), projection glue, and a re-evaluated cooldown predicate (`:590-595`, self-admitted in a `ponytail:` comment at `:587-589`) |
| `analyzeAdHocCalendar.ts` | 215 **[verified]** | Scores ONE pasted put calendar through the live scorer | **reuse** | Genuinely delegates every formula; but `:158-168` is a verbatim copy of `candidate-selection.ts:433-453`, and its own comment (`:6`, `:126`) cites the wrong line range |
| `getChain.ts` | 109 **[verified]** | Flattens the cohort to wire rows, `dte` via calendar-day arithmetic (`:96`) | **keep** | Pure mapper, no clock; the read a new engine should consume |
| `previewPickerRuleOverrides.ts` | 212 **[verified]** | Re-scores a stored snapshot under staged weights | **simplify** | Holds a third copy of the score reduction (`:90-92`) |
| `ports.ts` | 414 **[verified]** | All driven/driver port types + domain row mirrors | **keep** | Everything a new engine needs is already declared; no new driven port required |
| `getPicker.ts` | 27 **[verified]** | Forwarder | **keep** | Zero logic |

### Layer: `packages/core/src/analytics`

| Path | LOC | What it does | Verdict | Why |
|---|---|---|---|---|
| `application/computeAnalytics.ts` | 175 | Writes term-structure + skew + RR rows | **reuse** | The only writer of per-expiry IV history; stamps all three with the snapshot anchor when calendars exist (`:116`), so cadence is the journal's |
| `application/computeGexSnapshot.ts` | 343 | GEX walls, flip, profile, nearTerm ≤45d, `impliedCarry` | **reuse** | `implied_carry` is the ONLY stored per-expiry (r,q) (`:146-187`) |
| `domain/risk-reversal.ts` | 92 | 25Δ RR by linear-in-delta interpolation | **reuse** | Property-tested, already shared with the browser (`chain-risk-reversal.ts:111`); `MAX_BRACKET_WIDTH = 0.3` (`:25`) is why most stored values are null |
| `domain/implied-carry.ts` | 79 | Parity-implied q | **reuse** | The guards are production fixes (0DTE solved q = 0.2984) |
| `domain/percentile-rank.ts` | 6 | Re-export of the shared kernel | **reuse** | This IS the rank primitive (`packages/shared/src/percentile-rank.ts:18`) |
| `domain/regime.ts` | 80 | Four threshold bands over macro rows | **reuse** | Nothing persisted, so no regime history |
| `domain/gex.ts` | — | `dollarGamma`, walls, flip, profile | **simplify** | Profile hardcodes `R = 0.043`, `Q = 0.013` (`:251-252`) and ignores the `impliedCarry` in its own row |
| `application/getRegimeBoard.ts` | 233 | Latest row per series, live per request | **keep** | Reads the whole table then keeps `max(date)` in memory (`:217-228`); fine at today's size |
| `application/getSkew.ts` | 26 | Forwarder to the RR series read | **keep** | Correct read; beware `value` is null on most rows |
| `application/getTermStructure.ts` | 26 | Forwarder to `term_structure_observations` | **delete from any engine plan** | Its `value` is a byte copy of `calendar_snapshots.term_slope` (`computeAnalytics.ts:87-91`) keyed by **calendar id** — it only covers pairs already held |
| `application/ports.ts` | 291 | Analytics ports + row shapes | **keep** | `ForReadingSkewSmileDetail` (`:167-172`) is built and wired to nothing |

### Layer: `packages/adapters`

| Path | LOC | What it does | Verdict | Why |
|---|---|---|---|---|
| `postgres/schema.ts` | 623 | DDL for 24 tables | **reuse** | Everything a calendar engine needs already exists (`:117-166`); no new table until the existing ones are proven insufficient |
| `postgres/repos/picker-chain.ts` | 121 | Dual-source cohort read: 10-min union, `DISTINCT ON (contract)`, `MAX(open_interest) OVER (PARTITION BY contract)` | **reuse** | The only read that surfaces `root` (`:86`, `:104`) and the only one that repairs Schwab's overnight OI=0 (`:81`) |
| `postgres/gex-snapshot.repo.ts` | 290 | Same cohort read, different columns; GEX upsert + latest read | **simplify** | `:104-156` duplicates `picker-chain.ts:44-95` including the copy-pasted 30-line comment |
| `postgres/repos/leg-observations.ts` | 495 | The whole per-leg write+read surface | **simplify** | `readSmile` (`:344`) already returns a per-expiry smile but is single-cycle (`:380`) and drops `root` (`:369-371`); `:193` parses the OCC symbol then throws the good values away at `:197-207` |
| `postgres/repos/skew-observations.ts` | 94 | Bulk skew insert + `readSkewSmileDetail` | **reuse** | `:61` is a ready-made per-strike IV-history reader with no route and no tool; unbounded — no time filter, no LIMIT (`:73-75`) |
| `postgres/repos/risk-reversal-observations.ts` | 133 | RR write + series read + trailing 252 window | **reuse** | `:102-120` is the working template for any new percentile rank |
| `postgres/repos/picker-history.ts` | 93 | Daily spot closes + slope history | **simplify** | The "daily close" is `DISTINCT ON (time::date)` over a 24/7 `*/30` feed (`:43-47`) — the ~23:30Z sample, UTC buckets, not the 16:00 ET print |
| `memory/picker-chain.ts` | 29 | In-memory chain double | **keep** | A new engine needs zero new fakes |

### Layer: ingest (`packages/core/src/journal`, `apps/sidecar`)

| Path | LOC | What it does | Verdict | Why |
|---|---|---|---|---|
| `journal/application/fetchChain.ts` | 271 | Fetch SPX+SPXW, DTE/strike filter, map to observation + first-seen contract rows | **replace** | `root: chain.root` (`:143` **[verified]**) takes the requested label, not the OCC symbol; `expiration` is built with LOCAL getters (`:135-138`) off a UTC-midnight date |
| `journal/application/computeBsmGreeks.ts` | 245 | The BSM drain: invert IV, write `bsm_*` | **reuse** | Defines what `bsm_*` means: flat r per date + constant q = 0.013 (`:118-153`); bounded at 800 rows / ~11.7 min (`:72-80`) so a backlog can leave permanent NULLs |
| `journal/domain/dte.ts` | — | `computeT` settlement-aware, `isThirdFriday` (`:104-109`) | **keep** | The canonical settlement clock; hand-rolled EDT/EST offsets (`:1-16`) |
| `apps/sidecar/chain_proxy.py` | 274 | Schwab chain proxy, one `$SPX` call for both roots | **keep** | `:35-40` states outright that `root` is only a response label; `:133` emits `T00:00:00.000Z`, the other half of the −1-day bug |

### Layer: `apps/server` + `packages/contracts`

| Path | LOC | What it does | Verdict | Why |
|---|---|---|---|---|
| `adapters/http/chain.routes.ts` | 47 | `GET /api/chain` | **keep** | Thin, no logic |
| `adapters/http/picker.routes.ts` | 83 | `GET /api/picker/candidates`, `POST /api/picker/analyze` | **keep** | The POST seam is the reusable one: `.strict()` body, no client spot, `scored:false` is a 200 |
| `adapters/http/analytics.routes.ts` | 195 | Six read routes in one factory | **keep** | The `{time, …, value}` shape is reusable verbatim |
| `adapters/http/gex.routes.ts` | 64 | Latest GEX snapshot | **keep** | Publishes `impliedCarry`, the only per-expiry (r,q) on the wire |
| `adapters/http/calendar.routes.ts` | 123 | Calendar CRUD | **keep** | `registerCalendarRequest` already carries the exact leg identity a calendar engine needs |
| `adapters/mcp/tools.ts` | 1449 | 27 tool registrations | **simplify** | Every tool re-hand-writes its HTTP twin's `Date→ISO` mapping (~40 duplicated lines) |
| `packages/contracts/src/picker.ts` | 378 | Candidate, breakdown, gate, sizing, snapshot, ad-hoc request/response | **reuse** | `analyzeAdHocCalendarRequest`/`Response` are the ready-made pair; the closed enum at `:34` is the one deliberate friction point |
| `packages/contracts/src/chain.ts` | 63 | `chainRow` + `chainResponse` | **keep** | Pure data, explicitly no scores; new derived columns belong in a NEW schema |

---

## 3. The three engines problem

### What each one computes

**Engine A — the browser** (`apps/web`, 2,032 production lines **[verified]**, 1,201 test).
Input: `GET /api/chain` (30s poll) + `GET /api/analytics/gex` for carry. It groups the flat chain
into `(root, expiration)` cohorts (`useChainModel.ts:222`), computes per cohort an ATM strike
(`chain-math.ts:113-131`, argmin |K−S| with ties to the lower strike), an ATM IV
(`chain-math.ts:160-183`, no neighbour substitution), and a 25Δ risk reversal
(`chain-risk-reversal.ts:68-112`). Per leg it computes greeks at whole-day `dte/365.25`
(`chain-math.ts:200`) and V-Skew vs the cohort ATM (`useChainModel.ts:184`). Once two legs are
picked it computes H-Skew (`chain-math.ts:67-69`), forward IV, Edge (`chain-math.ts:93-102`), net
greeks as `back − front` with **no ×100** (`chain-math.ts:211-222`), the haircut debit in **index
points** (`chain-math.ts:232-238`), three odd-pair flags, and the TOS order line. It computes no
score, no rank, no verdict, by design (`ChainBrowse.tsx:12-13`, `Analyzer.tsx:3-8`).

**Engine B — the picker** (`packages/core/src/picker`, 3,162 production lines, ~4,700 test).
Input: the same chain cohort through `ForReadingChainForPicker`, plus GEX, events, macro,
open/closed calendars, the previous snapshot, spot closes, slope history and a FRED rate — 14
injected deps (`computePickerSnapshot.ts`). It filters to puts at the read boundary (`:516-518`),
scans front expiry × strike × back expiry (`candidate-selection.ts:392-426`), prices legs at a
**settlement-aware** T (`candidate-selection.ts:173-186`), computes net greeks **×100**
(`:433-445`) and the debit **×100 in dollars** (`:448`), gates on liquidity and net-theta>0, scores
9 weighted terms to [0,100] (`scoring.ts:231-241`), applies a gate penalty multiplier
(`entry-gate.ts:369-371`), ranks, caps at 8 (`computePickerSnapshot.ts:672`) and persists one row.

**Engine C — the ad-hoc analyzer** (`analyzeAdHocCalendar.ts`, 215 lines).
Input: 10 numbers the user pasted (`ports.ts:343-354`). It borrows the last snapshot's spot,
`asOf`, gate and freshness verdicts verbatim, rebuilds ONE `RawCandidate` and calls the same
scorer. It never reads the chain (structural exclusion, stated at `:10-14`), never prices the
debit (takes `input.debit * 100` at face value, `:187`), never applies the hard gates, and ignores
`qty` entirely (`:175`, absent from the candidate at `:176-193`).

### The same quantity computed twice

| Quantity | Site A | Site B | How they differ |
|---|---|---|---|
| Forward IV + edge | `apps/web/src/lib/chain-math.ts:93-102` | `apps/web/src/hooks/useChainModel.ts:157-166` | Same guard copied inside ONE app; both called at `useChainModel.ts:301-302`, so the identity runs twice per pair |
| Forward edge | `apps/web/src/lib/chain-math.ts:101` | `packages/core/src/picker/domain/scoring.ts:139-145` | Server substitutes 0 for an inverted structure; client returns null |
| Leg greeks (picked legs) | `apps/web/src/hooks/useChainModel.ts:169, 180-183` | `apps/web/src/hooks/useChainModel.ts:289-292` | Second call on the same raw rows; `legGreeks` is all-or-nothing, so subtracting the stored values is identical |
| Net greeks + slope + delta label | `packages/core/src/picker/domain/candidate-selection.ts:433-453` | `packages/core/src/picker/application/analyzeAdHocCalendar.ts:158-168` | **Verbatim copy.** Engine passes each leg's `root` into `yearFractionToSettlement` (`:409`, `:434`); ad-hoc defaults both to SPXW (`:157-159`) |
| Net greeks (third copy) | `packages/core/src/picker/domain/candidate-selection.ts:433-445` (×100) | `apps/web/src/lib/chain-math.ts:211-222` (no ×100) | Two unit spaces on the same screen: `Analyzer.tsx:415` prints candidate θ/vega, `ChainPair.tsx:130-141` prints chain-math θ/vega |
| Haircut debit | `packages/core/src/picker/domain/candidate-selection.ts:448-449` (dollars) | `apps/web/src/lib/chain-math.ts:232-238` (index points) | Same `haircutFill`, different scaling; a third path takes the user's number raw (`analyzeAdHocCalendar.ts:187`) |
| 25Δ risk reversal | `packages/core/src/analytics/application/computeAnalytics.ts:132-168` | `apps/web/src/lib/chain-risk-reversal.ts:68-112` | Same interpolator, **different partition**: server groups by `underlying\|expiration` and is root-blind (`analytics/application/ports.ts:23-30`), client is root-scoped |
| Cohort SQL read | `packages/adapters/src/postgres/repos/picker-chain.ts:44-95` | `packages/adapters/src/postgres/gex-snapshot.repo.ts:104-156` | Near-verbatim, same 30-line comment copy-pasted; differ only in the NOT-NULL predicate column and select list |
| ISO day arithmetic | `candidate-selection.ts:141-149`, `entry-gate.ts:124-132` | `scoring.ts:74-80`, `computePickerSnapshot.ts:151-159` | Four copies of `Date.UTC(y,m-1,d)/86_400_000`, each with its own regex and asserts |
| Weighted-sum score | `scoring.ts:231-241` | `computePickerSnapshot.ts:221-222`, `previewPickerRuleOverrides.ts:90-92` | Three reductions; five copies of the `min/max/round` clamp (add `entry-gate.ts:370`, `scoring.ts:337`) |
| `clamp01` | `rules.ts:87-89` | `scoring.ts:82-84` | Identical bodies in two files that import from each other |
| −25% cooldown predicate | `brakes.ts:62-65` | `computePickerSnapshot.ts:590-595` | Re-filtered purely to derive a display date; self-admitted at `:587-589` |
| Business-day walk | `brakes.ts:81-88` (backward) | `computePickerSnapshot.ts:293-300` (forward) | Two unbounded `for(;;)` loops using `businessDaysSince` as an oracle |
| VIX tier table | `entry-gate.ts:36-41`, `entry-gate.ts:56-66` | `sizing.ts:51-57`, `sizing.ts:82-88` | Four representations of a 4-row table, plus a parallel rung system at `entry-gate.ts:80-94` the ladder override does not move (`:237-239`) |
| Rule registry | `rules.ts:271-400` | `rules.ts:461-565` | Second is a scaled clone with one row promoted; no production consumer |
| `isThirdFriday` | `apps/web/src/lib/tos-order.ts:22-24` (local getters) | `packages/core/src/journal/domain/dte.ts:104-109` (UTC), `packages/shared/src/settlement-timestamp.ts:32` | Three copies, not drop-in swappable; a settlement-rule change needs three edits |
| `DAYS_PER_YEAR = 365.25` | `chain-math.ts:28`, `chain-risk-reversal.ts:28` | `scenario-engine.ts:187` (+ `position-greeks.ts:58`, `iv-calibration.ts:41` as MS variants) | Three declarations inside `apps/web` alone |
| Strike `/1000` | `chain-math.ts:25` (`STRIKE_SCALE`) | `chain-risk-reversal.ts:94`, `tos-order.ts:116`, `chain-format.tsx:62` | Four hardcoded sites; `tos-order.ts:116` has an explicit note declining the import |
| Table sorting | `ChainBrowse.tsx:34-88` | `DataTable.tsx:24` (retired `CandidateTable`) | Second consumer to re-own accessor + nulls-last comparator + first-direction policy |
| HTTP↔MCP wire mapping | `analytics.routes.ts:101-114`, `:70-81`, `gex.routes.ts:44`, `picker.routes.ts:76-79` | `tools.ts:459-470`, `:394-403`, `:659-674`, `:786-788` | Byte-identical logic, guarded only by the shared Zod schema |
| Core row vs contract schema | `getChain.ts:37-56`, `ports.ts:146-193`, `ports.ts:112-133`, `ports.ts:343-354` | `chain.ts:15-53`, `picker.ts:102-146`, `picker.ts:224-264`, `picker.ts:343-362` | Four mirrored pairs with **no compile-time link** — drift is a runtime Zod failure |
| Term structure | `calendar_snapshots.term_slope` (`schema.ts:99`) | `term_structure_observations.value` (`computeAnalytics.ts:87-91`) | Byte copy; the second table adds a per-cycle index and nothing else |
| Carry (r, q) | `computeBsmGreeks.ts:127-145` (flat r/date, q=0.013) | `gex.ts:251-252` (R=0.043, Q=0.013), `computeGexSnapshot.ts:146-187` (per-expiry solved), `resolve-carry.ts:18-26` (client default) | Four regimes, never reconciled; the GEX profile ignores the `impliedCarry` in its own row |
| Pending-row metadata | `leg-observations.ts:193` (`parseOccSymbol` — trustworthy) | `leg-observations.ts:197-207` (DB columns — corrupt on 1,190 rows) | The good values are computed then discarded |

### Time-to-expiry conventions, all of them

| Convention | Site | Used for |
|---|---|---|
| Settlement-aware minutes / 525960, AM 09:30 ET vs PM 16:00 ET | `packages/core/src/journal/domain/dte.ts:1-16` | The IV inversion that produced every `bsm_iv` |
| `yearFractionToSettlement` / 365.25-day year | `candidate-selection.ts:173-186` | Engine leg greeks and delta-band membership |
| `sqrt(tf/365)` | `scoring.ts:155` | Expected move |
| `frontDte/365` + a `T=0.0001` stub | `scoring.ts:269-274` | `thetaCapturePct` (nothing reads it) |
| `(backDte − frontDte)/365`, floored 0.001 | `breakevens.ts:65` | Breakeven solver |
| `new Date(expiration + "T21:00:00Z")` / 365.25 | `analytics/domain/gex.ts:271-276` | GEX profile |
| Same anchor, re-derived | `computeGexSnapshot.ts:295-296` | ≤45-day nearTerm filter |
| `settlementTimestamp()` | `computeGexSnapshot.ts:170-171` | Carry solve — same file as the line above |
| Whole-day `dte/365.25` | `chain-math.ts:200`, `chain-risk-reversal.ts:94` | Client leg greeks and delta solve |
| Calendar days only | `fetchChain.ts:50-61` | Ingest DTE gate |

Nine conventions, three of them inside the GEX path. `candidate-selection.ts:159-166` records that
mixing whole-day and settlement-aware T is exactly what made theta/vega read low against TOS. The
fix was applied to the engine's greeks only. The browser now repeats the bug.

**Disagreement, unresolved:** audit 1 calls the client T mismatch a live defect on the strength of
that code comment. Nobody measured it. No audit produced a number for how far the client's theta
sits from the server's on the same contract. Treat the direction as known and the magnitude as
unmeasured.

---

## 4. The knob inventory

### 4a. Runtime-configurable — the complete set (23 values, `rule-config.ts:48-61`, resolved `:82-117`)

| Knob | Default | Site | Trader ever needs to touch it? |
|---|---|---|---|
| `deltaBandMin` | −0.49 | `candidate-selection.ts:52` | **Yes** — this is which strikes he is willing to trade |
| `deltaBandMax` | −0.30 | `candidate-selection.ts:53` | **Yes** — same |
| `frontDteMin` | 21 | `candidate-selection.ts:60` | **Yes** — the front window is a strategy choice |
| `frontDteMax` | 36 | `candidate-selection.ts:61` | **Yes** |
| `backDteMinGap` | 15 | `candidate-selection.ts:68` | Maybe once — set it and forget it |
| `backDteMaxGap` | 90 | `candidate-selection.ts:69` | Maybe once |
| `weights.fwdEdge` | 25 | `rules.ts:29` | **Yes** — the actual thesis weight |
| `weights.deltaNeutral` | 15 | `rules.ts:34` | **Yes** — the user's hard constraint |
| `weights.beVsEm` | 15 | `rules.ts:32` | **Yes** |
| `weights.debitFit` | 5 | `rules.ts:45` | **Yes** — spend preference |
| `weights.slope` | 10 | `rules.ts:28` | No — redundant with `fwdEdge` (see 4d) |
| `weights.gexFit` | 10 | `rules.ts:30` | No — half of it cannot discriminate |
| `weights.thetaVega` | 10 | `rules.ts:39` | No — near-always satisfied post net-theta gate |
| `weights.eventAdjustment` | 5 | `rules.ts:31` | No — separates ~4 expiry buckets and nothing else |
| `weights.vrp` | 5 | `rules.ts:42` | No — 5 points for a whole module and a DB read |
| `debitIdealMin` | 3200 | `rules.ts:46` | **Yes** — this is his wallet |
| `debitIdealMax` | 5000 | `rules.ts:47` | **Yes** |
| `vixLadder.normalMin` | 15 | `entry-gate.ts:37` | No — moves the ladder but not the gate rungs (`:237-239`) |
| `vixLadder.elevatedMin` | 20 | `entry-gate.ts:39` | No — same trap |
| `vixLadder.crisisMin` | 25 | `entry-gate.ts:40` | No — same trap |
| `maxOpenCalendars` | 6 | `brakes.ts:23` | **Yes** — position-count risk limit |
| `sizingContracts.{low,normal}` | 2, 2 | `sizing.ts:36-41` | **Yes** — but this is a 4-entry object, not a module |
| `sizingContracts.{elevated,crisis}` | 1, 0 | `sizing.ts:36-41` | **Yes** — same |

### 4b. Hardcoded in the scoring/selection domain

| Constant | Default | Site | Trader ever needs to touch it? |
|---|---|---|---|
| `FILL_WIDTH_FRACTION` | 0.66 | `candidate-selection.ts:76` | Maybe once — it is his fill realism |
| `LIQUIDITY_MAX_SPREAD_FRAC` | 0.10 | `rules.ts:73` | **Yes** — it decides what is tradeable |
| `LIQUIDITY_MIN_OI` | 100 | `rules.ts:75` | **Yes** — same |
| `EVENT_BLACKOUT_DAYS` | 3 | `candidate-selection.ts:82` | No |
| `PEAK_THETA_DAYS` | 5 | `candidate-selection.ts:89` | No |
| `SLOPE_NORMALIZER` | 0.6 | `rules.ts:53` | No — term is redundant |
| `SLOPE_RICH_FULL` | −0.25 | `rules.ts:55` | No |
| `SLOPE_CRISIS_FLOOR` | −1.5 | `rules.ts:56` | No |
| `FWD_EDGE_OFFSET` | 0.02 | `rules.ts:57` | Maybe once — sets where 0.5 credit falls |
| `FWD_EDGE_RANGE` | 0.04 | `rules.ts:58` | Maybe once |
| `BE_VS_EM_TARGET_RATIO` | 1.5 | `rules.ts:59` | Maybe once — was 2.0, reverted 2026-07-15 as unreachable |
| `DELTA_NEUTRAL_MAX` | 5 | `rules.ts:36` | **Yes** — tightened from 10 on 2026-07-09 |
| `THETA_VEGA_FULL` | 0.2 | `rules.ts:40` | No |
| `VRP_FULL` | 0.03 | `rules.ts:43` | No |
| `DEBIT_CHEAP_FLOOR` | 2000 | `rules.ts:48` | No |
| `DEBIT_CHEAP_CREDIT` | 0.7 | `rules.ts:49` | No |
| `DEBIT_EXPENSIVE_ZERO` | 7500 | `rules.ts:50` | No |
| `GEX_DAMPEN_BASE_CREDIT` | 0.5 | `rules.ts:63` | No — cohort-wide constant, cannot rank |
| `GEX_RANGE_CREDIT` | 0.3 | `rules.ts:65` | No |
| `GEX_WALL_PIN_CREDIT` | 0.2 | `rules.ts:67` | No |
| `GEX_WALL_PIN_PTS` | 5 | `rules.ts:69` | No |
| `EVENT_PENALTY` FOMC/CPI/NFP | 0.25 each | `rules.ts:81-85` | No — softened from 0.5 because it saturated (`:78-80`) |
| `EXIT_PROFIT_TARGET_PCT` | 0.25 | `scoring.ts:69` | **Yes** — this is his exit rule |
| `EXIT_STOP_PCT` | 0.175 | `scoring.ts:70` | **Yes** |
| `EXIT_MANAGE_SHORT_DTE` | 21 | `scoring.ts:71` | **Yes** |
| `PICKER_TOP_N` | 8 | `computePickerSnapshot.ts:83` | No |
| `GEX_FRESHNESS_WINDOW_MS` | 2 h | `computePickerSnapshot.ts:87` | No |
| `EVENTS_FRESHNESS_WINDOW_MS` | 14 d | `computePickerSnapshot.ts:91` | No |
| `RV_CLOSES_DAYS` | 21 | `computePickerSnapshot.ts:94` | No |
| `SLOPE_HISTORY_LIMIT` | 60 | `computePickerSnapshot.ts:97` | No — feeds a weight-0 display entry |
| `autoTuneTargetDelta` lerp | VIX 15 → 25 | `candidate-selection.ts:118-130` | **No, and delete it** — silently halves the strike band as VIX rises, on one blog citation |
| `EVENT_BACK_DTE_MIN_GAP` / `MAX_GAP` | 3 / 10 | `candidate-selection.ts:489-490` | Dead |
| `WEIGHT_BACK_EVENT_BONUS` | 10 | `rules.ts:411` | Dead |
| `EVENT_BUCKET_SCALE` | 0.9 | `rules.ts:414` | Dead |

### 4c. Hardcoded in the gate, brakes and solvers

| Constant | Default | Site | Trader ever needs to touch it? |
|---|---|---|---|
| `VIX_BLOCK_ARM` / `DISARM` | 25 / 24 | `entry-gate.ts:80-81` | **Yes on the 25**; the disarm rung is machinery |
| `VIX_PENALTY_FLOOR` / `DISARM` | 20 / 19 | `entry-gate.ts:83-84` | No |
| `RATIO_BLOCK_ARM` / `DISARM` | 0.95 / 0.93 | `entry-gate.ts:86-87` | Maybe on the 0.95 |
| `RATIO_PENALTY_FLOOR` / `DISARM` | 0.90 / 0.89 | `entry-gate.ts:93-94` | No |
| `GATE_PENALTY_FLOOR_MULTIPLIER` | 0.3 | `entry-gate.ts:97` | No |
| `GATE_BLIND_MAX_BIZDAYS` | 3 | `entry-gate.ts:118` | No |
| `LOSS_COOLDOWN_PCT` | −0.25 | `brakes.ts:26` | **Yes** — a −25.0% close trips it, −24.9% does not |
| `COOLDOWN_BIZDAYS` | 2 | `brakes.ts:29` | **Yes** |
| `BISECT_LO/HI/STEPS/MAX_ITER/TOL` | 0.5 / 1.5 / 200 / 50 / 1e-6 | `breakevens.ts:26-30` | No |
| back-T floor | 0.001 | `breakevens.ts:65` | No |
| `TRADING_DAYS_PER_YEAR` | 252 | `realized-vol.ts:11` | No |
| minimum closes | 3 | `realized-vol.ts:14` | No |

### 4d. Adjacent knobs that decide what data the engine can even see

| Constant | Default | Site | Trader ever needs to touch it? |
|---|---|---|---|
| `BSM_MAX_DTE` | 90 | `apps/worker/src/config.ts:25` | **Yes** — nothing beyond 90 DTE exists in the DB |
| `BSM_STRIKE_BAND_PCT` | 0.10 | `apps/worker/src/config.ts:26` | **Yes** — nothing outside ±10% of spot exists |
| `BSM_RATE_FALLBACK` | 0.045 | `apps/worker/src/config.ts:27` | No |
| `BSM_DIVIDEND_YIELD` | 0.013 | `apps/worker/src/config.ts:28` | No — but note every `bsm_*` was solved with this constant q |
| `MAX_BRACKET_WIDTH` | 0.3 | `analytics/domain/risk-reversal.ts:25` | **Yes** — it is why most stored RR values are null |
| GEX profile `R` / `Q` | 0.043 / 0.013 | `analytics/domain/gex.ts:251-252` | No — but it should read the row's own `impliedCarry` |
| sidecar `strikeCount` | 50 | `apps/sidecar/chain_proxy.py:53` | No |

**Count:** 23 configurable, ~46 hardcoded in the engine, 7 adjacent. Of the 76, **17 are ones a
trader would plausibly touch** and 11 of those are hardcoded today. The knob surface is inverted:
the machinery is configurable, the strategy is not.

---

## 5. What is actually good

Keep these through any rebuild. Each earns its lines.

1. **`fwd-iv.ts` (36 lines)** — the forward-variance identity with a tagged `{fwdIv: null, guard:
   "inverted"}` union instead of NaN (`:30-36`). Six lines carrying 25 of the 100 score points, and
   the guard pattern the rest of the repo cites.
2. **`haircutFill`** (`candidate-selection.ts:235-238`, `FILL_WIDTH_FRACTION = 0.66` at `:76`) — the
   most honest line in the engine. It stops every ranked debit being a fantasy about SPX mids.
3. **`breakevens.ts` (119 lines)** — 200-point grid, 50-iteration bisection, front leg at intrinsic
   (`:64-69`). A calendar's breakevens have no closed form and it returns `[]` rather than fabricating
   a ratio.
4. **`interpolateRiskReversal`** (`analytics/domain/risk-reversal.ts:80-92`) — one property-tested
   implementation, already reused by the browser through a thin adapter
   (`chain-risk-reversal.ts:111`). This is the shape everything else should have copied.
5. **`realized-vol.ts` (32 lines)** and **`percentileRank`** (`packages/shared/src/percentile-rank.ts:18`)
   — textbook, null-honest, one copy each.
6. **`implied-carry.ts` (79 lines)** — the guards are scar tissue: 0DTE once solved q = 0.2984, so
   the horizon floor and the `[0, 0.10]` clamp stay.
7. **The universe scan itself** (`candidate-selection.ts:313-482`) — front DTE window, delta band,
   same-strike back leg in the gap window, dedup on `strike-front-back`. Real work with no substitute.
8. **The dual-source cohort read** (`picker-chain.ts:39-95`) — the 10-minute union (a strict
   `max(time)` equality collapsed the Schwab+CBOE cycle to one source, the 2026-07-08 regression) and
   `MAX(open_interest) OVER (PARTITION BY contract)` at `:81`. That window function is measured
   scar tissue: Schwab returns OI 0 for every contract outside RTH — 0.0% non-zero 04:00-10:00Z vs
   86.3% from 10:30Z, prod 2026-07-27 — and writes a minute after CBOE, so newest-row-wins zeroed
   ~2,971 contracts a day and nulled both walls.
9. **The client math's root/wing-by-signature design** — `atmIv(rows, spot, expiration, contractType,
   root)` (`chain-math.ts:160-183`) and `riskReversalForExpiry(rows, expiration, r, q, root)`
   (`chain-risk-reversal.ts:68`) cannot be called root-blind. This shape fixed a live collision where
   back IV read 68.89% against front 24.69% at strike 6675000 (`chain-math.ts:144-158`,
   `plans/analyzer-chain-HANDOFF.md:62-74`).
10. **`chain-format.tsx` (81 lines)** — the single place the ×100 vol-point display scaling happens
    (`:40-47`), shared by both surfaces.
11. **The test bodies worth keeping**: `chain-math.test.ts` (445 lines, fast-check properties for
    every column — null-in/null-out, `atmStrike` optimality, never-NaN), `chain-risk-reversal.test.ts`
    (265), and the port-hygiene test at `analyzeAdHocCalendar.test.ts:346` that structurally proves
    the ad-hoc use-case cannot reach the cohort-gate reads. Copy that test idea into anything new.
12. **`rule-config.ts` (117 lines)** — a flat `??` merge and the only place a reader can see which
    knobs are live. The problem it solves is self-inflicted; the file is the right shape.
13. **`types.ts:67`** — the closed `BreakdownCriterion` union that structurally blocks refuted
    criteria from creeping back in.
14. **`ports.ts` + the memory adapters** — every port a new engine needs is already declared
    (`picker/application/ports.ts:248-311`) and `memory/picker-chain.ts` means zero new test fakes.

---

## 6. What the data layer can and cannot feed

**Can, today, with no new table:**

- **Live per-expiry state, root-correct and OI-repaired** — `picker-chain.ts:39`. Both wings, both
  roots, per-contract deduped. This is the only read that carries `root` (`:86`, `:104`).
- **Per-expiry ATM IV** — by promoting `chain-math.ts:160` into core. It is the only implementation
  and it refuses to substitute a neighbouring strike, which is correct.
- **Per-expiry (r, q)** — `gex_snapshots.implied_carry` (`computeGexSnapshot.ts:146-187`), r
  interpolated from DGS1MO/DGS3MO clamped to a [30d, 90d] bracket, q solved from parity at the
  strike nearest spot carrying both a call and a put mark. Never re-solve it.
- **A VRP *number*** — `frontIv − realizedVol20` already ships (`rules.ts:162-163`,
  `realized-vol.ts:13`) over 21 daily closes.
- **A 25Δ RR series with a rank** — `risk_reversal_observations`, read through
  `risk-reversal-observations.ts:102-120`.
- **Per-strike IV history** — `skew_observations` (`schema.ts:301-320`) with
  `readSkewSmileDetail` (`skew-observations.ts:61`), implemented in both adapters and wired to
  nothing (`skewSmile` has zero hits under `apps/` **[verified]**). Costs a route and a tool,
  roughly 30 lines.

**Cannot, at any price the engine can pay:**

- **A generic per-expiry term-structure history.** `term_structure_observations.value` is a byte copy
  of `calendar_snapshots.term_slope` (`computeAnalytics.ts:87-91`) keyed by **calendar id**
  (`schema.ts:349-362`). It only covers expiry pairs already held as positions. There is no
  per-expiry ATM-IV history table anywhere in `schema.ts`.
- **A root-scoped stored analytic.** `contracts.underlying` is always the literal `'SPX'`
  (`fetchChain.ts:142`), `readSmile` never selects `root` (`leg-observations.ts:369-371`), so
  `skew_observations` PK `(snapshot_time, underlying, expiration, strike)` cannot separate an SPX
  third-Friday from its SPXW twin. The write is `onConflictDoNothing` (`skew-observations.ts:52`),
  so on shared expiration dates **one of the two books is silently dropped**. Same for
  `risk_reversal_observations`. The client's root-scoped RR and the persisted RR are therefore not
  the same number over the same partition.
- **A regime history.** Nothing is persisted; the board is computed live per request
  (`getRegimeBoard.ts:99-181`). No regime percentile is possible.
- **A VRP rank.** Nothing persists the VRP series. This is the only genuinely new table a new engine
  could justify — and only after the plain number is proven.
- **A deep percentile of anything.** Live history runs 2026-06-30 → 2026-07-27, about 27 calendar
  days at 30-minute cadence, roughly 13 cycles a trading day, so a 252-sample window is about 20
  trading days deep. Cadence changed mid-history: timestamps are jittered (`…:12.439Z`) to 2026-07-10
  and snap to exact `:00/:30` from 2026-07-14.
- **A dense RR series.** Verified live: the majority of rows are null, with a continuous eight-day
  hole 2026-07-06 → 2026-07-14, caused by `MAX_BRACKET_WIDTH = 0.3` (`risk-reversal.ts:25, :67`)
  refusing to interpolate across a sparse ladder.
- **Anything outside 90 DTE or ±10% of spot.** Ingest bounds (`apps/worker/src/config.ts:25-26`,
  `fetchChain.ts:158-184`) plus the sidecar's `strikeCount = 50` (`chain_proxy.py:53`).
- **A settlement-print daily close.** `readDailySpotCloses` is `DISTINCT ON (time::date)` over a 24/7
  `*/30` feed (`picker-history.ts:43-47`) — the ~23:30Z sample, UTC buckets. Pin to the 20:00Z cycle
  or accept a known bias in RV20 and therefore in VRP.

---

## 7. Landmines

Each one is already paid for. Each needs a named guard in whatever replaces the engines.

| # | Landmine | Evidence | Guard the new engine must carry |
|---|---|---|---|
| 1 | **Root/expiry corruption at ingest — the top blocker.** `root` comes from the requested chain label, not the OCC symbol; `expiration` is formatted with LOCAL getters off a UTC-midnight date. 1,190 contracts have `root=SPX` on an SPXW OCC symbol, every one also one day early; 1,290 rows off by −1; `root_only` mismatches = 0, proving one writer | `fetchChain.ts:143` **[verified still `root: chain.root`]**, `fetchChain.ts:135-138`, `chain_proxy.py:133`, `plans/analyzer-chain-HANDOFF.md:189-206` | Derive both from `parseOccSymbol(quote.occSymbol)`. Flip `upsertContracts` off `onConflictDoNothing` (`leg-observations.ts:125` **[verified]**) so a backfill can land, then re-solve the affected rows. Add an assert that `contracts.root` equals the OCC root |
| 2 | **The corruption reaches `bsm_iv`, not just labels.** `readPendingObs` feeds `contracts.root` and `contracts.expiration` into `computeT`, which picks AM 09:30 ET vs PM 16:00 ET off `root` | `leg-observations.ts:169-171, 202-207, 221-222`, `computeBsmGreeks.ts:150`, `dte.ts:1-16` | For those 1,190 rows T is short a full day, plus 6.5 h when the bad date lands on a third Friday, so IV and every greek are biased HIGH — and that flows into `skew_observations.iv`, RR, GEX gamma and the chain table. The trustworthy value is already in hand at `leg-observations.ts:193` and thrown away at `:197-207` |
| 3 | **Two opposite degradation defaults for the same corrupt column** | `picker-chain.ts:104` (`row.root === "SPX" ? "SPX" : "SPXW"`) vs `leg-observations.ts:207` (`meta.root === "SPXW" ? "SPXW" : "SPX"`) | Pick one. Better: make an unknown root an error, not a coin flip |
| 4 | **Root-blind cohorts produce absurd term structure.** Back IV 68.89% vs front 24.69% at strike 6675000 | `chain-math.ts:144-158`, `plans/analyzer-chain-HANDOFF.md:62-74` | Every cohort function takes `root` in its signature so it cannot be called root-blind. Already true of `atmIv` and `riskReversalForExpiry`; keep it true |
| 5 | **Three `bsm_*` states, not two.** NULL = never processed, the STRING `'NaN'` = permanent solve failure, a number = solved | `computeBsmGreeks.ts:156-165`; consumers exclude both at `leg-observations.ts:381-384` and `gex.ts:93-96` | Every read filters `IS NOT NULL AND <> 'NaN'`. A widened read that forgets this fabricates numbers |
| 6 | **Schwab OI = 0 outside RTH.** Newest-row-wins zeroed ~2,971 contracts a day, making every strike gex 0 and both walls null | `picker-chain.ts:81`, `gex-snapshot.repo.ts:137` | `MAX(open_interest) OVER (PARTITION BY contract)` over the window, never the newest row's value |
| 7 | **Strict `max(time)` collapses the dual-source cohort.** The 2026-07-08 regression | `picker-chain.ts:36, 44-95` | Always union `[maxTime − 10 min, maxTime]` with `DISTINCT ON (contract)` newest-wins |
| 8 | **`dte` is frozen at the snapshot's observation day, and the staleness filter stops one day short.** A row observed yesterday whose expiration WAS yesterday has `dte === 0`, survives `row.dte < 0`, and renders today as a tradeable 0DTE cohort | `getChain.ts:96`, `useChainModel.ts:221-223` (the comment at `:221-222` shows the author aiming at exactly this class) | Recompute against today — `Cohort.dte` is `calendarDaysTo(injected now, expiration)`, so a gone expiry reads −1 however stale the snapshot. NOT `dte <= 0` as well: that also refuses the expiry that expires today and still trades (192 quoted SPXW puts on 2026-07-29). Settlement is `yearsToSettlement`'s question. Do not recompute `dte` in the browser |
| 9 | **Cohort `dte`, screen spot and stamp all come from whichever row arrived first**, and the chain is a vendor union | `useChainModel.ts:208-209, 224-228` | Take the max/consensus, or assert the values agree across the cohort |
| 10 | **Two spots in one screen.** `atmIv`/`atmStrike` measure against the screen-wide `rows[0].underlyingPrice` while `legGreeks` prices each leg against its own `row.underlyingPrice` | `useChainModel.ts:208, 249` vs `chain-math.ts:193` | One spot per cohort, passed explicitly |
| 11 | **The pair → risk-profile handoff destroys both real IVs.** The Send button writes a TOS string, `parseTosOrder` back-solves ONE flat IV (default 0.15) and it is sent as both legs' IV | `Analyzer.tsx:290`, `tos-parser.ts:72-76`, `useAnalyzerModel.ts:253-254` | Pass the picked legs as data, not through a string. Never `?? fallback` an IV |
| 12 | **A cohort with no `impliedCarry` entry silently prices at flat `{0.045, 0.013}`** with no visible marker | `resolve-carry.ts:18-26` | Mark the fallback in the UI or refuse to price |
| 13 | **Carry regimes are mixed.** `bsm_*` were solved with flat r-per-date and constant q = 0.013; `impliedCarry` is per-expiry; the GEX profile hardcodes 0.043/0.013 in the same row as `impliedCarry` | `computeBsmGreeks.ts:127-145`, `computeGexSnapshot.ts:146-187`, `gex.ts:251-252` | Any reprice takes r and q from the SAME expiry row it took IV from, or it drifts from the server |
| 14 | **Mixing whole-day and settlement-aware T made theta read visibly low against TOS** — fixed for the engine's greeks only, and the browser now repeats it | `candidate-selection.ts:406-408, 159-166` vs `chain-math.ts:200` | ONE T function, exported once, taking `root`. Nine conventions exist today (see §3) |
| 15 | **The ad-hoc path defaults both legs to PM settlement.** No `root` is passed to `yearFractionToSettlement` | `analyzeAdHocCalendar.ts:157-159` | Pass `root`, or say SPXW-only in the contract rather than a code comment |
| 16 | **`qty` is validated as a positive int and then thrown away** | `analyzeAdHocCalendarRequest` at `contracts/src/picker.ts:343-362`; absent from the candidate at `analyzeAdHocCalendar.ts:176-193` | Use it or drop it from the schema |
| 17 | **Early percentile ranks are meaningless.** The second row ever reported `rrRank = 100` against a single prior value | verified live via `get_skew`; `computeAnalytics.ts:151-158` ranks against whatever exists | Gate every rank on a minimum sample count |
| 18 | **The BSM drain is bounded and reports success while rows stay pending.** 800 rows per read, ~11.7 min budget, newest-first | `computeBsmGreeks.ts:72-80`, `leg-observations.ts:140-144` | Older rows can stay NULL indefinitely. Never treat NULL `bsm_iv` as "no such contract" |
| 19 | **Two `gateDrops` fields are hard-wired to 0 and never incremented**, yet they travel through the domain type, the port, the Zod contract, the web props and the backtest replay oracle, which diffs them | `candidate-selection.ts:318` **[verified]**, `ports.ts:227-228`, `contracts/src/picker.ts:315-318`, `replayPickerCohort.ts:286-290` | Delete them in one sweep across all five sites, or the oracle reports a mismatch |
| 20 | **Four core-type / contract-schema pairs mirror each other with no compile-time link.** "Add a field" is a 4-file edit whose only guard is a runtime Zod parse | `getChain.ts:37-56` vs `chain.ts:15-53`; `ports.ts:146-193` vs `picker.ts:102-146`; `ports.ts:112-133` vs `picker.ts:224-264`; `ports.ts:343-354` vs `picker.ts:343-362` | Keep a cross-seam test that feeds the real body through the real schema |
| 21 | **`apps/web` has its own typecheck that root `tsc` does not see.** `cd apps/web && tsc --noEmit` reports 25 errors across 6 files; 8 come from the untracked `src/screens/Analyzer 2.tsx` alone (file still present **[verified]**) | `apps/web/tsconfig.json` includes `src` | `rm` the copy artifact and run the app's own typecheck in CI |
| 22 | **No retention or prune job exists.** `leg_observations`, `skew_observations` and `risk_reversal_observations` are append-only forever; none of the 8 crons prunes | `schedule.ts:117-139` | History grows monotonically. Any unbounded read (`skew-observations.ts:73-75` has no time filter and no LIMIT) is a future outage |
| 23 | **`resolveEventExit` constructs a Date instant inside a module whose header forbids it** | `candidate-selection.ts:220` vs its header at `:30-32`; same pattern at `brakes.ts:82`, `computePickerSnapshot.ts:294` | If the rule is real, enforce it with a lint rule, not a comment |
| 24 | **Comments lie in three places.** The delta-band docblock says −0.55/−0.25 above constants reading −0.49/−0.30 (`candidate-selection.ts:48-53`); the header and docblock still say "25-multiple strike" for a filter retired at `:55-57`; `analyzeAdHocCalendar.ts:6, :126` cite `candidate-selection.ts:370-411` for a block now at `:433-453` | as cited | Delete stale prose on sight. A comment that names a line range will rot |

---

## 8. The simplification thesis

### The question that comes before the work

The picker's ranked output has **one** human-facing consumer, and it is not the app:
`useAnalyzerModel.ts:111` says the screen deliberately does not read the engine's candidates
**[verified]**, and `Analyzer.tsx:4-7` says the ranked rail and every scoring helper are gone. The
readers left are `get_picker_candidates` (`tools.ts:701`) and the settings "movers" diff
(`RuleSettingsModal.tsx:126`, `settings.routes.ts:75`). So the first decision is not how to simplify
the ranking. It is whether the ranking exists at all, or whether the pasted-calendar analyzer is the
product now.

**No audit could answer that** — nobody measured whether the owner actually calls
`get_picker_candidates`. That is a one-question decision only the owner can make, and everything
below branches on it.

### Branch A — the ranking stays (recommended shape)

**Modules: 4 in core instead of 17.**

| Keep as one module | Absorbs |
|---|---|
| `calendar-math.ts` (new, in `packages/core`) | `apps/web/src/lib/chain-math.ts` (252) + `chain-risk-reversal.ts` (112) + the two pure `useMemo` bodies from `useChainModel.ts:211-278` and `:285-324`, exported as `buildCohorts(rows, contractType, spot, carryOf)` and `buildPair(front, back)`. Fold `edge` and `forwardIv` into ONE function returning `{fwdIv, edge}`, killing the duplicated guard (`chain-math.ts:99-102` ≡ `useChainModel.ts:157-166`). Drop `atmStrike`, `STRIKE_SCALE`, `DAYS_PER_YEAR` from the public surface — only tests import them |
| `select.ts` | `candidate-selection.ts` minus `selectEventCandidates` (`:489-514`), minus `autoTuneTargetDelta` (`:118-130`), minus the two zero-forever drop counters (`:318`), minus the 6-parameter override surface, minus the unused `bsmPrice`/`DeltaRung` imports (`:36`, `:41`). Calls ONE extracted `buildRawCandidate(...)` that `analyzeAdHocCalendar.ts:158-168` also calls — this **deletes** a copy instead of adding a third |
| `score.ts` | `scoring.ts` cut to four terms: `fwdEdge` 40, `deltaNeutral` 30, `beVsEm` 20, `debitFit` 10. Drops `scoreEventCandidates` (`:326-340`), the weight-0 `context` array (`:244-257`) and with it the 60-row slope-history read, and `thetaCapturePct` (`:259-278`) with its three wasted `bsmPrice` calls |
| kernels, untouched | `fwd-iv.ts` (36), `breakevens.ts` (119), `realized-vol.ts` (32), `types.ts` (127), `rule-config.ts` (117) reduced to the four weights plus the DTE/delta/debit windows |

**Deleted outright:**

| What | Where | Lines |
|---|---|---|
| `apps/web/src/screens/Analyzer 2.tsx` | untracked copy artifact, 8 tsc errors | 688 |
| `apps/web/src/lib/chain-contract.ts` | 5 one-line import edits | 17 |
| `rules.ts` metadata tables | `:271-400` UI prose in a domain module, re-serialized into every snapshot at `computePickerSnapshot.ts:741`; `:402-565` serves the retired event bucket | ~293 |
| `event-rules.test.ts` | tests a dead table for a module that does not exist **[verified]** | 67 |
| `sizing.ts` | three representations of `{low:2, normal:2, elevated:1, crisis:0}` | 90 |
| `entry-gate.ts` rungs, penalty band, ladder, `resolveVixLadder`, the previous-snapshot self-read | three threshold systems over a once-a-day EOD series that cannot flap; the header at `:237-239` already concedes they move independently | ~330 of 371 |
| Type guard + re-declared enum + projection glue in the orchestrator | `computePickerSnapshot.ts:324-378` guards data the file's own comment says Zod already validated; `:293-300` and `:590-595` duplicate `brakes.ts` | ~250 of 763 |
| `gateDrops.termInverted` / `.eventBlackout` | one sweep across `candidate-selection.ts:293-295`, `ports.ts:227-228`, `contracts/src/picker.ts:315-318`, fixtures, `replayPickerCohort.ts:286-290` | ~20 across 5 files |

**Stages that collapse:**

- The 7-step orchestrator becomes 4: read cohort → gate (two comparisons) → select+score → persist.
  Steps 3d (gate resolution, `:563-610`), 4a (`zeroEventAdjustment`, `:658-660`) and 4b
  (`applyGatePenalty`, `:663`) disappear with the penalty multiplier and the events term.
- The gate becomes two lines: `if (vix >= 25) return noEntries;` and `if (openCount >= 6) return
  noEntries;`. Both brake evaluators (`brakes.ts:40`, `:62-65`) survive; both business-day walks
  (`brakes.ts:81-88`, `computePickerSnapshot.ts:293-300`) die.
- Injected deps go from 14 to about 6: chain, GEX, open calendars, recent closed, macro, rate. Gone:
  slope history (fed a weight-0 display entry), daily closes (fed `vrp`, weight 5), previous snapshot
  (fed only the hysteresis), rule overrides for 19 of 23 knobs.
- The two cohort SQL readers (`picker-chain.ts:44-95` ≡ `gex-snapshot.repo.ts:104-156`) become one
  parameterised reader — about 50 lines and one drift risk gone.
- `ChainBrowse.tsx:34-88`'s sort engine moves onto `DataTable`, which already has a second consumer
  waiting (`DataTable.tsx:24`).
- ONE `isThirdFriday` (`dte.ts:104-109`), ONE `DAYS_PER_YEAR`, ONE `STRIKE_SCALE`, ONE T function
  taking `root`. Nine T conventions become one.
- The 491-line React-renderer hook test becomes a plain function test, because the functions it
  tests no longer need a renderer.

**The rough diff.**

| Area | Now | After | Delta |
|---|---|---|---|
| `packages/core/src/picker` production | 3,162 (audit 2; my own `wc` over `domain/*.ts` + `application/*.ts` including tests totals 9,393 vs audit 2's 9,478 for the whole directory — figure is ±100 depending on which files count **[verified, flagged]**) | ~450 | **−2,700** |
| `packages/core/src/picker` tests | ~4,700 | ~1,400 | **−3,300** |
| `apps/web` chain stack production | 2,032 **[verified]** | ~1,400 (UI stays; 620 lines of math leave for core, ~700 of duplication and dead code die) | **−600** |
| `apps/web` chain stack tests | 1,201 | ~900, and no renderer | **−300** |
| Adapters (cohort read dedupe) | — | — | **−50** |
| MCP wire mapping (`toWire` per contract) | — | — | **−40** |
| Dead files | 772 (`Analyzer 2.tsx` 688 + `chain-contract.ts` 17 + `event-rules.test.ts` 67) | 0 | **−772** |

**Net: roughly −7,700 lines, 17 core picker modules down to 4, 14 injected deps down to 6, 76 knobs
down to about 12 — and `cd apps/web && tsc --noEmit` goes from 25 errors to 17.** About 600 of the
web lines and all 772 dead lines come out with **zero behaviour change**; the rest is the deliberate
score and gate cut.

### Branch B — the ranking goes

If the owner does not read `get_picker_candidates`, the honest answer is much smaller. Keep
`analyzeAdHocCalendar.ts` (215 lines), `score.ts` cut to four terms, `fwd-iv.ts`, `breakevens.ts`
and the promoted `calendar-math.ts`. Delete the universe scan, the gate, sizing, brakes, ranking and
snapshot persistence — `computePickerSnapshot.ts` (763), `entry-gate.ts` (371), `sizing.ts` (90),
`brakes.ts` (88), most of `rules.ts` (565), `previewPickerRuleOverrides.ts` (212) and their ~4,000
lines of test. That is roughly **−6,000 more** on top of Branch A's deletions, and the product
becomes: the chain table the owner already uses, plus "score the pair I picked".

### The order of work, and the thing that must go first

1. **Fix the ingest writer.** `fetchChain.ts:143` and `:135-138` must both derive from
   `parseOccSymbol(quote.occSymbol)`; flip `upsertContracts` off `onConflictDoNothing`
   (`leg-observations.ts:125`); backfill `contracts`; re-solve the affected `leg_observations`. Any
   deterministic engine built on today's `contracts` table inherits a silent cross-root contamination
   that no engine-side care can detect. Two lines, then a migration.
2. **Delete the dead weight** — the 772 lines above, plus `selectEventCandidates`,
   `scoreEventCandidates`, `rules.ts:402-565` and the two zero-forever drop fields. No behaviour
   change, so no test rewrite.
3. **Promote the client math to core** and lift the two `useMemo` bodies with it. Still no behaviour
   change; the server gets reusable math and the browser stops holding a second engine.
4. **Unify T.** One function, taking `root`. This is the only step in the list that changes numbers
   on screen, so it lands alone with a TOS comparison.
5. **Then** cut the score to four terms and the gate to two comparisons.

### Where the audits disagree, unsmoothed

1. **The root-ingest defect.** Audit 4 calls it the blocker that outranks everything. Audits 1, 2
   and 3 never mention it — they did not read ingest. I verified it is open today at
   `fetchChain.ts:143`, and `plans/analyzer-chain-HANDOFF.md:189` files it as OPEN under a heading
   that reads "IT UNDERCUTS THE ROOT WORK". Audit 4 is right. Note also that commit `555e748`
   ("carry OCC root so SPX and SPXW stop colliding") fixed the **read and display** path, not the
   writer — easy to mistake for a closed issue.
2. **Where the client math should live.** Audit 1 says move both `chain-math.ts` and
   `chain-risk-reversal.ts` into core verbatim. Audit 4 names only `atmIv` for promotion. Same
   direction, different scope; audit 1's is the cheaper move because the two files share constants
   that should merge anyway.
3. **`term_structure_observations`.** Audit 4 says delete the read path. Audit 3 keeps
   `analytics.routes.ts`, which serves it, because the wire shape is reusable. Both hold: keep the
   thin route, stop planning any engine around the table.
4. **A dead file counted as a live consumer.** Audit 2 lists `screens/Analyzer 2.tsx:561` among the
   consumers of `gateDrops`. Audit 1 proves that file is untracked and imported by nothing, and I
   confirmed it is still on disk **[verified]**. Audit 2's consumer list is inflated by one corpse.
5. **Line ranges for the duplicated candidate block.** Audits 1 and 2 cite
   `candidate-selection.ts:433-448`; audit 3 cites `:433-453`. The in-code comment cites `:370-411`
   and is stale. Trust the widest range and delete the comment.
6. **Picker directory LOC.** Audit 2 says 9,478 for the whole directory; my `wc -l` over
   `domain/*.ts` + `application/*.ts` totals 9,393 **[verified]**. Same order, ±100, depending on
   which subfiles count. Do not quote either as precise.
7. **Missing facts nobody produced.** (a) No measurement of the client-vs-server theta gap, so the
   T-mismatch magnitude is unknown. (b) No evidence the entry gate's hysteresis has ever changed an
   outcome in production. (c) No evidence anyone calls `get_picker_candidates`, which is the pivot
   between Branch A and Branch B. (d) No count of how much of the picker is reachable from a running
   worker cycle versus test-only. All four are cheap to answer and all four should be answered before
   the score is cut.
