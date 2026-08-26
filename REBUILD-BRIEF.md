# Morai — Rebuild Brief

Input document for the ground-up rebuild. Written 2026-08-25.

Companion: [docs/learnings/app-postmortem.md](docs/learnings/app-postmortem.md). Every claim
here that names a cost is sourced there.

**On law numbers.** The record supplies numbered laws in exactly one file:
`plans/analyzer-chain-HANDOFF.md`, laws #1, #2, #12, #13. Those are cited by their real
numbers. Everything else in section 3 is numbered `NN-n` for reference inside this document
only. Do not treat `NN-n` as a citation into the old repo.

---

## 1. Scope

Derived from what the record shows was used and what it shows was measured, not from
`REQUIREMENTS.md`.

### Must have

| Capability | Why it survives |
|---|---|
| **Per-calendar journal.** 30-minute RTH snapshots of price, greeks, and term structure per open calendar, with a rebuild path from raw observations. | The stated anchor: "If everything else fails, this must work" (`PROJECT.md`). It is also the feature that accumulated the most permanent holes, because it was live-write-only. Rebuild it with the repair path in place from day one, not a milestone later. |
| **Options chain ingest, dual-source.** Schwab for freshness plus CBOE for breadth, unioned and deduped per contract, every cycle. | Neither vendor alone works. Schwab's gateway 502s at `strikeCount ≥ 150`; narrowing to 50 moved the GEX flip 135 points overnight and missed 6 of 8 open position legs. CBOE alone is delayed. |
| **IV inversion and BSM greeks, computed in-house.** | Two reputable platforms disagreed by ~2 vol points on the same SPX contract at the same minute, enough to flip a term-structure gate's verdict. Vendor IV is a black box you cannot audit. Store raw and computed side by side. |
| **P&L ledger from fills.** Fill-by-fill cost basis, order-anchored disambiguation, roll handling. | The broker does not surface strategy-level realized P&L across a roll. A $1.50 roll credit coexisted with a −$169 realized loss. |
| **GEX snapshot with a DTE-windowed wall calculation.** | 0–7 DTE carries 44.3% of total \|GEX\| — noise for a calendar trader. Feeds `push-gex.ts`, which is live. |
| **MCP surface over all of it.** | Claude Code is a confirmed consumer. `tools/tradingview/` is the other. |
| **Schwab auth with a low-friction re-auth path.** | The 7-day refresh expiry is server-side and hard. It recurs weekly, forever. |

### Proven unnecessary

| Excluded | Evidence |
|---|---|
| **Automated weight fitting or rule optimization.** | 13 closed trades, one trader, one instrument, one regime. `STATE.md`: "9 free weights fit to 13 correlated trades is overfitting formalized." Any backtest must be structurally incapable of writing weights. |
| **Confidence percentages on any verdict.** | No calibration basis at n=13. Fabricated precision. |
| **Order execution of any kind.** | The advise/execute boundary (STRM-04) held across three milestones. Keep it. |
| **Multi-user, tenant isolation, API versioning.** | One trader. Bearer token plus JWT sufficed. |
| **A generic backtest DSL or strategy language.** | One strategy family. YAGNI, and the record already excluded it. |
| **Kelly / optimal-f sizing, ML regime classification.** | Both excluded on the same grounds: the sample cannot support the estimate. |
| **The refuted picker criteria.** | Ten of them, enumerated in the postmortem section 4 rank 9. Re-encoding any is the cheapest way to lose money. |
| **Smile-aware scenario IV.** | Researched DO-NOT-BUILD. TOS's own default holds each series' IV fixed for a single-strike calendar; smile interpolation would not have changed the number being matched. |
| **A tick-level or live-data-driven gate.** | The DISPLAY-LIVE / GATE-EOD law. Live ticks may change what a UI shows. They must never change what a gate decides. |

### Undecided — see section 5

A rendered web UI. This is the largest scope question in the rebuild and the record does not
settle it.

---

## 2. PORT / REWRITE / DROP

Line counts measured in this repo today. Verdicts marked *(audit)* come from the salvage
assessment. Verdicts on `apps/server`, `apps/web`, `packages/contracts`, and
`tools/tradingview` are mine, from these measurements — the audit did not cover them.

### Packages

| Module | Lines | Verdict | Justification |
|---|---:|---|---|
| `packages/quant/src/bsm.ts` + barrel | 177 src, 295 test | **PORT verbatim** *(audit)* | Zero runtime dependencies, imports nothing outside itself, 42 assertions including 14 fast-check properties, calibrated against named textbook fixtures. |
| `packages/shared` | 415 src, 485 test | **PORT wholesale** *(audit)* | 9 files, zero runtime deps. `occ-symbol.ts` (102 lines) is the identity codec the whole system depends on. `nyse-holidays.ts` and `rth-window.ts` encode calendar facts. One caveat below. |
| `packages/shared/settlement-timestamp.ts` | 66 | **PORT, then re-source** | Carries an `[ASSUMED]` 09:30 ET AM-settlement anchor with no cited source. Confirm it before the first greek is solved against it. |
| `packages/core/journal/domain/iv-inversion.ts` | 209 | **PORT** *(audit)* | Pure. Newton-Raphson with bisection fallback at `VEGA_THRESHOLD=1e-8`. Imports only `./bsm` and shared. Vega collapses near zero for deep ITM/OTM and short DTE; bisection is what saves it. |
| `packages/core/journal/domain/fill-pairing.ts` | 315 | **PORT the algorithms** *(audit)* | Four disambiguation rules from a five-round bug chain that displayed a +$395 trade as −$319,850. Classify from `positionEffect` only; derive from the first fill, never the calendar's status column; disambiguate shared legs by order-anchor intersection; net quantity per leg instead of trusting a status column. |
| `packages/core/journal/domain/bsm.ts` | 5 | **DROP** *(audit)* | Dead re-export shim left by commit `1baceaa`. |
| `packages/core/journal/application/computeBsmGreeks.ts` | 245 | **PORT the numbers, rewrite the code** *(audit)* | The design constants are measured, not chosen: `COMMIT_BATCH_SIZE=800`, `BSM_TIME_BUDGET_MS=700000` against a 900s queue cap, newest-first ordering, per-batch commit, `ok()` on budget exhaustion. Derived from 14.3–20 rows/sec measured throughput. |
| `packages/core/analytics/application/computeGexSnapshot.ts` | — | **PORT the window constants** *(audit)* | `NEAR_TERM_DTE_WINDOW = {min: 8, max: 45}`. The 45d ceiling: an unbounded window put the put wall 9.4% from spot vs 0.4% windowed. The 8d floor: the 8–14d bucket is 11.9% of gamma and still belongs to a maturing front leg. 15 was tried first and was wrong. |
| `packages/core/calendar/domain/cohort.ts` | — | **PORT the four scars** *(audit)* | `root` must be in any per-strike key (68.89% vs 24.69% IV collision measured). `bsmIv` has three states. A two-vendor union means row[0]'s spot is not every leg's spot. Mixed per-expiry carry changed the top-ranked pair in 56% and 17% of two live measurements. |
| `packages/core/calendar/domain/` + `picker/domain/` | 4,373 | **PORT as design spec, rewrite the code** *(audit)* | Encodes a 103-article research corpus plus every measured refutation. Framework-coupled application code, not pure leaves. Read it, extract the rules, write fresh. |
| `packages/core/journal/application/ports.ts` | 1,015 | **DROP** *(audit)* | Port interfaces specific to this hexagon's DI shape. Encodes no correctness lesson. |
| `packages/core/journal/index.ts` | 348 | **DROP** *(audit)* | Re-export barrel. |
| `packages/core` — everything else | ~28,000 prod | **REWRITE** | Use-case wiring against this schema and these ports. |
| `packages/adapters` — vendor quirk knowledge | — | **PORT as one vendor-notes file** *(audit)* | See section 3, NN-24. This is the highest-value salvage in the package and it is prose, not code. |
| `packages/adapters` — adapter code | 18,763 prod | **REWRITE** | Drizzle repos and HTTP clients shaped against a schema being replaced. |
| `packages/adapters/src/memory/` | — | **PORT the pattern, not the files** | One in-memory adapter per driven port, maintained alongside the real one. This is what made test doubles one-line functions. |
| Migrations `0028`, `0029`, `0030`, `0017`, `0010` | 19.1K | **PORT AS LAW, not SQL** *(audit)* | Repair migrations for a schema that will not exist. Their comments carry the measurements. Read them into section 3 and delete the files. |
| Migrations `0000`–`0027`, `0031` | — | **DROP** | DDL for a replaced schema. |
| `packages/contracts` | 6,837 prod | **REWRITE** | Hand-mirrored Zod shapes for the old API surface. Keep one pattern: a single adapter function annotated with the contract's response type restores a compile-time link that `tsc` enforces (injecting a wrong field failed with TS2741 at that line, instead of a 500 on first request). |
| Six `' 2'`-suffixed directories | 0 | **DROP** *(audit)* | Confirmed empty. Copy/merge clutter. |

### Apps

| Module | Lines | Verdict | Justification |
|---|---:|---|---|
| `apps/sidecar` | 5,776 (Python, venv excluded) | **PORT as-is** *(audit)* | Own venv, Dockerfile, FastAPI/Hypercorn app, pytest suite. Couples to the TypeScript side over HTTP only. `schwab-py` pinned to exactly 1.5.1. Hypercorn is required in prod because it dual-stack binds `[::]`; uvicorn cannot from the CLI. The single-writer advisory lock exists because concurrent token refresh triggers `invalid_grant`. |
| `apps/worker/src/journal-oracle.test.ts` | 693 | **PORT the fixtures and expected outputs** *(audit)* | 13 real ground-truth calendars, including two sharing a front-month leg and one with a stale status column. Any new fill-pairing implementation must pass these same 13 before it touches money. This is the only genuine oracle in the suite. |
| `apps/worker` | 4,755 prod | **REWRITE** | pg-boss handlers against the old ports. Port the operational design numbers (batch bounds, time budgets, cron offsets), not the handler code. |
| `apps/server` | 7,264 prod | **REWRITE** | Hono routes and MCP tools against the old contract set. Two patterns carry forward: opaque short-lived tickets for SSE auth (query-param JWTs leak into logs), and asymmetric JWKS verification, never a shared HS256 secret. |
| `apps/web` | 20,913 prod, 17,517 test | **DECIDE BEFORE ANYTHING ELSE** | Largest single write-off if the TradingView pivot holds. The only surface that can render the journal if it does not. See section 5. |

### Tools

| Module | Lines | Verdict | Justification |
|---|---:|---|---|
| `tools/tradingview/*.pine` (4 studies) | — | **PORT untouched** | Zero dependency on this codebase. `vol-state.pine` and `expected-move.pine` are live and verified. `breadth.pine:155` carries a known pre-existing const-string compile error. |
| `tools/tradingview/push-gex.ts` | — | **PORT untouched, with one schema constraint** | Zero imports from `packages/` or `apps/`. Connects to Postgres via Bun's native SQL against a raw `DATABASE_URL` and reads exactly one table: `gex_snapshots`, by column name. Either keep a table of that shape, or edit one query. |
| `tools/tradingview/backtest-expected-move.ts`, `verify-expected-move.ts` | — | **PORT untouched** | Zero application and zero database dependency. They fetch CBOE's CDN, FRED, and Yahoo directly. |
| `tools/tradingview/*.md` | — | **PORT** | The TradingView and Pine platform trap list — input persistence, the one-hour compile ban, silent symbol aliasing, the lying watchlist API. Summarized in section 5. |

### Test suite

| Group | Verdict | Justification |
|---|---|---|
| `journal-oracle.test.ts` | **PORT** | Above. |
| 59 files importing fast-check | **PORT the invariants, rewrite the harness** *(audit)* | Spanning quant, journal, calendar, picker, analytics, backtest, exits, shared, and web. The properties are real; the wiring is not. Two cautions: a property test can generate the adversarial input and assert on the wrong output, and a property test's own expected-value reconstruction can encode the same bug the implementation has. |
| The other ~300 files | **DROP as code, KEEP as a behavior checklist** | Pinned to these ports and adapters. They will not compile against a new structure. Read them once for behavior you would otherwise forget to reimplement. |

---

## 3. Non-negotiables

Correctness constraints the rebuild must satisfy on day one, because getting each one wrong
already cost real money or real data. Numbers in the "Cost" column are quoted from the source
that measured them.

### Data identity and writes

| # | Law | Cost of getting it wrong |
|---|---|---|
| NN-1 | Every composite key carries every column that genuinely discriminates a row — including one whose value is a single literal today. "It never varies today" is not "it can never vary." | 49.6% of every smile silently discarded (1,748 of 3,521 quotes); 30% of every skew snapshot (709 colliding keys, 1,632 rows); 629k rows nulled as unattributable. Three tables, three separate discoveries. |
| NN-2 | Identity is parsed from the row's own symbol, never from the label of the request that fetched it. | 1,294 of 26,115 contracts (5%) carried the wrong root and a paired off-by-one expiry, biasing every affected leg's T and greeks high. Root-only mismatches were exactly zero — proof of one writer bug, not two. |
| NN-3 | `ON CONFLICT` target must match the actual unique constraint. Use `DO NOTHING` for any batch that can contain an in-batch duplicate; `DO UPDATE` raises "command cannot affect row a second time" and aborts. | 75-minute chain-ingest outage with ~100 duplicate contracts. ~80-minute `calendar_ranking` outage. |
| NN-4 | `SELECT`-then-branch-`INSERT` is a TOCTOU race under READ COMMITTED. Always `onConflictDoNothing` and re-read. | A single collision aborted an entire calendar's remaining slots, then propagated up to abort the hourly run across every open calendar. |
| NN-5 | Chunk every batch insert at ≤2,000 rows. Postgres allows 65,534 bind parameters per statement. | A 175k-parameter insert failed outright in RTH UAT. |
| NN-6 | `onConflictDoNothing` makes a corrected backfill a silent no-op. Any backfill after a writer fix must explicitly flip to an upsert or delete-then-reinsert for its window. Wipe-then-reingest is not atomic across the step boundary. | A re-run of `backfill-transactions` after a sign fix reproduced the same wrong data. |
| NN-7 | Do not put a real foreign key on a table whose parent is rebuilt by delete-then-reinsert. Use a content-addressed soft reference. | `CASCADE` wipes the annotation the instant its parent is deleted; `RESTRICT` blocks the rebuild. Both defeat the table's purpose. |

### Money and units

| # | Law | Cost of getting it wrong |
|---|---|---|
| NN-8 | Every stored money field's UNIT is fixed and named. Dollars or index points, never inferred at the call site. | A +$395 trade displayed as −$319,850 (~100x). Five rounds of oracle-driven debugging to unpick it. |
| NN-9 | Direction comes from the vendor's own signed field, read once at the boundary and threaded through. Never re-derived from a mutable application column. | `openNetDebit` read 286.47 (two debits summed) instead of 32.35. Separately, deriving OPEN/CLOSE from `calendars.status` produced exactly −4.00, the observed prod regression. |
| NN-10 | Never `Math.abs()` a vendor's signed amount. It is the only field carrying direction. | Forced every downstream consumer to guess from `positionEffect` or record status. |
| NN-11 | Resolve an ambiguous fill-to-position match using co-occurring data from the same real transaction (the order id), never by guessing and never by orphan-parking unconditionally. | One calendar showed back-leg-only debit 62.50 instead of 10.20. All 13 calendars matched the oracle within $0.02 after the fix. |
| NN-12 | A scoped rebuild that widens its READ context must widen its RESET context by the identical rule. | Calendar A's rebuild marked a sibling context row processed; calendar B's reset never re-exposed it. It vanished from every future read. |

### Numbers that can be wrong without erroring

| # | Law | Cost of getting it wrong |
|---|---|---|
| NN-13 | `z.number().finite()`, never bare `z.number()`, on anything persisted to JSONB. `z.number()` accepts `Infinity`; `JSON.stringify` writes `null`; the next strict read fails. | An unguarded `pnlPct` divide-by-zero 500'd an entire endpoint for every row, not just the corrupted one, until manual SQL cleanup. Found independently twice. |
| NN-14 | Batch reads parse per row with `safeParse` and skip-and-warn. One corrupted blob degrades one entity, never the endpoint. | Same incident. |
| NN-15 | A solved numeric has three states, not two: `NULL` = never attempted, `'NaN'` = attempted and permanently failed, a number = solved. Every consumer filters both. | Collapsing them makes "wait, it's coming" indistinguishable from "this will never resolve." The distinction is also what proved a starvation bug without touching the math. |
| NN-16 | No market data for a slot means an honest gap. Never a fabricated, interpolated, or carried-forward value. Upserts are fill-only; a gap row may be replaced by a healed row, never the reverse. | A `spot ?? 0` fallback fed the IV bisection and rendered a degenerate payoff with a fabricated `schwab ·` provenance caption. `optional() ?? 0` on a vendor field fabricates a number. |
| NN-17 | Every percentile or rank carries its own `n` and renders null below a floor. | The second row a rank table ever wrote reported the 100th percentile, against one prior value. Production history depth at audit: 17 to 30 days, against the ~252 a 1-year rank needs. |
| NN-18 | One settlement-aware time-to-expiry function, branching on the contract's own root, for every leg of a position. | Nine T conventions coexisted, three inside one GEX path. On a 17/52-day pair the settlement-aware ratio was 0.32934 vs 0.33106 depending on root — roughly a factor of two in the resulting edge. |
| NN-19 | Construct and read a `Date` with matching methods. `Date.UTC` with UTC getters, or local args with local getters. Never mixed. | ~1% relative T error on a ~98-day expiry, corrupting FRED-rate interpolation and the parity carry solve. The repo's own docs call it the third instance. The test's "independent oracle" reproduced the identical construction, so it could not catch it. |

### Vendors

| # | Law | Cost of getting it wrong |
|---|---|---|
| NN-20 | Classify a vendor error by its actual response semantics. Never map every non-2xx to one code. Gate fallback on the call's outcome, not on credential freshness. | 5-day pipeline freeze behind a perfectly healthy token, because a 400 for a malformed symbol was reported as `AUTH_EXPIRED`. |
| NN-21 | Pin one canonical serialization format at every cross-language boundary and test it against the real producer's real output. | `+00:00` vs `Z` broke the Schwab→CBOE fallback silently. The pipeline ran on the degraded source for days with every health check green. |
| NN-22 | Verify data provenance, not health endpoints. Which upstream produced this specific row. | Same incident. |
| NN-23 | Probe vendor behavior against the live endpoint. Never assume it from docs or memory. | `VIX9DCLS` does not exist as a FRED series. `VXVCLS` is the real id for VIX3M, unrenamed since 2017. `13874A` and `13874+` are different COT datasets. A ticker resolving in TradingView's symbol search does not mean it resolves in `request.security()`. |
| NN-24 | Carry the vendor trap list forward as a file. | Schwab: chains accept only `$SPX` (one call returns both SPX and SPXW books); `strikeCount=50` is the empirically verified ceiling under the gateway's body limit; the trader API needs a resolved `accountHash`, never the raw account number; index quotes return `quoteTime: null`, so stamp receipt time. CBOE: timestamps are already UTC; SPX rows need `startsWith("SPX") AND NOT startsWith("SPXW")`. CFTC: all numerics arrive as strings, `_all` suffixes apply to three fields and not three others, never send `X-App-Token`. FRED: the missing-value sentinel is the literal string `.`. |

### Runtime and operations

| # | Law | Cost of getting it wrong |
|---|---|---|
| NN-25 | Attach an `error` listener to every EventEmitter, even one that only logs. Node rethrows an unlistened `error` as an uncaught exception. | 81-minute outage. pg-boss self-heals from a pooler blip; the only bug was that nobody was listening. |
| NN-26 | Three failure classes, three responses: boot-time I/O gets backoff then exit; a recoverable runtime error gets logged and ignored; an unexpected error gets logged with cause then a deliberate `exit(1)`. One blanket try/catch is worse than none. | Same outage. |
| NN-27 | A backlog drain reads newest-first, bounded, commits each batch in its own transaction, and returns `ok()` on budget exhaustion. | Oldest-first starved the live cohort: `putWall: null`, `flip: null`, `poi: 0` on every strike. An unbounded read plus per-row I/O produced a 56,232-row death loop with zero forward progress on every retry. |
| NN-28 | Cap every connection pool. Sum them against the pooler's ceiling with margin. | Four uncapped pools against a 15-client Supavisor ceiling produced five simultaneous unrelated-looking symptoms from one mechanism. |
| NN-29 | Workers and migrators use the direct/session Postgres URL. The transaction pooler cannot do LISTEN/NOTIFY, session advisory locks, or prepared-statement reuse. Connection-string `statement_timeout` is silently stripped — use `SET LOCAL` inside the transaction. | The BSM job timed out at 120s despite a 600s intent. |
| NN-30 | Job liveness and endpoint reachability are different checks. Log a per-run coverage line on success. | A stalled cron with a healthy endpoint is indistinguishable from a vendor outage. "Ran and healed nothing," "never ran," and "errored per slot" were all the same silence. |
| NN-31 | An index built to speed a filtered query becomes the slow part once it bloats. Check index size against table size. | A 222MB partial index timed out the job it existed to accelerate. Dropping it took the backlog from 11.8k to 584 in one cycle. |
| NN-32 | Bulk historical scans belong in an operator CLI, not a queue job. | The 900s handler cap is a hard ceiling on any full-history walk, and it already caused one death loop. |

### Security

| # | Law | Cost of getting it wrong |
|---|---|---|
| NN-33 | Verify the live issuer's actual JWT signing algorithm before writing verification code. Fetch the JWKS and verify asymmetrically. Never a shared secret from an assumed default. | HS256 was assumed because it was the provider's older default. The live project had switched to ES256. Every real user's token returned 401. The code passed review and presumably any hand-built test token. |
| NN-34 | An OAuth code and its redirect URL are bearer-equivalent secrets. They never render or log anywhere — client console, server logs, or error messages. Error responses on a re-auth endpoint are generic and never echo the code, state, or redirect URL. | — |
| NN-35 | An OAuth CSRF `state` is a single-use, TTL'd server-side nonce, validated and consumed in one atomic `DELETE ... RETURNING`. Not a string comparison. | A replayed exchange can otherwise succeed twice under a race. |
| NN-36 | SSE auth uses a short-lived opaque ticket exchanged server-side. Never a bearer JWT in a query string. | Query params leak into access logs and intermediary proxies. |

### Trading logic

| # | Law | Cost of getting it wrong |
|---|---|---|
| NN-37 | The advise/execute boundary is structural. No port resembling an order-placing or weight-writing port exists anywhere. | The only reliable version of "don't do this" in money code. |
| NN-38 | The backtest replays through the untouched live domain functions. If it needs a helper, the live engine exports it. Never a forked copy. | A forked copy drifts, and then a "verified" backtest validates a strategy that is not the one running. |
| NN-39 | Price entry and exit from different points in time. Same-slice pricing measures the bid-ask spread, not edge. | With a symmetric haircut fraction f, same-slice P&L collapses to `(1-2f) × Σ(spread widths) × qty` — for f=0.66, always negative, identical for any two candidates with the same spreads. |
| NN-40 | Where the live system persisted its own decision, require the replay to reproduce it exactly. A mismatch is a leakage bug, found with no code review. | The cheapest available check for percentile lookahead and late-solved derived values. Every input read in the oracle must fail loud; one silent degradation to a default fabricates a false positive. |
| NN-41 | Distinguish "no data" from "data, and every candidate was legitimately dropped." | Conflating them overstates the data-gap rate and mislabels honest zero-candidate cohorts as missing. |
| NN-42 | Gates near a noisy boundary are hysteresis-banded penalties, not cliffs. Crisis signals apply at market level, once per cycle, outside the candidate loop. | The per-pair term-inversion gate deleted exactly the trades with edge. Retired 2026-07-09. |
| NN-43 | No verdict coloring or threshold banding on an indicator without a documented source recorded first. | Indicators without research render neutral. Every board indicator was admitted with a citation. |
| NN-44 | Live ticks may change what a UI displays. They must never change what a gate, band, or hysteresis state decides. | Enforced by a repo-wide grep that the live-facing constants appear only in their two owning display components. |
| NN-45 | Never re-encode the refuted criteria. | Ten of them, listed in the postmortem section 4 rank 9. The old registry test asserted none appeared as rule ids and kept the criterion enum closed so one could not return under a new name. |

### Named laws from the record

These four carry real numbers, from `plans/analyzer-chain-HANDOFF.md`:

- **Law #1** — Grep every consumer before widening a shared read, and again after fixing one,
  because fixing the first hides the rest. Widening the chain contract by one field produced
  five separate bugs across two sessions.
- **Law #2** — The dangerous defects are the ones that cannot null themselves. A cross-root or
  cross-wing pair has every input present and finite, so it renders a clean, plausible, wrong
  number. Enforce identity by function signature, never by doc comment.
- **Law #12** — A root cause read off the code is a hypothesis. A root cause read off the wire
  is a finding. A code-read diagnosis blamed `?? 0` in two vendor adapters and shipped a
  migration that fixed nothing; CBOE had been sending open interest correctly the whole time
  (21,320 non-zero), and the real cause was ingest merge order.
- **Law #13** — A symptom sampled once is not a symptom. "OI is 0 for every contract" was true
  of the 04:00Z cohort and false of the 11:30Z one. `GROUP BY time, source` was the query that
  explained it.

---

## 4. Architecture guidance

Argued from the postmortem, not from doctrine.

### Keep

**Pure domain functions with zero I/O, wrapped by a thin use case.** This is what let the
backtest replay through the live scoring code instead of a fork, and what made the review gate
able to reason about scoring at all. It cost nothing and it paid repeatedly.

**Function-type ports with an in-memory implementation each.** Test doubles as one-line
functions, no mocking framework. `hexagonal-ddd.md` states it; `RETROSPECTIVE.md` names it as
the concrete return on the architecture. This is the half of hexagonal that earned its keep.

**Append-only observation tables with time-leading composite keys.** The volume projection held
(824,198 rows measured against a 10M revisit trigger), and the shape kept a real infrastructure
decision cheap to defer. Deferred, prepared for, never needed.

**The vendor sidecar.** One process owns the rotating token's whole lifecycle and the one
allowed streaming session, because they must be the same process. Every other service is a thin
HTTP client. Proven in prod.

**Three failure classes, three responses.** Section 3, NN-25 and NN-26.

### Drop

**The absolute ban on the UI importing pure math.** It cost a whole workspace package,
tsconfig references, and an ESLint boundary element to share 177 lines. A narrow,
mechanically-enforced carve-out already existed as precedent (RULE-01, scoped to the
`contracts → core` edge in `eslint.config.js`). Use that tool. One `math` leaf that anything may
import is simpler than a law plus its escape hatch.

**Four packages as the default shape.** Two of the four are smaller than single files inside
the third: `quant` is 177 source lines and `shared` is 415, while `journal/application/ports.ts`
alone is 1,015. Start with two: a dependency-free math-and-primitives leaf, and everything else.
Split again only when a second consumer actually appears.

**A hand-mirrored `contracts` package as the wire boundary.** It has no compile-time link to the
domain type it mirrors, so drift survives until a runtime Zod parse fails on a live request.
Keep the fix instead of the package: one adapter function annotated with the response type,
which makes `tsc` fail at that line.

**DDD-lite bounded contexts as a directory-structuring device.** The evidence of its cost is a
348-line re-export barrel and a 1,015-line ports file, neither of which encodes anything. The
evidence of its benefit is absent from the record.

**"Swap flexibility" as an architecture justification.** One swap happened in the system's life:
Railway Postgres to Supabase Postgres, a connection-string change. pg-boss and the Schwab
adapter were never replaced. Do not pay structural cost for a hypothetical.

### Add

**A repair path shipped with every writer, not a milestone later.** Phase 25 stopped bad writes
and made things worse by replacing visible garbage with silent, unrecoverable skips. If the raw
source survives, the rebuild path exists from day one or the writer does not ship.

**One place where a number and its reproducing query live together.** `docs/calendar-engine/
measurements.md` is the model. Migrations 0028/0029/0030 are the model at the schema level.
This is the single highest-value documentation pattern the old system produced.

---

## 5. The TradingView question

**This is the largest scope decision in the rebuild and it is yours to make. The record does
not settle it.**

### The decision as recorded

2026-08-05: "TradingView = cockpit, MORAI = math engine (apps/web to be deleted)." The
in-TradingView board was killed at the same time, described as "a text table on a chart"
mirroring stale pushed numbers.

### Evidence for it

- Two Pine studies are live and independently verified. `vol-state.pine` computes VRP and term
  structure with **zero MORAI dependency**. `expected-move.pine` shipped as its own script,
  three-way verified, with sigma reconciled to 0.6148% script vs 0.6147% plotted.
- `push-gex.ts` couples to the entire application through **one raw SQL read of one table**
  (`gex_snapshots`, by column name). No imports from `packages/` or `apps/`. The two backtest
  tools have zero application and zero database dependency at all.
- The backtest work that produced the most defensible trading findings of the last month —
  the VIX1D 1.108 haircut on n=1,072 sessions, the Monday weekend-premium finding, the VVIX
  refutation on n=5,088 — ran entirely outside the application.
- `apps/web` cost three mobile redesigns and a 708-call-site design-system migration in the
  three months before the pivot.

### Evidence against it

- **The journal has no TradingView representation.** Pine cannot render a per-calendar greek
  and vol lifecycle over the life of a trade. That is the system's stated anchor. If the UI
  goes, the anchor's only rendered surface goes with it.
- **The cockpit is fragile in ways the record documents at length.** `indicator set --inputs`
  does not persist — a reload silently reverts it, so every push needs a Cmd+S. TradingView
  bans compiling for one full hour after three consecutive failed compiles. The MCP watchlist
  API reports both false failures and false successes, and only a screenshot is ground truth.
  Unentitled symbols silently alias to a substitute rather than erroring (`CBOE:SPX` →
  `SPCFD:SPX`, `CBOE:VIX` → the delayed feed). On macOS the CDP debug port only survives from a
  Terminal-owned foreground process, and TradingView self-relaunches on auto-update without the
  debug flag. Making that the primary surface makes those failure modes load-bearing.
- **The pivot has not been executed.** `apps/web` is still 38,430 lines in this repo, and
  `CLAUDE.md` still describes it as live and deployed at morai.wtf.

### The question you actually have to answer

Not "keep or delete apps/web." It is:

> **Does the journal need a rendered surface, or is MCP-to-Claude-Code sufficient for it?**

If MCP is sufficient, the rebuild ships no browser code at all: a server, a worker, a sidecar,
an MCP surface, and the Pine studies. That removes ~20,900 production lines and ~17,500 test
lines from the scope, plus the entire class of UI defects the postmortem catalogues — jsdom
blindness, dual coordinate systems, invisible CSS failures, the mobile tree-swap state reset.
Roughly a quarter of the codebase and, judging by the phase count, a larger share of the effort.

If it is not sufficient, build the smallest possible thing that renders the journal lifecycle
and nothing else. Not a dashboard. One chart, one table, on one route, on desktop. The record
shows no evidence that the picker table, the regime board, the analyzer, or the mobile
experience were used for anything the MCP surface could not answer — and it shows that every one
of them cost a phase.

Three constraints if any browser code ships:

- **Mobile is a dedicated component tree or it is nothing.** Responsive reflow over desktop DOM
  passed every automated check and failed the user's phone check verbatim. A dedicated tree
  passed. Budget for the tree-swap cost: crossing the breakpoint unmounts one tree and mounts
  the other, resetting local UI state and reconnecting any EventSource.
- **Use a real charting library.** Hand-rolled SVG produced the same bug class repeatedly —
  overflow, marker pile-up, fixed-domain clipping — each fixed with another hand-clamp. Native
  clipping kills the class structurally.
- **jsdom cannot see geometry.** A percentage-height container collapsing to 0px, a coordinate
  system drifting 16%, and a closed `<details>` unreachable by CSS were all invisible to 3,175
  green tests. Anything geometric needs a real browser at a size the test harness does not
  hardcode.

**My reading of the evidence, offered as input and not as a decision:** the TradingView pivot
is well-supported for everything that is a *live market read* — vol state, expected move, gamma
levels, breadth. It is unsupported for the journal, because Pine cannot draw it. That points at
a third option the record does not name: keep the pivot, and rebuild a single-purpose journal
viewer rather than a dashboard.

---

## 6. Open questions

Things the record does not answer.

1. **Does the journal need a rendered surface?** Section 5. Everything about the rebuild's size
   follows from this answer.
2. **Is the TradingView pivot still the intent?** It was recorded 2026-08-05. `CLAUDE.md` still
   describes `apps/web` as live. Confirm before anything is deleted.
3. **`settlementTimestamp`'s AM anchor.** The 09:30 ET constant is flagged `[ASSUMED]` with no
   cited source. It sits under every T, every greek, and every forward-vol calculation. Confirm
   or re-source it before the first solve.
4. **`push-gex.ts`'s schema dependency.** It reads `gex_snapshots` by column name. Is that shape
   a constraint on the new schema, or is a one-query edit acceptable?
5. **The strike-selection simulation.** A 10-year SPX run inverted the retail prior, was
   attributed to a percent-of-debit measurement artifact, and the absolute-dollar re-run was
   left pending as of 2026-08-25. Unresolved. Do not act on the inverted finding.
6. **The Forward Factor percentile regression.** Memory records this as owed: regress
   FF-percentile against realized P&L on our own SPX history. Never done. The engine's headline
   ranking term is therefore unvalidated against our own outcomes.
7. **The index-vs-single-name sign flip.** Recorded as `claimed`, not verified: a slope-to-return
   relationship that flips sign between single names and an index. If true, it invalidates every
   ported single-name rule and rescaling does not fix it. Verify before encoding any slope term.
8. **Is it still one trader, one instrument?** Single-user scope was a deliberate exclusion. It
   removes tenant isolation, RLS-as-authz, and API versioning from the rebuild. Confirm it holds.
9. **Does the hosting stack stay?** Railway plus Supabase plus Vercel. Several laws in section 3
   (NN-28, NN-29) are specific to Supavisor. Railway's own traps — `railway domain` provisions a
   domain as a side effect of "checking" one, `railway up` reports `commitHash: null`, git-push
   deploys SKIP silently on watch-path misses — carry forward only if Railway does.
10. **Where did "147k lines" and "~4,000 tests" come from?** I measured 170,016 lines and 360
    test files. I could not reconcile either figure and did not adopt them.
