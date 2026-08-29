# Salvage

About 170,000 lines of `apps/` and `packages/` were deleted and are being rebuilt from
scratch. This directory is what was carried out: the code that had no dependency on what
died, and six documents that extract the knowledge from the code that did. Nothing here
is a structure to copy — it is evidence, and `../REBUILD-BRIEF.md` holds the verdicts it
supports.

79 files, excluding this one.

---

## Warning — read before solving a single greek

`code/shared/src/settlement-timestamp.ts` carries an **`[ASSUMED]` 09:30 ET AM-settlement
anchor with no cited source.** Its own comment says so: *"no cited source pins down the
exact BSM T=0 instant for AM-settled options."*

That instant sits under every time-to-expiry, therefore under every greek and every
forward-vol number in the system. **Re-source it before the first greek is solved against
it.** Two things make that cheaper than it sounds:

- **The scope is narrow.** The assumption fires only for root `SPX` on the exact 3rd
  Friday of a month. `SPXW`, and any non-3rd-Friday date, settle PM at 16:00 ET — that
  branch is not assumed.
- **The fix is one line.** The file isolates the anchor as `AM_SETTLEMENT_HOUR` /
  `AM_SETTLEMENT_MINUTE` precisely so a correction touches nothing else.

The mechanism, and why the sign of the error flips by root, is written up in
`trading-rules-spec.md` §2.2–2.3.

---

## Start here

**Read these three before writing anything.**

1. **`../REBUILD-BRIEF.md`** — the only document with verdicts. It says PORT, REWRITE, or
   DROP for every module, and it decides whether `apps/web` is rebuilt at all. Everything
   in this directory is evidence *for* those verdicts, so read the verdicts first or you
   will not know what the evidence is for.
2. **`../docs/learnings/LAWS.md`** — 101 numbered laws, opening with the ten that cost the
   most. Its own README says read it before the data layer, the job layer, or the money
   layer. These are failure modes that do not announce themselves: keys that silently drop
   half a batch, numbers that lie without erroring.
3. **`invariants.md`** — what must stay true, salvaged from 59 property-test files. Read it
   for the claims, and note the `SUSPECT` flags: the document marks its own vacuous and
   self-referential tests rather than presenting them as proof.

**Then read at the gate, when you are about to build the thing.**

| Before you build | Read |
|---|---|
| Any vendor client | `vendor-notes.md` |
| The calendar or picker engine | `trading-rules-spec.md` |
| Anything that consumes a tuning constant | `measured-constants.md` |
| The server or the worker | `platform-patterns.md` |

**One hard gate.** Any new fill-pairing implementation must pass the 13 real calendars in
`oracle-fixtures.md` **before it touches money.** This is the only genuine oracle the old
suite had. The bug it was built to catch displayed a +$395 trade as −$319,850.

---

## The six extraction documents

Written by reading the application code before it was deleted. Prose, not code.

| File | Hook |
|---|---|
| `vendor-notes.md` | 435 items. How Schwab, CBOE, FRED, CFTC and Alpaca actually misbehave — Schwab reports `openInterest:0` outside RTH, its chain gateway 502s on an unscoped request, and one payload carries strike in two different conventions. |
| `invariants.md` | 130 items. What the system must keep true, plus the two score terms that were measured and deleted, and every property test flagged where it proves nothing. |
| `measured-constants.md` | 31 constants, each with the experiment or the incident behind it — and a closing section naming the ones that are free to change. |
| `trading-rules-spec.md` | The calendar and picker engines as a specification, including the refutations: gates that were researched, measured, and are explicitly blocked from being re-encoded. |
| `oracle-fixtures.md` | 13 real calendars with exact IDs, prices and expected outputs, the two hard cases, and the four disambiguation rules with what breaks without each. |
| `platform-patterns.md` | Six mechanisms from `apps/server` and `apps/worker` that carry real production damage behind them. Everything else in those two apps was boilerplate. |

## `code/` — copied verbatim, imports need rewiring

Zero *runtime* dependencies on anything deleted — but the files were copied byte-for-byte
out of a workspace that no longer exists, so **they do not compile as they sit.** Three
specifiers in `code/domain/` need attention before anything here builds:

- `./bsm.ts` — resolves to nothing here. The kernel now lives at `code/quant/src/bsm.ts`.
- `@morai/shared` — a workspace package name. Needs the new workspace to provide it.
- `./calendar-events.ts` — **was not salvaged.** `fill-pairing.ts` imports the types
  `RawFill`, `AggregatedFill` and `CalendarEvent` from it. Reconstruct them from
  `oracle-fixtures.md`, which documents the fields and their units.

| File | Hook |
|---|---|
| `code/quant/src/bsm.ts` | The Black-Scholes kernel. Imports nothing outside itself. |
| `code/quant/src/bsm.test.ts` | 42 assertions, 14 of them fast-check properties, calibrated against named textbook fixtures. |
| `code/quant/src/index.ts` | Barrel. |
| `code/quant/{package.json,tsconfig.json,vitest.config.ts}` | Build and test config for the package. |
| `code/shared/src/occ-symbol.ts` + `.test.ts` | The OCC/OSI 21-character symbol codec. The identity function the whole system depends on — a root read from the wrong place caused three separate key-collision incidents. |
| `code/shared/src/settlement-timestamp.ts` + `.test.ts` | AM/PM settlement instant, DST-safe via `Intl`. **Carries the `[ASSUMED]` anchor — see the warning above.** |
| `code/shared/src/nyse-holidays.ts` | Full-closure NYSE holidays. Pure data, zero imports. Half-days are deliberately not its job. |
| `code/shared/src/rth-window.ts` | The RTH gate, 09:30–16:00 ET, weekdays only. |
| `code/shared/src/retry.ts` + `.test.ts` | `retryWithBackoff`, written after the 2026-07-23 outage killed both services on their first unguarded `await`. It retries; it deliberately does not classify. |
| `code/shared/src/result.ts` + `.test.ts` | `Result<T,E>`. Eight lines. The reason the codebase has no thrown-error control flow. |
| `code/shared/src/assert.ts` + `.test.ts` | `assertDefined`. The sanctioned alternative to `!`. |
| `code/shared/src/percentile-rank.ts` | Inclusive trailing-window percentile. Load-bearing: the calendar engine ranks by percentile because absolute thresholds do not transfer across underlyings. |
| `code/shared/src/index.ts` | Barrel. |
| `code/shared/{package.json,tsconfig.json,vitest.config.ts}` | Build and test config for the package. |
| `code/{quant,shared}/tsconfig.tsbuildinfo` | Compiler caches that rode along with the copy. Delete them. |
| `code/domain/iv-inversion.ts` + `.test.ts` | Newton-Raphson with a bisection fallback. The fallback is the point: vega collapses near zero for deep ITM/OTM and short DTE. Guards the European no-arb bound, never American intrinsic — SPX is European-style. |
| `code/domain/fill-pairing.ts` + `.test.ts` | The four disambiguation rules from a five-round bug chain. **Two different fields, two different jobs — do not merge them:** classify OPEN/CLOSE from `positionEffect` (this file, D-02), but derive buy/sell from the sign of `transferItems[].amount` in the adapter (`vendor-notes.md`). Deriving *side* from `positionEffect` is the bug that showed a +$395 trade as −$319,850. Derive from the first fill, never the calendar's status column. |

## `oracle/`

| File | Hook |
|---|---|
| `oracle/journal-oracle.test.ts` | The 13 ground-truth calendars as runnable code. `oracle-fixtures.md` is its prose companion; this is the executable gate. |

## `migrations/` — kept for the comments, not the SQL

The schema they repair will not exist. Their headers carry the measurements.

| File | Hook |
|---|---|
| `0028_repair_contract_root_expiration.sql` | Ingest wrote `root` from the requested chain label instead of the contract's own symbol. The repair reads it back out of the OCC symbol. |
| `0029_skew_rr_root_key.sql` | Both skew tables were keyed without `root`. Series restarted. |
| `0030_skew_contract_type_key.sql` | 0029 added `root` and stopped one column short — calls and puts then collided on the same key, dropping 1,748 rows a cycle. History was recovered from delta's sign. |
| `0017_calendar_event_annotations.sql` | Annotations kept orthogonal to events, so a delete-then-reinsert rebuild does not destroy user data. A soft reference, deliberately not a foreign key. |
| `0010_gex_wall_numeric.sql` | Gamma wall columns widened to `numeric`. A float strike is a wrong strike. |

## `python/sidecar/` — ported as-is

FastAPI Schwab sidecar. Couples to the TypeScript side over HTTP only, so it survived the
deletion untouched. `venv` excluded; `schwab-py` is pinned to exactly 1.5.1.

| File | Hook |
|---|---|
| `main.py` | App entry and route wiring. Hypercorn, not uvicorn — prod needs the dual-stack `[::]` bind. |
| `token_store.py` | Schwab token persistence. Access token lives 1800s. |
| `advisory_lock.py` | Single-writer Postgres advisory lock. Exists because concurrent token refresh triggers `invalid_grant`. |
| `reauth_admin.py` | The manual re-auth dance. `login` mode beats the authurl/exchange race. |
| `chain_proxy.py` | Option chain passthrough. |
| `positions_proxy.py` | Account positions passthrough. |
| `stream_proxy.py`, `streamer.py` | Schwab streaming socket and its HTTP front. |
| `config.py`, `health.py`, `seed_token.py` | Env config, liveness, first-token bootstrap. |
| `Dockerfile`, `requirements.txt`, `pytest.ini`, `.gitignore` | Build and test setup. Keep the pins. |
| `tests/` (12 files) | pytest suite: lock, token store, chain, positions, stream, streamer, keepalive, re-init, re-auth, health. |

## `tools/tradingview/` — zero dependency on the deleted code

| File | Hook |
|---|---|
| `vol-state.pine` | Live and verified. The two questions a calendar seller asks, plotted over time. Zero MORAI dependency. |
| `expected-move.pine` | Live, 3-way verified. The hero number is the *remaining* move, not the fixed band. |
| `gamma-levels.pine` | Dealer gamma structure on the price axis. Fed by `push-gex.ts`. |
| `breadth.pine` | Advance/decline read for a calendar seller. **Known pre-existing const-string compile error at line 155.** |
| `isotropic-trend.pine` | **Third-party, not ours** — "Smart Trader, Episode 06", 1,877 lines, no `MORAI ·` prefix. Vendored reference only. |
| `push-gex.ts` | Pushes GEX levels onto the live chart. Its one coupling: it reads the `gex_snapshots` table by column name over a raw `DATABASE_URL`. Keep that shape or edit one query. |
| `backtest-expected-move.ts` | Calibration backtest. Fetches CBOE, FRED and Yahoo directly — no app, no database. |
| `verify-expected-move.ts` | Independent verification of the same study, by a second route. |
| `README.md` | How the studies fit together. |
| `backtest-expected-move.md` | The backtest writeup — including the refuted VVIX flag, killed because the regime tag was read at the close of the day it was predicting. |
| `watchlists-calendar.md` | The three SPX calendar watchlists, and the TradingView API traps that lie in both directions. |

---

## The sibling knowledge set

Two things live outside this directory and outrank most of what is in it.

- **`../docs/learnings/`** — **336 numbered entries** across five citable files: `LAWS.md`
  (101), `vendors-and-infra.md` (90), `domain-trading.md` (53), `refuted.md` (53),
  `process-and-verification.md` (39). Every entry is numbered so it can be cited by ID.
  `app-postmortem.md` sits alongside as the narrative companion.
- **`../REBUILD-BRIEF.md`** — the PORT / REWRITE / DROP verdict for every module, which
  this directory implements. If a file is here, that document says why.

Read the verdicts. Then read the evidence.
