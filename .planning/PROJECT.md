# Morai Journal

## What This Is

A multi-user trading journal for delta-neutral SPX calendar and diagonal traders. Each user connects
their own Charles Schwab account, and the system ingests their fills, builds a correct P&L ledger
across rolls and settlements, and holds an immutable record of what they said they would do before
they did it. Built for its author and three or four friends who trade the same structure.

This milestone builds the **backend only**. No rendered UI. The API is designed to be consumed by a
mobile-friendly web app that gets designed separately once the backend is done.

## Core Value

**The ledger is correct across rolls and settlements.** The sum of realised P&L over any window must
equal the broker's cash delta over that same window, net of transfers — checked every ingest cycle,
as a test. If that fails, no other number in the system is trustworthy.

## Why It Exists

Every skeptic in the research corpus makes the same argument and concedes the same exception. The
argument: the broker's own order-status screen already shows what a journal shows. The exception:
it cannot show rolling-trade P&L. This journal earns its existence on exactly two things —

1. A correct campaign-level ledger for rolled multi-leg positions.
2. An immutable, time-stamped pre-commitment record.

The research doc's own test (`docs/rebuild-research/trading-journal-research.md` §10): *"If a screen
in this journal does not do one of those two things, delete it."* That test governs scope.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Identity and access**

- [ ] User can create an account with username and password
- [ ] User can log in and stay logged in across sessions
- [ ] User connects their own Schwab account via OAuth, self-service
- [ ] User re-authorises Schwab themselves when the 7-day refresh expires, without operator help
- [ ] No cross-user read path exists anywhere in the application
- [ ] Every privileged read of user data is written to an audit log

**Encryption**

- [ ] Every user's trading data is encrypted at rest under a per-user data key
- [ ] Per-user data keys are wrapped by a master key held outside the database
- [ ] A stolen database dump or backup yields no readable trading history

**Ingest and ledger**

- [ ] Fills ingest automatically from each connected Schwab account
- [ ] A raw fill is immutable and is the only storage atom
- [ ] Events (`OPEN`, `CLOSE`, `ROLL`) are derived from fills, never stored as primary truth
- [ ] A `ROLL` is a first-class event storing its open debit and close credit as separate fields
- [ ] A synthetic `SETTLEMENT` event fires from expiry and strike, with no fill required
- [ ] Settlement style is a per-leg flag — a PM-settled SPXW front leg can sit under an AM-settled SPX back leg
- [ ] A campaign — a chain of rolled positions — is a read model over events, not a mutable table
- [ ] The reconciliation invariant runs every ingest cycle as an automated test
- [ ] Recompute is a pure function of stored fills, requiring no broker call

**The pre-commitment record**

- [ ] User writes thesis, invalidation condition, exit plan, planned DTE window and submit price before a position opens
- [ ] Those fields are structurally not editable once the position opens
- [ ] User records a plan-followed yes/no with one sentence at close
- [ ] Tags come from a closed vocabulary of four, never free text

**Capture**

- [ ] Every open position is repriced and snapshotted on a 30-minute RTH cadence from day one
- [ ] A slot with no market data stores an honest gap, never a fabricated or carried-forward value
- [ ] Snapshots have a documented rebuild path from raw observations, shipped with the writer

**Review surface (as API)**

- [ ] Reconciliation status is queryable and is the first thing any client must render
- [ ] Campaign view returns one row per campaign with roll events nested underneath
- [ ] Drift is computed from the immutable entry record: positions held past their stated DTE window, exits that overrode the declared stop, sizes outside the declared cap
- [ ] A cohort is comparable against the user's own trailing baseline

**Deployment**

- [ ] The system runs in containers on Railway with a Postgres database

### Out of Scope

- **A rendered UI** — deferred by decision. The backend ships first; the UI is designed separately
  from a prompt handed to Claude Design once the API is stable.
- **Order execution of any kind** — the advise/execute boundary held across three milestones of v1
  and is structural (`NN-37`). No port resembling an order-placing port exists.
- **The analyzer, picker, ranking engine and GEX** — a different product surface. Three measurements
  are owed before ranking returns (FF-percentile regression, index-vs-single-name slope sign,
  AM-settlement anchor). Not this milestone.
- **CBOE chain ingest and dual-source breadth** — the journal needs marks for the user's own open
  legs, which Schwab supplies per-user. Breadth is an analyzer requirement.
- **Zero-knowledge encryption** — considered and rejected. Incompatible with unattended snapshots
  and with running the reconciliation invariant while nobody is logged in. See Key Decisions.
- **Win rate as a headline, Sharpe, profit factor, Sortino, Calmar, percentage of max profit,
  rolling ROI on margin, per-leg slippage, per-trade Kelly sizing** — each is specifically misleading
  for this structure. Reasoning per metric in `trading-journal-research.md` §6.
- **A letter grade, an emotion field, or a conviction score graded against outcomes** — directional
  and IV conviction sit in a zero-validity environment; grading them produces noise dressed as
  insight (Kahneman & Klein 2009).
- **Confidence language on any ratio** — separating a true 55% win rate from a coin flip needs ~783
  closed trades. This book produces dozens a year. Descriptive numbers only.
- **Automated weight fitting or rule optimisation** — the sample cannot support the estimate.
- **Screenshots and free-text tags** — both are named failure modes in the research.

## Context

**This repo has no application in it.** The v1 system was deleted at commit `fd4f8d3` — 1,594 files,
~170,000 lines — after roughly three months live on Railway, Supabase and Vercel. What survived is
knowledge, deliberately extracted first: 337 numbered learnings, 3,853 lines of salvage, and the
rebuild research. This project is the first thing built on top of it.

**The oracle survived.** `salvage/oracle-fixtures.md` carries 13 real Schwab calendars — real
`orderId`s, real fills, real prices — each with an `openNetDebit` and `closeNetCredit` computed
independently of the pipeline that was wrong, plus a 14th synthetic negative control. It includes the
two hard cases: a front-month contract shared by two calendars, and a calendar whose stored status
column was stale relative to its own fills. Phase 1 therefore has a pass/fail ground truth on day one.

**The bug this system exists to never repeat.** v1 displayed a trade that made **+$395** as
**−$319,850**. Two mechanisms: a `ROLL` netted its open debit and close credit into one number, and
fill classification was derived from a mutable status column instead of the fill's own broker-reported
`positionEffect`. Both are now laws (`NN-8`, `NN-9`), both are covered by the oracle.

**Multi-user is a reversal.** `REBUILD-BRIEF.md` §1 lists multi-user and tenant isolation under
*Proven unnecessary*. Open question #8 asks whether single-user still holds. It does not. See Key
Decisions.

**Authoritative reading, in order:** `REBUILD-BRIEF.md` §3 (45 non-negotiables) ·
`docs/learnings/LAWS.md` · `docs/rebuild-research/trading-journal-research.md` ·
`salvage/oracle-fixtures.md` · `salvage/measured-constants.md` · `salvage/invariants.md`.

## Constraints

- **Language, backend**: Python. Pydantic v2 models, `mypy --strict`. No `Any`, no `cast`, no bare
  `# type: ignore`. — The user's explicit instruction, and a typed boundary is the only cheap defence
  against the unit and direction bugs that cost v1 the most.
- **Language, frontend (future)**: TypeScript `strict`. No `any`, no `as` assertions, no `!`
  non-null assertions. — Same instruction. Recorded now so the UI phase inherits it.
- **Process**: Test-driven. Red → green, test written before implementation. — The user's explicit
  instruction. Reinforced by the record: v1 shipped production bugs past a green suite at least ten
  times, so tests are necessary and not sufficient.
- **Verification gate**: The 13-calendar oracle passes before any money code ships. — It is the only
  genuine oracle the old system produced, and its expected values were computed independently of the
  code under test.
- **Vendor**: `schwab-py`, pinned. Hypercorn in production, not uvicorn — it dual-stack binds `[::]`
  and uvicorn cannot from the CLI. — Measured in v1 production.
- **Vendor**: Token refresh takes a **per-user** single-writer lock. Concurrent refresh of the same
  token triggers `invalid_grant`. — v1 held one global lock for one user; five users need five locks,
  not one queue.
- **Vendor**: The Schwab refresh token expires after 7 days, server-side and hard. Re-auth recurs
  weekly, forever, per user. It must be self-service with a notification, not an operator runbook.
- **Security**: Envelope encryption, per-user data key wrapped by a master key outside the database.
  No cross-user view. Audit log on privileged reads.
- **Security**: An OAuth code and its redirect URL are bearer-equivalent secrets — never rendered,
  never logged, never echoed in an error (`NN-34`). The CSRF `state` is a single-use TTL'd
  server-side nonce consumed by one atomic `DELETE ... RETURNING`, not a string comparison (`NN-35`).
- **Correctness**: All 45 non-negotiables in `REBUILD-BRIEF.md` §3 apply. Load-bearing for the
  ledger: `NN-1` (every discriminating column in the composite key), `NN-8` (every money field's unit
  is named, never inferred), `NN-9` (direction from the vendor's own signed field), `NN-10` (never
  `abs()` a signed vendor amount), `NN-11` (order-anchor disambiguation, never a guess), `NN-16` (a
  gap is honest, never a fabricated value), `NN-5` (chunk batch inserts at ≤2,000 rows).
- **Cadence**: 30-minute RTH snapshot slots. This is a system-wide fact, not a tunable.
- **Hosting**: Railway containers plus Postgres. `NN-28`/`NN-29` were written against Supavisor and
  only carry forward if a Supabase pooler does.
- **Environment**: The repo sits on an iCloud-synced Desktop, which silently duplicates files with a
  ` 2` suffix and has already put one into git history. `V091` has the mechanism and the fix.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Multi-user, reversing `REBUILD-BRIEF.md` §1 "Proven unnecessary" | Direct user instruction — the author plus three or four friends. Instruction outranks the brief (`.claude/rules/workflow.md` order of authority). Resolves open question #8. | — Pending |
| Envelope encryption with a server-side master key, not zero-knowledge | "Even I should not read it" and "the server reprices every 30 minutes while you are logged out" are mutually exclusive. Envelope protects against a dump, a stolen backup, and casual Postgres browsing. It does not protect against app-server access, and that limit is stated rather than papered over. Dual-wrapping was rejected outright as a false zero-knowledge story. | — Pending |
| Backend first, UI designed separately afterwards | User instruction. Also removes the largest single write-off risk from v1, where `apps/web` cost three mobile redesigns and a 708-call-site migration in the three months before it was deleted. | — Pending |
| Python backend, not TypeScript with a Python sidecar | `schwab-py` forces at least one Python process. One language removes the cross-language serialization boundary that caused a 5-day silent pipeline freeze in v1 (`NN-21`, `+00:00` vs `Z`). | — Pending |
| Snapshot capture ships in v1; snapshot analytics do not | Snapshot data is the one thing that cannot be backfilled. v1's largest permanent regret was capturing marks live-write-only and losing them forever. Capture starts before the analytics that consume it, with its rebuild path shipped alongside the writer. | — Pending |
| Scope is the journal only — no analyzer, picker, GEX or CBOE | The research doc's own test: the journal earns its existence on the rolled-campaign ledger and the immutable record. Everything else is a different product surface with three measurements owed before it returns. | — Pending |
| The 13-calendar oracle is the gate on money code | Its expected values were computed independently of the pipeline under test, before the fix was written. A regression snapshot would have been worthless — the code it froze had already been wrong in production twice. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-29 after initialization*
