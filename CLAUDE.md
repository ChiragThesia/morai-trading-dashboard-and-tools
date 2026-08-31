# Morai

**The rebuild has started.** v1 was deleted on 2026-08-29 at commit `fd4f8d3` — 1,594 files, about
170,000 lines — and this repo kept the knowledge instead. Phase 1 of the rebuild landed on
2026-08-31.

What exists now:

| | |
|---|---|
| `src/morai/` | Python 3.13 package — `api/`, `worker/`, `money/`, `db/`, `settings.py`, `telemetry.py` |
| `tests/` | 60 tests. `tests/gate/` holds fixtures that prove the type gate rejects what it claims to |
| CI | `.github/workflows/ci.yml` — `typecheck-basedpyright`, `typecheck-mypy`, `lint-ruff`, `test-pytest`, with a Postgres 18 service |
| Deployed | Railway project `morai-journal` — `web` + `worker` + Postgres, live at `web-production-183cf.up.railway.app` |
| Migrations | Alembic, sole authority. Procrastinate's own schema is wrapped into revision 0002 |

Run the gate with `bash tools/gate.sh`. Locally use `uv run pytest -m "not db"` — there is no
reachable database on a dev machine (Docker's daemon is broken here, and Railway's Postgres is
private-network-only), so DB-marked tests run in CI. They fail loudly rather than skipping.

If you are looking for `apps/` or `packages/`, those were v1's layout and are gone. This is a `src/`
layout with one installable package.

## What the project is

A single trader's system for running delta-neutral SPX calendar and diagonal spreads. Front legs
typically 8-45 DTE, puts, on SPXW weeklies and SPX monthlies. Small account.

v1 collected option chains from Schwab and CBOE, computed BSM greeks server-side, kept a 30-minute
RTH snapshot of every open calendar, derived analytics (skew, GEX, term structure, calendar
ranking), and exposed all of it to a web UI and to Claude Code over MCP. It ran live on Railway,
Supabase and Vercel for roughly three months.

## What happened to it

Deleted at commit `fd4f8d3` — 1,594 files, about 170,000 lines. The infrastructure went with it:
Railway services down, Vercel project and morai.wtf deleted, Supabase project deleted after a
verified 2.5 GB `pg_dump` to local cold storage.

The decision was the owner's. The knowledge was extracted first, which is what this repo is now.

## What is here

| Path | What it holds |
|---|---|
| `docs/learnings/` | **337 numbered, cross-cited entries.** The core asset. |
| `docs/rebuild-research/` | OptionStrat teardown measured off the wire, trading-journal research, the analyzer/journal spec, and the Phase 0 measurement verdict |
| `salvage/*.md` | 3,853 lines read *out* of the deleted code before it went |
| `knowledge-base/` | The trading research corpus. Read-only. |
| `REBUILD-BRIEF.md` | Scope, PORT/REWRITE/DROP verdicts, open questions |
| `docs/architecture/` | **Stale.** Describes the deleted system. See below. |

### docs/learnings — cite these by number

| File | Contents |
|---|---|
| `LAWS.md` | 101 stack-independent laws (`L001`-`L101`), opening with the ten that cost the most |
| `vendors-and-infra.md` | 91 traps (`V001`-`V091`) — Schwab, CBOE, FRED, CFTC, Alpaca, Supabase, pg-boss, Railway, TradingView, macOS/iCloud, the agent harness |
| `domain-trading.md` | 53 measured facts (`D001`-`D053`), VERIFIED split from CLAIMED |
| `refuted.md` | 53 entries (`R001`-`R053`) — beliefs held, acted on, and disproved |
| `process-and-verification.md` | 39 entries (`P001`-`P039`) |
| `app-postmortem.md` | What paid for itself in v1 and what did not |

Every entry carries its mechanism, its cost, and its source. **IDs are append-only.** They are cited
across files and from `REBUILD-BRIEF.md`; renumbering breaks those citations silently.

## Before writing any code

Read, in this order:

1. `REBUILD-BRIEF.md` — especially §3 (non-negotiables) and §6 (open questions)
2. `docs/learnings/LAWS.md` — at minimum the "ten that cost the most" table
3. `salvage/measured-constants.md` — 31 constants with the experiment behind them, and **40 with
   none**, listed as such so you know which are free to choose fresh
4. `docs/rebuild-research/analyzer-and-journal-spec.md` — what the rebuild is supposed to be

The single highest-value habit: when about to make a decision this project has already made, grep
`docs/learnings/` first. That is what it is for.

## Known-stale, not yet fixed

- **`docs/architecture/`** — 18 files describing the deleted system's API, data model, jobs,
  deployment, monorepo layout and streaming. Its durable content was harvested into
  `docs/learnings/`; the files themselves have not been pruned. Treat as history, not as
  instruction.
- **`docs/operations/schwab-reauth-runbook.md`** — a runbook for infrastructure that is down.
- **`docs/TOPIC-MAP.md`** — indexes both of the above as though current.

## Open decisions

Recorded so they are not silently re-decided:

- **Does a rendered UI get rebuilt at all?** Current answer: monitoring surface only, then reassess.
  TradingView is the cockpit; the position-monitoring view is the thing it cannot serve.
- **Three measurements are owed** before the ranking engine comes back: the FF-percentile regression
  against realised P&L, the index-vs-single-name slope sign flip (`R009`, still marked *claimed*),
  and the AM-settlement anchor (settled in `docs/rebuild-research/phase0-measurements.md` — the
  Friday-morning family is correct, but 09:30 ET is a lower bound, not a citable minute).
- **The repo lives on an iCloud-synced Desktop.** This is a live problem, not a historical one. See
  `V091`.

## Style

All prose follows `docs/docs-on-docs/hemingway-style.md`. Short sentences, active voice, no hedging.
Every claim carries its evidence.
