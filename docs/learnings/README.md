# Learnings

The application code is being deleted and rebuilt. This directory is what survives.

Everything here was paid for once — in outages, in silently dropped rows, in money
computed wrong, in weeks spent debugging the wrong subsystem. None of it is theory. The
point of writing it down is to refuse to relearn it.

**Harvested 2026-08-25.**

---

## How to use this

Read [LAWS.md](LAWS.md) before writing the new system's data layer, job layer, or money
path. Read [refuted.md](refuted.md) before adopting any belief about calendar spreads or
picker criteria — several plausible, published, credible-sounding ones are already dead.
Read [vendors-and-infra.md](vendors-and-infra.md) the moment you touch a vendor that
appears in it.

Every entry carries an id so it can be cited in code comments, commit messages, and
review findings.

| Prefix | File | Meaning |
|---|---|---|
| `L###` | [LAWS.md](LAWS.md) | Stack-independent engineering truth |
| `D###` | [domain-trading.md](domain-trading.md) | Options, vol and calendar-spread fact |
| `V###` | [vendors-and-infra.md](vendors-and-infra.md) | Trap in an external dependency |
| `P###` | [process-and-verification.md](process-and-verification.md) | How to know work is actually done |
| `R###` | [refuted.md](refuted.md) | Disproved belief or abandoned approach |

Each learning appears in exactly one file. The others cross-reference it by id rather
than restating it.

---

## The files

| File | Entries | Hook |
|---|---|---|
| [LAWS.md](LAWS.md) | 101 (L001–L101) | The centrepiece. Silent row loss, backlog death loops, numbers that lie, failure handling, boundaries. Opens with the ten that cost the most. |
| [domain-trading.md](domain-trading.md) | 53 (D001–D053) | Measured options and vol knowledge, split hard into verified and claimed. Independent of any codebase. |
| [vendors-and-infra.md](vendors-and-infra.md) | 91 (V001–V091) | Every trap in Schwab, CBOE, FRED, CFTC, Alpaca, TradingView, Recharts, Tailwind, Supabase, pg-boss, Bun, Vitest, Railway, Vercel, macOS/iCloud and the agent harness. Conditional on the vendor. |
| [process-and-verification.md](process-and-verification.md) | 39 (P001–P039) | A green test suite is the most reliable way this project ever shipped a production bug. Includes the numbered catch ledger. |
| [refuted.md](refuted.md) | 53 (R001–R053) | Beliefs held, acted on, and disproved — plus 31 approaches tried and abandoned. |

`app-postmortem.md` sits alongside these. It is a companion deliverable from the same
2026-08-25 harvest, written as a narrative postmortem of v1 rather than as a citable
index. The five files above are the reference set.

---

## The five things most likely to be re-broken

If you read nothing else:

1. **A composite key missing a discriminator drops half your rows and never errors** ([L001](LAWS.md#l001-a-composite-key-missing-a-true-discriminator-silently-drops-30-50-of-every-batch)). Three tables, three incidents. 30% then 49.6% of every batch.
2. **A stored number without a pinned unit is a bug waiting** ([L021](LAWS.md#l021-pin-the-unit-of-a-stored-numeric-field-not-just-its-type)). A +$395 trade displayed as −$319,850.
3. **A green suite is not evidence** ([P001](process-and-verification.md#p001-a-green-suite-alone-is-never-sufficient-at-the-verify-gate)). 3,175 passing tests while the chart did not render at all in production.
4. **A vendor threshold does not transfer to a different underlying** ([D004](domain-trading.md#d004-a-vendors-absolute-vol-point-threshold-does-not-transfer-to-a-different-underlying)). The published gate fires 0 times in 2,465 candidates and looks like it is working.
5. **A regime tag readable only at the close of the day you are predicting is the answer, not a predictor** ([R011](refuted.md#r011-high-vvix-predicts-wider-expected-move-tails)). It faked a doubled tail risk that vanished on prior-close tagging.

---

## What survives in code

A separate salvage audit graded the existing codebase. Verdicts, with measured sizes.

| Verdict | What | Notes |
|---|---|---|
| **PORT** | `packages/quant` | 177 real lines (BSM plus greeks, 4-line barrel). Zero runtime dependencies. 42 assertions, 14 of them fast-check properties, calibrated against named textbook fixtures |
| **PORT** | `packages/core` IV inversion | 209 lines. Newton-Raphson with bisection fallback. Pure; imports only the BSM kernel and shared. Constants: vega threshold 1e-8, 50 iterations, 200 bisection steps |
| **PORT** | `packages/shared` | 415 real lines across 9 files, zero runtime dependencies. The OCC symbol codec (102 lines) is the identity the whole system depends on; NYSE holidays and the regular-hours window encode calendar facts. Caveat: `settlement-timestamp` (66 lines) carries a flagged ASSUMED 09:30 ET AM anchor with no cited source — re-source it |
| **PORT** | `fill-pairing.ts` | 315 lines, pure. Four disambiguation rules distilled from a five-round money bug — [L071](LAWS.md#l071-fill-classification-four-rules-learned-in-five-rounds) |
| **PORT** | `journal-oracle.test.ts` fixtures | 693 lines replaying 13 ground-truth production calendars. Any new fill-pairing implementation should be required to pass them — [P018](process-and-verification.md#p018-build-a-validated-oracle-before-touching-money-code) |
| **PORT** | `apps/sidecar` | 2,579 Python lines across 12 files plus 2,958 test lines across 10. Own venv, Dockerfile, FastAPI app. Coupled to the TypeScript side only over HTTP — genuinely separable |
| **PORT** | `tools/tradingview` | Four Pine studies plus three scripts. `push-gex.ts` touches the app only through one raw SQL read of a `gex_snapshots`-shaped table at `DATABASE_URL`. The two expected-move scripts have no app or database dependency at all — they fetch CBOE, FRED and Yahoo directly |
| **PORT AS NUMBERS** | GEX cohort window, BSM batch tuning | The 8-45 DTE window ([D001](domain-trading.md#d001-meaningful-gamma-walls-need-both-tails-cut-8-to-45-dte)) and the batch-size and time-budget figures ([L016](LAWS.md#l016-commit-each-bounded-batch-in-its-own-transaction-exit-ok-on-budget-exhaustion-and-resume-for-free-off-the-pending-predicate)) are measured constants, not code |
| **PORT AS LAW** | Migrations 0010, 0017, 0028, 0029, 0030 | Port the lessons, not the SQL — [L001](LAWS.md#l001-a-composite-key-missing-a-true-discriminator-silently-drops-30-50-of-every-batch), [L002](LAWS.md#l002-identity-comes-from-the-rows-own-symbol-never-from-the-request-that-fetched-it), [L010](LAWS.md#l010-never-foreign-key-a-satellite-table-to-rows-that-a-rebuild-deletes-and-recreates), [L011](LAWS.md#l011-money-and-strike-columns-are-numeric-never-integer) |
| **PORT AS SPEC** | `calendar/domain` and `picker/domain` | 4,373 lines encoding a 103-article research corpus as scoring and gating code. Framework-coupled — read it as a design spec, not as code to lift |
| **MIXED** | The test suite | 324 test files; 59 use fast-check. The property tests are worth re-porting as invariants. The rest are pinned to this repo's ports and adapters and serve as a behavior checklist |
| **DROP** | `journal/application/ports.ts` (1,015 lines), `journal/index.ts` (348 lines) | Pure dependency-injection wiring. Encodes no correctness lesson. Define fresh port shapes against the new schema |
| **DROP** | Six empty `' 2'`-suffixed directories | Copy or merge clutter, all confirmed empty. Not a second implementation |
| **DROP** | Browser-side pricing math | Already deleted once — [R036](refuted.md#r036-browser-side-bsm-and-greeks-math) |

---

## Sources harvested

Ten source groups, all on 2026-08-25. The first nine were read by ten agents in one pass; the tenth
needed a second pass of five, for the reason given below the table.

| Source group | What it held |
|---|---|
| `.remember/` | `archive.md`, `recent.md`, 60 `today-*.md` daily logs, `logs/` |
| `.planning/` core | `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `MILESTONES.md`, `PROJECT.md`, `RETROSPECTIVE.md`, `config.json` |
| `.planning/phases/` 23-32 | VIX3M ingestion through the rule-settings modal |
| `.planning/phases/` 33-42 | Chart migration, TOS parity, three mobile redesigns, re-auth, live spot, journal repair, design system |
| `.planning/` misc | `debug/`, `research/`, `notes/`, `todos/`, `milestones/` |
| `docs/architecture/` | All 18 files |
| `docs/` rest | `calendar-engine/`, `research/`, `iv-engine-discrepancy-and-solver.md`, `tos-studies-learnings.md` |
| `plans/` and `tools/` | Analyzer handoffs, the TradingView studies and scripts, `knowledge-base/` |
| Salvage audit | `packages/`, migrations, `apps/sidecar`, the test suite |
| Claude external memory (second pass) | 60 `morai-*.md` files + `MEMORY.md`, outside the repo — see the note below |

A second pass ran the same day over a **tenth source group the first pass never read**: the 60
`morai-*.md` files in Claude Code's external project-memory directory, plus its `MEMORY.md` index.
These live outside the repo, at
`~/.claude/projects/-Users-chiragpersonalmac-Desktop-morai-trading-dashboard-and-tools/memory/`.

They are a different corpus from `.remember/` above, and the densest source in the project — most
entries already carry explicit `LAW:` sentences. The first pass assigned them to one agent, which
died by exceeding its 64,000-token output limit, so none of it reached the harvest. The second pass
split the corpus across five agents to stay inside the cap.

It read 61 files and harvested 194 items. **143 were already covered** by the 285 entries the first
pass had written from the other nine groups — a 74% discard rate, which is the expected outcome for
a corpus that distils the same history the other sources describe. The 51 that were genuinely new
became L090–L101, D048–D053, V070–V090, P033–P039 and R049–R053. Of the 143 discarded, 41 carried a
number, quote, commit or date the existing entry lacked; those were folded into the existing entry
rather than dropped.

Entries were appended, never renumbered — L001–L089 and their siblings were already cited by id
from four files and from `REBUILD-BRIEF.md` at the time of the second pass.

The same law usually appeared in three of these in three different wordings — an external
memory note, a debug write-up, and a retrospective line. This directory states each one
once, in its strongest form, with every source's evidence merged into it. Where two
sources disagreed on a number, both are recorded rather than reconciled silently
([P023](process-and-verification.md#p023-preserve-a-sources-self-contradiction-verbatim)).

---

## A note on the 250-line rule

This repo caps a doc at 250 lines and says to document current state, not history
([docs/docs-on-docs/content-principles.md](../docs-on-docs/content-principles.md)).
These files break both rules deliberately. They exist to preserve history, and splitting
`LAWS.md` further would break the numbering that makes it citable. Leave them whole in
the next cleanup sweep.
