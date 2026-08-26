# Morai v1 — Postmortem

Written 2026-08-25, before the ground-up rebuild. Sources: `.remember/` daily logs,
`.planning/` (STATE, ROADMAP, REQUIREMENTS, RETROSPECTIVE, PROJECT, 20 phase directories,
`debug/`, `research/`), `docs/architecture/` (18 files), `docs/calendar-engine/`,
`tools/tradingview/`, and a code-salvage audit of every package.

## Measurement note

Every figure below is either measured in this repo today or quoted verbatim from a source
that shows its own measurement. Two figures in the rebuild brief I was handed do not
reconcile with what I measured, and I did not adopt them:

| Handed figure | Measured today | Status |
|---|---|---|
| 147k lines TS/TSX | 170,016 lines across `apps/` + `packages/`, tests included | Unreconciled. I use the measured number. |
| ~4,000 tests | 360 test files across `apps/` + `packages/` | Assertion count, not file count. I did not verify it. |

The salvage audit says 324 test files. It counted `*.test.ts` only. Adding `*.test.tsx`
gives 360. This is a small thing, and it is exactly the thing the record itself flags:
a prior audit's headline numbers were re-run and five of them were wrong, including its
own line-count split, which summed 1,616 lines short of the total it also quoted
(`docs/calendar-engine/critique.md` section 2). A postmortem that repeats an unverified
number while its taxonomy names that failure class is worthless.

Measured module sizes, used throughout:

| Module | Total lines | Test lines | Production |
|---|---:|---:|---:|
| `packages/core` | 59,079 | 29,032 | 30,047 |
| `apps/web` | 38,430 | 17,517 | 20,913 |
| `packages/adapters` | 35,669 | 16,906 | 18,763 |
| `apps/server` | 16,145 | 8,881 | 7,264 |
| `packages/contracts` | 10,160 | 3,323 | 6,837 |
| `apps/worker` | 8,920 | 4,165 | 4,755 |
| `apps/sidecar` (Python, venv excluded) | 5,776 | — | — |
| `tools/tradingview` | 2,405 | — | — |
| `packages/shared` | 1,060 | 485 | 575 |
| `packages/quant` | 553 | 295 | 258 |

---

## 1. What it was for, and what it got used for

### What it was for

`PROJECT.md` states the core value in one sentence: "The journal: for any calendar, answer
'how did price and greeks move over the life of this trade?' — collected automatically,
never hand-edited, queryable by API and by Claude Code. If everything else fails, this must
work." Everything else — picker, exit advisor, backtest, regime board — was declared
secondary and built to serve that anchor.

### What it got used for

Four divergences. Each one is a finding.

**The anchor feature accumulated the most permanent damage.** The journal was live-write-only
with no backfill. Every outage, every late calendar registration, every stale-leg skip became
a permanent hole. One open calendar carried 46 snapshots of which only 12 were non-gap: 10 on
Jul 01, 2 on Jul 03, Jun 23–26 all gap (spot=0/NaN), Jun 27–30 empty in a worker-down window
(`STATE.md` open follow-ups #1). Phase 25 stopped the bad writes and made the problem worse —
silent skips replaced visibly wrong rows, and nothing backfilled. The repair (Phase 40) landed
a full milestone later. The one feature that "must work" was the one with the least durable
data, and the raw source needed to reconstruct it had been sitting in `leg_observations` the
whole time.

**The scoring engine outgrew its evidence base by an order of magnitude.** The realized corpus
never got past 13 closed trades — one trader, one instrument, roughly a six-week window, one
contango regime. Against that, the system carried a 9-weight scoring model, a 3-version rule
engine, a ~20-knob runtime settings surface, an exit advisor, and a backtest harness. The
project knew: it stamped the backtest never-writes-weights, hard-gated weight promotion at
n≥30, and wrote "9 free weights fit to 13 correlated trades is overfitting formalized" into
`STATE.md`. The discipline was correct. The volume of machinery built around a signal that
could not be validated was not.

**The web UI got three mobile redesigns and then a deletion notice.** `apps/web` is 38,430
lines, the second-largest module in the repo. Phases 35, 35.1, and 36 rebuilt its mobile
experience. Phase 42 consolidated its design system across 708 call sites. Two months later
the record says "TradingView = cockpit, MORAI = math engine (apps/web to be deleted)"
(2026-08-05).

**The most durable output was not the application.** It was the written record. The migrations
carry their own measurements in their comments (0028, 0029, 0030 each state the exact row
counts they repair). `docs/calendar-engine/measurements.md` pairs every published number with
its reproducing query. The four Pine studies and `push-gex.ts` have zero imports from
`packages/` or `apps/`. Those artifacts survive a rewrite untouched. The 170,016 lines of
TypeScript mostly do not.

---

## 2. What worked

**Function-type ports.** Every driven port is a plain function type, not an interface class.
Test doubles are one-line functions (`async () => ok(fixture)`), with no mocking framework
anywhere. Every port has a maintained in-memory adapter in `packages/adapters/src/memory/`.
`hexagonal-ddd.md` states the rule; `monorepo-layout.md` calls `memory/` "a first-class
citizen." This is where the architecture earned its keep, and it is the half worth keeping.

**Pure domain functions with I/O pushed to a thin wrapper.** `selectCandidates` and
`scoreCalendarCandidates` are pure; `computePickerSnapshot` does the I/O. That structure is
what let the backtest harness replay history through the untouched live functions instead of
forking a parallel copy. `backtest-harness.md` makes the rule explicit: if the harness needs a
helper, the live engine exports it — the harness never reimplements scoring.

**Append-only observation tables with time-leading composite keys.** D7 chose plain Postgres
over TimescaleDB, computed the expected volume (~33k rows/year journal, ~1.6M/year full chain),
and set a numeric revisit trigger: any observation table over 10M rows, or p95 latency over
500ms. `leg_observations` measured 824,198 rows — nowhere near the trigger. The schema was
shaped so that if the trigger ever fired, the upgrade would be a provisioning change plus a
hypertable migration inside the adapter, with zero application code touched. A deferred
decision that was actually prepared for, and the deferral held.

**The vendor sidecar boundary.** Two independent processes refreshing the same rotating Schwab
token produced `invalid_grant` within one 30-minute cycle. The fix was not a distributed lock.
It made one process own the token's whole lifecycle, and — because Schwab allows exactly one
streaming session — made the token owner and the session owner the same process by
construction. D22, live in prod, re-auth proven 2026-07-02. `apps/sidecar` couples to the rest
of the system over HTTP only. It is the one service that ports as-is.

**Migrations that carry their own measurement.** 0028 states "1,294 of 26,115 contracts are
wrong" and ends with a self-asserting post-condition that raises if any row still disagrees
with its own OCC symbol. 0029 states "709 colliding keys... roughly 30% of every skew snapshot
was thrown away." 0030 states "1,748 rows, 49.6%, were thrown away" and proves its recovery
rule against 7.2M call legs and 7.0M put legs before applying it. These files are the highest
information-per-line artifacts in the repo.

**The review gate.** Every phase carries a REVIEW document, and those documents caught real
production-affecting bugs before deploy: a settings knob that validated, persisted, and echoed
back as "effective" while the engine never read it (CR-01, phase 29); a fail-closed GATE BLIND
alarm rendered inside another component's success branch, so it was suppressed by exactly the
empty-table condition that fired it (WR-02, phase 28); a backtest whose entry and exit priced
from the same chain slice, making its P&L a deterministic function of the bid-ask spread
(CR-01, phase 27); an unguarded division producing `Infinity`, which `z.number()` accepts,
`JSON.stringify` turns to `null`, and the next read 500s for every row in the batch (CR-01,
phase 26). None of those had a failing test.

---

## 3. What did not pay for itself

### Hexagonal dependency law — half paid

The testability half paid, described above. The stated primary driver did not. `overview.md`
names swap flexibility as the reason for the architecture. The record shows one actual swap in
the system's life: Railway-managed Postgres to Supabase-managed Postgres, executed as a
connection-string change. The pg-boss adapter was never replaced. The Schwab adapter was never
replaced. Their swap-cost rows in `stack-decisions.md` stayed theoretical for the whole project.

The rigidity had a measurable price. The browser needed the same BSM function the server used.
The law forbids `web → core`. Satisfying it required a new zero-dependency workspace package
(`packages/quant`), new tsconfig project references, and a new ESLint boundary element — all
to share 177 lines of source. A narrow, mechanically-enforced carve-out already existed as
precedent: RULE-01 lets `contracts` import `core` for one enum module, scoped to that single
edge in `eslint.config.js`. The same tool was available and was not used.

Verdict: keep the ports and the pure-function discipline. Drop the absolutism.

### The mobile redesign — the first approach did not pay, the second did

Phase 35 built mobile as responsive reflow over the desktop DOM. It passed every automated
check: no horizontal scroll, tap targets ≥44px, elements present. The user's phone check
failed it verbatim: "still look ass, if you have to design components for mobile only then do
that." Phase 35.1 built a dedicated `overview-mobile/` tree and passed. One full phase spent
proving that "responsive" and "designed for mobile" are different claims, and that no
mechanically-checkable assertion can distinguish them.

The dedicated-tree architecture carries a documented cost: a `matchMedia`-driven root switch
unmounts one tree and mounts the other, so every crossing of 1024px resets local UI state and
tears down and reconnects the EventSource (IN-05, phase 35.1, accepted as a trade-off).

Verdict: the reflow attempt was waste. The dedicated tree was not.

### The design-system consolidation — insufficient evidence to judge

Phase 42 migrated 708 call sites from legacy names to semantic tokens, deleted the LEGACY tier,
proved the change was a visual no-op by diffing the emitted CSS byte-for-byte, and wired a
`tokens:lint` guard into the build because Tailwind emits nothing for an unknown class, making
a regression invisible until someone sees black-on-black text. It rejected daisyUI with three
stated reasons. It added zero dependencies.

The record contains no evidence that this work produced or failed to produce a user-visible
outcome, and no entry treats it as a cost. I cannot judge it on the evidence available. The
only observation I can make honestly is one of timing: it shipped shortly before the pivot
record declared the surface it beautified slated for deletion.

### The planning artifacts per phase — the review gate paid, the rest is unjudged

Each phase carries CONTEXT, RESEARCH, ROADMAP entries, REVIEW, REVIEW-FIX, VERIFICATION, UAT,
per-task SUMMARY, and deferred-items files. The REVIEW documents demonstrably paid: four
production-affecting bugs listed in section 2 were caught there, on green suites.

For the rest of the artifact set the record is silent. No entry records the planning overhead
as a delay or a cost. No entry records a decision made better because a CONTEXT file existed.
I have no basis to call it waste and no basis to call it justified. Insufficient evidence.

### The dedicated web UI — the largest open write-off

`apps/web` is 20,913 production lines and 17,517 test lines. If the TradingView pivot holds as
recorded, that is the largest single write-off in the codebase. If it does not hold, it is the
only surface that can render the journal's per-calendar greek and vol story, which is the
system's stated anchor. This is not a postmortem verdict. It is a live decision, and it is
handled in the rebuild brief.

---

## 4. Failure taxonomy

**Counting rule.** One count per distinct production incident, deduplicated across sources.
The same incident appears up to five times in the input — the skew key collision is recorded
in `.remember/`, in `docs/architecture/data-model.md`, in migrations 0029 and 0030, and in the
salvage audit. Those are one incident each, not five. Damage figures are quoted only where a
source states a measurement.

Classes are ranked by damage, not by how alarming they felt. Silent, continuous, partially
unrecoverable data loss outranks a bounded outage that self-healed on redeploy.

### Rank 1 — Key and row-identity collisions (4 incidents)

Silent. No error, no dash, no alert. Rows collapse onto a too-narrow key and one side is
discarded on every write cycle, indefinitely, until someone counts.

| Incident | Measured damage |
|---|---|
| `skew_observations` PK missing `root` | 709 colliding keys / 1,632 rows; ~30% of every snapshot dropped. 629k rows unattributable and nulled by 0029. |
| `skew_observations` PK missing `contract_type` | 1,748 of 3,521 quotes (49.6%) discarded per batch. Put wing 3.7% → 50.1% post-fix. |
| `contracts.root`/`expiration` written from the requested label, not the returned OCC symbol | 1,294 of 26,115 contracts (5%) wrong, always with a paired off-by-one expiry. Biased every affected leg's T and greeks high via the AM/PM settlement branch. Candidates rose 7,314 → 9,465 after repair. |
| `root` missing from the chain wire contract | 242 duplicate React keys; one row measured an SPXW back leg at 68.89% IV against an SPX front at 24.69%. |

Three separate tables, three separate discoveries, one root cause: a composite key missing a
column that genuinely varies. The repo's own doc names the generalization — 0030 left
`contract_type` out on the reasoning "it never varies today," and 49.6% of every smile was
silently discarded.

This class ranks first because its damage is silent, continuous, and partly unrecoverable.
Nothing alerts. The rows are gone by the time anyone looks, and 0029 had to null 629k of them
as unattributable rather than repair them. A bounded outage announces itself and ends.

### Rank 2 — Vendor contract, request shaping, and fabricated defaults (10 incidents)

Longest freeze in the system's life, plus days of running on a degraded source while every
health check stayed green.

| Incident | Measured damage |
|---|---|
| Schwab called with `SPX` not `$SPX` → 400; any 400 mislabeled `AUTH_EXPIRED`; fallback gated on token freshness, not call outcome | 5-day pipeline freeze behind a healthy token. |
| Sidecar emitted `+00:00`, Zod schema accepted only `Z` | Schwab→CBOE fallback broke silently; pipeline ran on the degraded source for days, everything green. |
| Schwab gateway 502 at `strikeCount ≥ 150`; narrowed to 50 | GEX flip moved 135 points overnight from the source switch, not the market. Put wall mislocated. 6 of 8 open position legs outside the window. Fixed by dual-source union, not by widening. |
| Schwab reports `openInterest=0` outside RTH; newest-row-wins merge took the zero | 0.0% of contracts non-zero 04:00–10:00Z vs 86.3% from 10:30Z. ~2,971 contracts/day zeroed; both GEX walls null. |
| Schwab fills API returned null; job treated it as "no new fills" | Journal silently stale, 3 verdicts unlinked. Same missing guard found later in a second module. |
| `entries[0]` used to pick "the" Schwab account | Read account 72130768 (empty) instead of 76363972 ($18.9k). |
| `Math.abs()` on Schwab's signed `transferItems[].amount` | Destroyed the only field carrying buy/sell direction; forced every consumer to guess. |
| CBOE timestamps assumed ET, converted with `etToUtc` | Systematic −4h shift on every stored timestamp. CBOE timestamps were already UTC. |
| `VIX9DCLS` used as a FRED series id | Series does not exist. Hallucinated identifier, caught before ship. |
| CFTC `_all` suffix applies to three fields but not three others | Mismatch fails Zod silently, erroring the whole job. |

The pattern: a vendor's behavior was assumed, and the assumption produced a plausible number
rather than an error. `RETROSPECTIVE.md` had already written the rule — "discover undocumented
vendor behavior empirically, never from assumptions" — and it was still the second-costliest
class.

### Rank 3 — Money, unit, and sign errors in the P&L ledger (5 incidents)

No rows lost. The number a human traded on was wrong.

| Incident | Measured damage |
|---|---|
| `openNetDebit` stored in dollars, formula expected index points | A +$395 trade displayed as −$319,850. Took 5 rounds of oracle-driven debugging. |
| `syncFills` signed `netAmount` from OPEN/CLOSE classification instead of the fill's real direction | `openNetDebit` 286.47 (two debits summed) instead of 32.35 (debit netted against credit). |
| `readCalendarLegs` derived OPEN/CLOSE from the mutable `calendars.status` column | Produced exactly −4.00, the observed prod regression, reproduced RED before the fix. |
| Ambiguous shared-leg fills orphan-parked instead of resolved by order context | One calendar showed back-leg-only debit 62.50 instead of 10.20. |
| `pnlPct` divide-by-zero → `Infinity` → `z.number()` accepts it → `JSON.stringify` writes `null` → next read fails the whole batch | Entire endpoint 500s for every row, not just the corrupted one, until manual SQL cleanup. |

All five sit in one subsystem. The fix required building a validated ground-truth oracle from
Schwab transaction history first, then debugging against it. All 13 real calendars matched the
oracle within $0.02 afterward.

### Rank 4 — Job liveness and backlog starvation (7 incidents)

Bounded and self-healing once fixed, but the symptom was null GEX walls that a trader would
read as market structure.

| Incident | Measured damage |
|---|---|
| `computeBsmGreeks` read the entire backlog with no LIMIT and did one `readRate()` per row | 56,232-row backlog, all sharing one date. Exceeded the 900s pg-boss cap on every retry. Zero forward progress, forever. |
| Same job read oldest-first | Newest cohort never reached. GEX `putWall: null`, `flip: null`, `poi: 0` on every strike. |
| `leg_obs_pending_bsm_idx` bloated to 222MB | 120s timeout, backlog 11.8k. Dropping the index and raising the worker to 600s took it to 584 in one cycle. |
| Supavisor silently strips connection-string `statement_timeout` | Job timed out at 120s despite a 600s intent. Only `SET LOCAL` inside the transaction works. |
| CBOE adapter's cron stalled at 04Z while the endpoint stayed healthy | OI=0 read as a vendor outage for an extended period. Job liveness and endpoint reachability are different checks. |
| `self-heal-journal`'s half-open `[anchor, anchor+30min)` window missed observations landing just before the anchor | Healed nothing, reported `errorCount: 0`. "Ran and healed nothing," "never ran," and "errored per slot" were indistinguishable because the handler logged nothing on success. |
| Four uncapped connection pools against a 15-client Supavisor ceiling | One mechanism, five simultaneous symptoms: server crash, sidecar token-refresh write failure, frozen chain ingest, frozen BSM/GEX compute, `fetch-cot` failures. |

### Rank 5 — Auth and token lifecycle (4 incidents plus one permanent tax)

| Incident | Measured damage |
|---|---|
| Two processes refreshing the same rotating Schwab token | `invalid_grant` within one 30-minute cycle. |
| HS256 verification assumed; live Supabase issues ES256 | Every real user's token returned 401. Code passed review. |
| Sidecar crash left a Postgres advisory lock held | Required manual `pg_terminate_backend` until `idle_session_timeout` + heartbeat landed. |
| Schwab's 7-day refresh-token expiry | Server-side, hard, no sliding window. Not a bug. A permanent weekly operational tax that no client library change can remove. |

The 7-day expiry drove three separate phases of re-auth UX work (Phase 15, 16, 37) because
every point of friction in a weekly recovery path compounds on a weekly cadence.

### Rank 6 — Write-conflict semantics (2 incidents)

Separated from rank 1 deliberately. The key defects above are silent; these two are loud,
bounded, and announce themselves as an outage. Same table, different root cause, different
damage shape.

| Incident | Measured damage |
|---|---|
| Chain-ingest `ON CONFLICT DO UPDATE` target did not match the real unique constraint | 75-minute outage, ~100 duplicated contracts. The upsert kept inserting instead of updating. |
| `calendar_ranking` bulk insert used `DO UPDATE` against a batch containing in-batch duplicates | ~80-minute outage. Postgres raises "command cannot affect row a second time." `DO NOTHING` survives the identical batch, first-write-wins. |

### Rank 7 — Process crash with no failure handling (1 incident)

2026-07-23. Supabase unreachable for 81 minutes. Both services died on their first unguarded
boot `await`, logged nothing but a driver stack trace, and restart-looped into the same dead
connection. Three causes, three fixes: `jobBoss.on('error')` (Node rethrows an unlistened
`error` event as an uncaught exception, so pg-boss's own self-recovery never got a chance),
`process.on('uncaughtException')` handlers, and a retry loop around boot-time DB I/O.
`deployment.md` records the design conclusion: three failure classes get three different
responses, and one blanket try/catch would be worse than none.

### Rank 8 — Timezone and date construction (4 incidents)

| Incident | Measured damage |
|---|---|
| `new Date("...T00:00:00.000Z")` constructed UTC, read with local getters in `computeGexSnapshot` | ~1% relative T error on a ~98-day expiry. Corrupted FRED-rate interpolation and the parity carry solve. `docs/architecture` names this the third instance of the same bug class. |
| `new Date(y, m-1, d)` in `readPendingObs` builds in the server's local timezone | Correct in local dev, silently wrong on a non-ET server. |
| `contracts.expiration` off-by-one from local-getter formatting | Counted under rank 1; the same writer bug produced both the root and the date error, which is why root-only mismatches were exactly zero. |
| `toISOString().slice(0,10)` day-bucketing | Safe only because US RTH never crosses UTC midnight. Flagged as a footgun that does not travel to another market. |

The independent oracle in the test for the first incident reproduced the identical buggy
construction, so the test could not catch it.

### Rank 9 — Refuted trading logic shipped as code (10 recorded refutations)

Damage unmeasured except where noted. Listed because re-encoding any of them is the cheapest
possible way to lose money in the rebuild.

- Per-pair term-inversion crisis gate: deleted trades that had edge. Retired 2026-07-09.
- Event-blackout entry gate: an exit discipline encoded as an entry block.
- Term-structure slope scored with the wrong sign; calendar entry wants the front rich, not
  carry contango. Reversed by backtest (−0.09%/yr → +0.58%/yr).
- Forward Factor ≥16% absolute threshold: fires 0 of 2,465 SPX candidates. Max observed 14.4%.
- `thetaCarry` as a strike discriminator: U-shaped in strike, so it ships the most extreme
  strike. Top candidate landed 721 points OTM.
- `frontVrp` as a fourth score term: corr 0.954 with the existing forward-vol term, and
  mathematically inert under percentile rank because the subtracted scalar is shared.
- Nearest-strike delta reference on a sparse ladder: produced FF 44.37% against a real
  cross-book maximum of 14.4%.
- Raw per-strike Forward Factor ranks skew, not term structure: surfaced a strike 302 points
  OTM at double the best near-ATM candidate.
- IV-rank gates, the −1% to −3% IV-diff band, and the debit-as-%-of-back band: adversarially
  refuted, traced to a single unsourced site.
- VVIX as a "trust the band less" flag: the regime tag was read from the same-day close, which
  is the outcome it claimed to predict. Prior-close tagging gives t=+1.18 on n=5,088.

---

## 5. The recurring meta-failure

### The pattern

A fully green test suite, a passing typecheck, and a healthy `/status` endpoint were all
simultaneously true while production was broken. Every time, the gate that actually caught it
was a human looking at production.

### The count

The project kept its own tally, in two numbering schemes, and both reached double digits.

Green-suite catches — bugs found on a green suite:

- WR-01 idempotency, phase 19: recorded as the **6th** green-suite catch.
- CR-01, phase 20: the **7th**.
- BSM statement-timeout, 2026-07-20: the **10th**.

UAT catches — bugs found by driving the live app, numbered #10 through #29 in the phase
record. The named ones:

| # | What was green | What was broken |
|---|---|---|
| #19 | 3,175 jsdom tests | No payoff chart rendered at all on morai.wtf. `ResponsiveContainer` measured 1160×0. |
| #20 | 3,175 jsdom tests | Every overlay mark drifted ~16% off its curve, live. |
| #24 | Full suite, class assertions passing | The whole desktop left column rendered empty at ≥1024px. |
| #26 | Full suite | A pasted calendar priced at `spot ?? 0`, producing a degenerate payoff and a fabricated `schwab ·` provenance caption. |
| #27 | Full suite | 9 real event chips blew a 390px viewport to 533px. |
| #28 | "Typecheck clean including web" claimed by prior phases | `bun run typecheck` had never checked `apps/web` at all. 13 real pre-existing errors surfaced the moment someone ran `tsc` against it directly. |
| #29 | Root `tsc --build` reporting 0 errors | Same blind spot, re-found. Baselines of 42, then 10, then 8 errors tracked separately thereafter. |

### The structural causes

Six distinct mechanisms, each of which makes a green suite mean nothing:

1. **The test environment renders at exactly the constants the code assumes.** jsdom's mock
   always rendered at 1000×470, which is precisely the fixed `SVG_W`/`SVG_H` closure the
   overlay layers used. The two coordinate systems could only agree in the test. A regression
   test that clones the chart at 580×273 was added afterward.
2. **The aggregate gate silently omitted a project.** The root `tsconfig.json` `references`
   array listed six packages and not `apps/web`. `tsc --build` is only as complete as that
   array, and every "typecheck clean" claim inherited the gap.
3. **A config format change skipped tests instead of failing them.** Migrating `workspace.ts`
   to `vitest.config.ts` made 5 Postgres-dependent tests silently absent from execution. The
   suite reported green with them missing. Nothing signals this except comparing executed
   count against expected count.
4. **Both sides of a seam were green against fixtures neither producer emits.** The
   `/reauth/start` schema was `.strict()` and rejected both real bodies. The adapter test fed a
   body omitting the `app` field the sidecar always sends; the web hook test fed a body
   injecting a `state` field the server never sends. Clicking "Authorize with Schwab" did
   nothing in production, with two green suites.
5. **A property test generated the adversarial input and asserted on the wrong output.**
   `RegimeBoard.test.tsx` fed arbitrary band values across ±1000 against a fixed 0.6–1.2 axis —
   the exact precondition for a negative CSS width — and read only the marker's `left`, never
   the band segments computed from the same unclamped function.
6. **A property test's own expected value encoded the bug.** `syncFills.property.test.ts`
   reconstructed ROLL economics unsigned, matching the implementation's bug. Fixing production
   made a passing property test start failing, for the right reason.

Add the invisible-failure class that no test shape catches: Tailwind emits nothing for an
unknown class name, so a deleted utility class produces black-on-black text with no build
error, no console warning, and no diff signal. The only defense that works is a build-time lint
scanning for the deleted pattern.

### What would actually have caught them

Ranked by how many of the above they would have caught:

1. **Live UAT against production-shaped data.** This caught #19, #20, #24, #26, #27, the
   four-line row wrap (live picker names carry ISO dates; fixtures used short names), and the
   chip overflow. It is the only mechanism in the record with a hit rate this high.
2. **A real browser layout engine for anything geometric.** jsdom cannot observe a percentage
   height collapsing to 0px, cannot observe a coordinate-system drift, and cannot reveal a
   closed `<details>`.
3. **Per-boundary tests fed the actual body the real producer emits**, not a hand-typed
   literal. One schema per real wire boundary, and at least one test per boundary wired to the
   other side's real handler output.
4. **Assert the count of tests actually executed.** A silent skip is invisible by construction.
5. **The leakage-oracle pattern.** Where the live system already persisted its own decision
   output, require the replay to reproduce it exactly. A mismatch is a bug with no code review
   required. `BT-02` codifies it.
6. **Verify data provenance, not health endpoints.** The `observedAt +00:00` parse bug fell
   back to a degraded source for days while every dashboard stayed green. Check which upstream
   produced this specific row.
7. **Prove a fix by breaking the thing mid-recovery.** `Promise.all([a(), a()])` does not
   reliably reproduce a Postgres TOCTOU race — local round trips finish too fast. Holding an
   uncommitted blocker transaction open until the racing SELECT has run does.

### The one-line conclusion

The suite was never the gate. 80,604 lines of test code across 360 files caught none of the
incidents in section 4 before they shipped. The gates that did work were: a human looking at
production, a migration that measures what it repairs, an oracle built from ground truth, and
a review document written by someone reading the code with the intent to disbelieve it. Three
of those four are human effort applied after the suite went green. Budget for them.
