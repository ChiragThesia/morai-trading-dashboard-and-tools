# Process and verification

How work went right and wrong. Cite these as `P###`.

One theme dominates: **a green test suite is the most reliable way this project ever
shipped a production bug.** It happened enough times to have its own vocabulary — a
numbered ledger of "catches", each one a defect a green suite let through and a review or
a live check caught. That ledger is [P031](#p031-the-catch-ledger-defects-a-green-suite-let-through).

Software laws are in [LAWS.md](LAWS.md). Vendor traps are in
[vendors-and-infra.md](vendors-and-infra.md). Trading facts are in
[domain-trading.md](domain-trading.md). Disproved beliefs are in [refuted.md](refuted.md).

---

## The green-suite family

### P001. A green suite alone is never sufficient at the verify gate.

Reused mock clocks and test doubles hide real timing and state bugs that only surface against live wall-clock time and real data. Named the number-one key lesson and the number-one cross-milestone trend in the project's own retrospective, after prod bugs slipped through green suites in v1.0 phases 5-6 and again in v1.1 phase 12. Three sharper forms of the same lesson. First, a test twin and the code under test that both read one shared `now()` collapse the timeline and hide a real read-versus-stamp bug: `compute-analytics` read the smile by exact `now()` while `leg_observations.time` is the broker's `observedAt`, returning zero rows in production, and stamped `now()` so a retry defeated its own idempotency. Give each distinct concept in a time-anchored test its own distinct timestamp. Second, an in-memory twin cannot reproduce SQL semantics — a roll double-count and an ordered-key UUID collision survived example tests and two review rounds and only reproduced on real Postgres. Third, scale: a live-streaming feature covered entirely by mocked unit tests shipped with eight separate bugs that existed only end to end — build cache, reconnect loops, empty subscription lists, the wrong event API, idle timeouts, an enum mismatch, keyword-only arguments and a stale reconnect ticket.

Pair the automated suite with live UAT using distinct timestamps before calling a phase done. Code review, property testing and testcontainers are complements, not substitutes.

Source: `.planning/RETROSPECTIVE.md`.

### P002. Two sides of a contract can both be green against fixtures neither producer emits.

One shared Zod schema was reused for two genuinely different wire shapes — three keys on the service-to-service hop, a one-key subset on the service-to-browser hop. Marking it `.strict()` made **both real bodies** fail their real parse. Both unit suites stayed green, because each test fed the body its own author expected: one omitted a field the real producer always sends, the other injected a field the real producer never sends. Neither test ever exercised the seam.

Production effect: clicking "Authorize with Schwab" silently did nothing.

The fix is architectural, not a bigger test. Split into one schema per real wire boundary, and add at least one regression test per boundary fed the **actual body the real other-side handler produces** — never a hand-typed literal. That is the only test shape that catches this class.

Source: Phase 37 review, CR-01 and CR-02. The reviewer named it as the exact green-suite seam gap this project had been bitten by before.

### P003. A config-format change can silently skip tests instead of failing them.

Migrating between Vitest workspace-config formats made 5 Postgres-dependent tests silently skip. The suite reported green with those tests simply absent from execution. More dangerous than a red suite: nothing signals the gap unless you cross-check the count of tests actually executed against the count expected. The specific version boundary, since the failure is silent by construction: Vitest 4 ignores `vitest.workspace.ts` entirely. Every per-package setting that lived there — `globalSetup`, aliases, pool — is dropped without a warning, which is what made five testcontainer Postgres tests skip locally and in CI at once. The replacement is a root `vitest.config.ts` using `test.projects`. After the migration the suite read 68 passing and 0 skipped.

Source: `.remember` 2026-06-10, 2026-06-11.

### P004. jsdom is blind to a percentage-height collapse. Catch #19.

A plain `<div>` with `height: 100%` has no intrinsic-size fallback: if any ancestor lacks a definite height, it computes to 0px in a real layout engine. The old hand-rolled `<svg viewBox>` masked this, because SVG has an intrinsic aspect-ratio fallback a div does not. jsdom stays green regardless, because the harness passes explicit width and height props that bypass the percentage computation entirely.

Cost: the first deploy rendered **no payoff chart at all** in production. The container measured 1160×0. 3,175 jsdom tests stayed green throughout. Fixed (commit d3d4558) with a definite `aspect-ratio` on the chart container plus a regression test pinning the style contract.

Source: Phase 33 verification.

### P005. jsdom is blind to dual-coordinate drift. Catch #20.

Custom overlay marks computed their pixel geometry from fixed width and height constants closed over at build time, while the chart library rendered at the container's real measured size. The two coordinate systems coincide only when the real size happens to equal the constants — and the jsdom mock rendered at exactly those constants, always.

Cost: bars, grid labels, band and edge arrows visibly off the curves in production. The chart rendered at 1160×545 while the hand-rendered layers used 1000×470 — roughly 16% drift on every mark. 3,175 tests stayed green. User-reported after the phase closed.

Fixed (commit ecf7138) by deriving all custom geometry from the library's own scale hooks, never a module-level size constant. A new resize test clones the chart at 580×273 — a size deliberately different from the jsdom mock — to catch the class going forward.

Source: Phase 33 verification.

### P006. Short placeholder fixtures hide overflow that real production strings trigger.

A suite built on hand-typed short names passed green while the real field carried full ISO dates. In production the live names wrapped every candidate table row to four lines at 1440px. A pure-unit suite with synthetic fixtures cannot catch this class; only live UAT against production-shaped strings can. Fixed red-to-green with a name compactor and `whitespace-nowrap` (commit 372ad2a). A content filter is the sharpest version of this. Thirty-six synthetic tests passed while four systematic false positives went straight through the live feed, because no fixture author invents a vendor's actual recurring formats: the bare "Wall Street" idiom in a headline like "Fries Wall Street Estimates", whale-alert listicles that tag a dozen tickers and therefore always hit a mega-cap, Benzinga "QUICK SPARK" clickbait, and the CNBC Halftime Report. Dry-run any content filter against live vendor rows before trusting it.

The same shape appears in [L076](LAWS.md#l076-adjacent-inline-elements-with-no-whitespace-have-no-wrap-opportunity): a chip row only blew the viewport once real chip-heavy production data was used.

Source: Phase 41 UAT.

### P007. A property test can generate exactly the bug and still miss it.

A fast-check test fed arbitrary band values across ±1000 against a fixed 0.6-1.2 axis — the exact precondition for the negative-CSS-width bug in [L028](LAWS.md#l028-an-unclamped-percentage-fed-into-a-css-width-goes-negative-and-the-element-vanishes). It asserted only on the value marker's `left`, never on the warn and crisis band segments computed from the same unclamped function. A sibling test in the same file already knew how to read those segments.

A property test that generates adversarial input for a shared computation must assert on **every** DOM output that computation feeds, not just the one the author was looking at.

Source: Phase 31 review, WR-02.

### P008. A property test's own expected value can encode the same bug.

A fast-check test that derives its expected result by hand-writing a parallel reconstruction of the domain logic is not independent of the implementation, if the reconstruction makes the same wrong assumption.

The property's own comment documented the roll case as "still unsigned, a documented separate out-of-scope limitation" and reconstructed the expected economics unsigned — matching the pre-fix implementation bug exactly. Fixing the production code made the previously-passing 300-run property suite produce a real counterexample in exactly the scenario its own comment described. The property's reconstruction was stale, not the fix.

Treat that as confirmation the property needed updating, not evidence the fix broke something.

Source: `.planning/debug/journal-pnl-opennetdebit-units.md`.

### P009. An aggregate typecheck is only as complete as its references array. Catch #29.

`tsc --build` against a root tsconfig checks whatever the `references` array lists. The web app was never listed, so `bun run typecheck` had never typechecked it on any branch, ever — while multiple prior phase verifications claimed "clean across all packages including web".

Running the app's own `tsc --build … --force` directly surfaced 13 real pre-existing errors immediately, in files the phase in question had not touched. A separate phase found an overlapping list of 11, confirmed pre-existing by `git diff --stat`. Two more gaps in the same claim. `tsc --build` excludes `*.test.ts`, so a clean typecheck is blind to test files: removing a port from a use-case's dependencies typechecked clean while an MCP test helper still passed the old shape and threw "internal error" at runtime. After any port or dependency-shape change, run the full suite, not a scoped run plus typecheck. And the error *count* drifts between runs from the incremental cache — 9 against 10 with no source change — so pin the baseline to the exact file set it covers and diff against that, never against the number.

Spot-check any "typecheck clean" claim against the actual references list. Then track and diff against that app's own baseline count at every verify gate. Later phases carried explicit baselines of 8, 10 and roughly 42 errors.

Source: Phase 28 and Phase 31 deferred items; Phase 37 review; Phase 41 UAT; Phase 42 validation.

### P010. Trace a computed value to the wire, not to where it is calculated.

A value computed correctly every cycle was used only for a `console.warn` side effect. The read path backing the API hardcoded `changed: false` regardless. A UI feature could structurally never activate against live data, despite the underlying computation being correct and tested. The read path's own test file proved it.

Verification must follow a computed value all the way to its consuming field. "The computation exists and is tested" is not the end of the trace. Same class as [L055](LAWS.md#l055-a-settings-knob-can-validate-persist-and-echo-back-effective-while-nothing-reads-it), where a settings override validated, persisted and displayed as effective while nothing read it.

Source: Phase 26 verification, EXIT-09 gap, closed same day (commit d392a3d).

### P011. A completeness test proves presence of copy, never correctness.

An automated "every knob in the schema has an explainer entry" test passes regardless of what the copy says, because it checks shape, not content. Two live explainer entries were factually wrong: one inverted a knob's direction (a higher value admits **further** out-of-the-money candidates, not closer), and one claimed an override moves the entry gate's penalty and block triggers when the engine's own doc comment says it does not — those constants are fixed in code.

Both were reachable from the live modal's tooltip. A trader acting on wrong-direction copy makes a decision the system will not honour. Money-facing help text must be spot-checked against the resolving code at review time. Exhaustiveness tests cannot substitute.

Source: Phase 32 review, CR-02.

### P012. Prove a no-op refactor by diffing the emitted output, not by a green suite.

A 708-call-site design-token migration was verified as a true no-op by confirming the emitted CSS was byte-identical before and after. A test suite that does not render or snapshot computed styles passes while the visual output silently changes. The regex matters as much as the proof. A prefix-anchored rename needs a non-word-or-hyphen boundary on both sides — `(?<![\w-])(bg|text|border|ring|fill|stroke|from|to|via|divide|outline)-` closed by `(?![\w-])` — with names sorted longest-first so no name is partially rewritten. Prove it in both directions on a curated list before running it: a naive `-line` rename corrupts `eslint-disable-next-line`, `gamma-flip-line` and `date-line`. Eight dangerous look-alikes were checked to stay unmatched and eight tricky true positives to map correctly before the regex touched 708 call sites across 58 files.

Source: `.remember` 2026-07-25.

### P037. A test can assert a value against itself, or against a copy of the config, and pass forever.

Two shapes of the same emptiness. A "kernel parity" test compared `delta` to `delta` and never referenced the Postgres result it was supposed to be diffing against. A CORS policy test hand-copied the allowed-methods list instead of importing the server's, so when the real config lost `PUT`, every browser cross-origin PUT died for a whole phase while the test stayed green. The fix there was one shared `cors-policy` module imported by both the app and the test.

A test that restates the implementation is not testing it. Import the real value and compare two things that can actually differ. A fifth recurrence in the same family: a combined-curve test passed even when one of the two input curves was dropped from the combination, because the assertion could not distinguish the combined case from a degenerate one. Every one of these was found by review, never by the suite.

Source: project memory, Phase 17, Phase 18 and Phase 29 reviews.

---

## Building a test that can actually fail

### P013. `Promise.all` does not reproduce a Postgres race. Hold a blocking transaction.

Firing two async calls concurrently against a real Postgres — even a testcontainer — does not reliably interleave on the window a TOCTOU race needs. Local round trips complete too fast.

To prove the race exists and that a fix closes it, hold an uncommitted blocker transaction open on the target row until the racing call's own SELECT has run, forcing the window open, then release. That is what proved [L006](LAWS.md#l006-select-then-insert-under-read-committed-is-a-toctou-race); a plain `Promise.all` proxy did not.

Source: Phase 40 review.

### P014. A differential test dies with its second implementation. Delete it in the same commit.

A test whose entire purpose is diffing two parallel implementations field-by-field is meaningless once one is removed. Before deleting it, migrate any assertion pinning genuinely distinct, still-relevant behavior into the surviving implementation's own tests, so coverage does not leave with the harness.

A chain-surface differential test fed one fixture chain through both the retired browser math and the new core path, asserting field equality across 22 tests — green on its last day. Deleted in the same change that removed the browser implementation, with core-only assertions moved first.

Source: `docs/calendar-engine/spec.mdx`.

### P015. The leakage oracle: a replay must reproduce the recorded live score exactly.

A rule that normalizes a raw metric against a distribution leaks look-ahead bias if that distribution comes from the whole stored dataset rather than only the data that existed at each decision's own point in time. The leak is invisible: the code runs, the numbers look plausible, and the backtest silently looks better than the strategy would have performed.

If the live system already persisted its real-time decisions for some historical cohorts, replaying those cohorts and asserting the replay reproduces the recorded score **exactly** is a cheap, high-value invariant. Any mismatch is either a percentile leak using future-window statistics, or a late-solved derived value that was not actually available at that time.

Make it a hard test failure, not a soft warning.

Source: `.planning/research/PITFALLS.md` pitfall 2; `.planning/REQUIREMENTS.md` BT-02; ROADMAP Phase 27.

### P016. An oracle must propagate every input read error. A silent default fabricates a false positive.

An oracle's entire value is trustworthy mismatch reporting. If one of its own input reads degrades silently to a default on failure, a transient storage hiccup makes the re-derived value differ for an unrelated reason — and the oracle reports leakage that never happened. For an oracle a false positive is exactly as corrosive as a missed real leak.

A closes-read failure degraded to `[]` — unlike the sibling chain read one line above, which propagated. The empty array nulled realized vol and produced a spurious score-mismatch report (WR-01, Phase 27, fixed 3c286f6).

Source: Phase 27 review.

### P017. Coverage must distinguish "no data" from "no candidates".

A replay returns zero results for two structurally different reasons: a true data gap (empty chain, all spot zero), or real data where every candidate was legitimately gate-dropped. Counting both as a gap understates real coverage and mislabels honest zero-candidate cohorts as missing data — the opposite of the honest signal a coverage metric exists to give.

Classify at the source, inside the chain-read function, into gap / empty-universe / replayed. Never infer from downstream result length (WR-03, Phase 27, fixed d66b675).

Source: Phase 27 review.

### P018. Build a validated oracle before touching money code.

Thirteen real, ground-truth-confirmed production calendars were replayed as regression fixtures, including two sharing a front-month leg and one carrying a stale status column. That oracle is what turned a −$319,850 display into a tractable five-round debug — see [L021](LAWS.md#l021-pin-the-unit-of-a-stored-numeric-field-not-just-its-type).

Any replacement fill-pairing implementation should be required to pass the same 13 calendars. All 13 matched within $0.02 after the fix.

Source: `apps/worker/src/journal-oracle.test.ts`; `.planning/debug/journal-pnl-ground-truth.md`.

### P019. Calibrate against a reference platform with tight IV and loose greeks.

Capture one real, hand-checked example from a trusted reference platform as a fixture and fail CI when the engine drifts. Tolerances are deliberately asymmetric: implied vol within 0.5% relative, greeks and net greeks within 5%. IV is the direct inversion output; greeks inherit and compound whatever error survives in it. A single uniform tolerance is either too loose to catch a real IV regression or too tight for the naturally noisier derived values.

This catches silent math regressions — a sign error, a wrong annualization constant, a mis-scaled greek — that a synthetic unit test with invented inputs never surfaces, because the fixture is real market data with a known-correct answer from an independent source.

Source: `docs/architecture/testing-tdd.md`; `knowledge-base/calendar-trade-dashboard-learnings.md`.

### P033. Overlapping windows inflate a t-statistic, and inflate it toward what you were hoping for.

Building a sample by taking every date as a new observation with a multi-day hold makes neighbouring rows share most of their information. The effective sample is far smaller than the row count, and the inflation is not neutral — it flatters whatever effect is being tested.

Two entry gates looked real on overlapping windows and died on non-overlapping ones. `VIX9D/VIX ≥ 1.00` went from a −$592 cost effect to −$214 at t = −0.74. `VIX3M/VIX < 1.111` went from −$378 to −$184 at t = −0.70. Both were dead once the sample was rebuilt by walking forward and skipping the hold length.

Rebuild the sample before reading any t-statistic off it. The two gates themselves are at [R052](refuted.md#r052-two-vol-ratio-gates-predict-a-calendars-realised-cost).

Source: project memory, calendar strike-side study.

### P034. A test-id prefix is a namespace. One sibling sharing it corrupts every query.

Selecting repeated rows by a prefix pattern — `/^chain-cohort-/` — sweeps in any unrelated element whose exact id starts the same way. A single header stat named `chain-cohort-count` silently joined every row query and broke every count assertion built on it.

Treat a test-id prefix as reserved. Name summary and header elements outside the namespace their rows occupy.

Source: project memory, chain browse-and-pair UAT.

### P038. A test environment missing a schema exercises only the fallback path.

If a repository probes a schema the test container never creates — `pgboss`, here — every probe takes the absent-branch. The tests pass, they cover the fallback, and they cover nothing else. The primary path first runs in production.

Seed real rows for every schema a repository reads, even one owned by a library. Testcontainer suites have a second blind spot in the same family: fixtures are small, so a production-scale limit like the 65,534 bind-parameter cap ([L007](LAWS.md#l007-chunk-every-bulk-insert-postgres-caps-a-statement-at-65534-bind-parameters)) is never reached.

Source: project memory, Phase 2 production lessons.

---

## Diagnosis discipline

### P020. A root cause read off the code is a hypothesis. A root cause read off the wire is a finding.

A data-quality bug diagnosed purely by reading adapter code — spotting an `optional() ?? 0` fallback and concluding the vendor omits the field — was written up and acted on as confirmed. It was wrong. The vendor sent the field correctly the whole time (21,320 rows non-zero, 78.7%). The real defect was a merge-order bug in a dedup window. One `curl` of the public endpoint would have caught it, and would have prevented a migration built to fix a field that was never broken.

Source: `plans/analyzer-chain-HANDOFF.md` law 12.

### P021. A symptom sampled once is not a symptom.

"Open interest is 0 for every contract" was true of the 04:00Z cohort and false of the 11:30Z one. `GROUP BY time, source` was the query that actually explained it.

Any anomaly whose severity might correlate with ingest timing or market hours must be measured across multiple cycles before being called a defect. A single off-hours snapshot of a healthy pipeline looks identical to a dead one. Confirmed on the other side too: 14 of 14 regular-hours cycles produce walls; weekends produce none. Chasing a GEX "bug" that was a closed market cost an entire evening.

Source: `plans/analyzer-chain-HANDOFF.md` law 13; `tools/tradingview/README.md`.

### P022. Re-derive every audit number. Never cite a predecessor document.

An audit's headline figures traced to a prior handoff rather than to a query the audit itself ran. Re-running the commands directly found five of its own claims wrong:

| Claimed | Actual | How |
|---|---|---|
| 3,162 production / ~4,700 test lines (sums to 7,862, alongside a quoted total of 9,478) | 4,224 / 5,254 / 9,478 | Direct re-count |
| 25 typecheck errors in 6 files, 8 from one file | 20 errors in 8 files, 11 from that file | `tsc --noEmit` |
| DDL for 24 tables | 25 | `rg -c 'pgTable\(' schema.ts` |

Attach the exact reproducing command to every published number. Treat any status claim without one as unverified, however confidently it is stated.

Source: `docs/calendar-engine/critique.md`; `docs/calendar-engine/measurements.md`.

### P023. Preserve a source's self-contradiction verbatim.

A live trading journal disagreed with itself about its own trade count: 1,380 in its key-statistics table, 1,381 in its title, "over 1,300" in its conclusion. Do not average, do not pick the more official-looking figure, do not silently correct. State the discrepancy — it is diagnostic. A source sloppy about its own trade count invites proportional skepticism about its unverified claims. See [D047](domain-trading.md#d047-a-published-live-short-vol-track-record-8997-over-two-years-and-the-tail-is-the-whole-risk-budget).

Source: `docs/research/predicting-alpha-ultimate-guide-to-selling-options.md`.

### P024. An extract longer than its source has something added. Audit constants corpus-wide.

Two rules from a 10-agent extraction of a 56-article course.

First, hold an extract to a ratio of its source's length, not to a word floor. The rewritten modules landed at 60-83% of their source articles.

Second, audit numbers across the whole corpus, not unit by unit. Repeated round constants appearing identically in independently-written sections are the fabrication tell — here, 252 and 15.9 as annualization figures, present in the output and absent from the source. A per-unit audit misses that pattern by construction. A later re-audit still caught 3 more errors after the first pass declared 10 modules clean. Two mechanics decide whether the audit works at all. Match numbers numerically rather than textually, so `82.60` satisfies `82.6`, and compare against the whole corpus rather than the source unit — a per-unit comparison false-flagged a real example the author had legitimately borrowed from another article in the same course. For quotations, normalize curly punctuation to straight before comparing or every genuine quote false-positives, and separate the agent's own commentary from the author's words: identical blockquote styling makes an editorial note read as the source's voice.

A numeric audit is also blind to a fabricated quote. Check those separately.

Source: `docs/research/predicting-alpha-ultimate-guide-to-selling-options.md`; `.remember` 2026-07-28. Tool mechanism: [V065](vendors-and-infra.md#v065-webfetch-summarizes-before-handing-text-to-the-model-and-pads-the-gap-with-plausible-domain-knowledge).

### P025. A comment citing a line range is a decaying asset.

This repo's own documentation guidance bans line-number citation in prose. The failure mode was already realized in-repo: comments citing line ranges for "the duplicated block elsewhere" had drifted after refactors, a docblock's stated delta band (−0.55 / −0.25) no longer matched the constants a few lines below it (−0.49 / −0.30), and a header described a filter retired elsewhere. Two separate audits disagreed with each other about the current line range for the same block.

Delete or fix a stale citation on sight. Use file paths and function names.

Source: `docs/docs-on-docs/content-principles.md`; `docs/calendar-engine/current-state.md`; `docs/calendar-engine/critique.md`.

### P026. Verify a claimed fix against the code, not against the note claiming it.

A prior session's own notes said a GEX wall computation had been fixed to use near-term walls instead of all-expiry data. Checked against the code, the fix had never been built. The note was a false memory, corrected on discovery.

The same class bit harder once: a progress note claimed fixes that were never committed. Verify code, not notes — including your own. See [R002](refuted.md#r002-the-near-term-gex-wall-fix-was-already-built).

Source: `.remember` 2026-08-05; project memory, crash 2026-07-23.

### P036. Pin every check to a cutoff the thing being verified must beat.

Reading "the newest row" and calling a fix proven has failed twice here, because the newest row predated the deploy both times. A stale stamp and a fresh one look identical.

The form that works: compute the deploy instant, query `WHERE stamp > cutoff`, and state the number the fix must produce *before* looking at the result. On the 2026-07-28 skew fix, pre-deploy read 1,773 rows with 65 puts and post-deploy read 3,521 with 1,765 — only the second number is evidence, and only because the cutoff was fixed first.

Source: project memory, key-collision sweep and verification laws.

### P039. A hypothesis that fits the dates is still a hypothesis.

`implied_carry` held dividend yields at −1342%, and the damage stopped exactly as migration 0028 landed. The story wrote itself: corrupt roots gave the wrong settlement clock, the wrong T, and a garbage parity solve. It was wrong. `computeGexSnapshot` derives T from the OCC symbol and never reads the repaired columns at all. The real cause was an unrelated guard added four hours earlier.

A date correlation nominates a suspect. What convicts is a discriminating window — here, a period where the inputs were still corrupt and the output was already clean. Look for that window before writing the mechanism down.

Source: project memory, verification laws. Same distinction read off code rather than dates: [P020](#p020-a-root-cause-read-off-the-code-is-a-hypothesis-a-root-cause-read-off-the-wire-is-a-finding).

---

## Shipping discipline

### P027. Deploy debt compounds. An undeployed alert surface protects nothing.

A token-expiry warning banner built to protect production is worthless until deployed to it. Production still ran a pre-phase-15 image while the alert built that milestone sat unshipped. Track "deployed to prod" as a distinct milestone from "shipped in code", and treat the gap as compounding risk. This one stayed open a full milestone and closed in Phase 16.

Source: `.planning/RETROSPECTIVE.md` key lesson 4; `.planning/PROJECT.md` known debt; `.planning/MILESTONES.md`.

### P028. Discover vendor behavior empirically, never from docs or memory.

Undocumented vendor behavior — message types, code-expiry windows, session limits — must be found by probing the live endpoint. Written into the roadmap explicitly as a discipline and credited with avoiding rework. Every trap in [vendors-and-infra.md](vendors-and-infra.md) is what that discipline bought.

Source: `.planning/RETROSPECTIVE.md` key lesson 3.

### P029. Carry hard-won facts as a standing regression checklist, not as institutional memory.

An explicit regression-gates list in the project's state file had to be re-affirmed by every subsequent milestone. It carried four facts through three milestones: SPX open interest reads zero with a SPY proxy at ~10.048×, CBOE timestamps are UTC not Eastern, GEX carries negative gamma for puts, and any single INSERT chunks at ≤2,000 rows against the 65,534-parameter limit.

The engine's rule registry enforces the same idea in code: a test asserts that refuted criteria never appear as rule ids, and the rule-category enum stays closed so a retired heuristic cannot slip back under a new name.

Source: `.planning/STATE.md`; `.planning/PROJECT.md`; `docs/architecture/picker-rules.md`.

### P030. Docs before architecture changes — and re-check the documented rule against the real dependency graph.

A documented layering rule drifted out of sync with the codebase: a pure-math package was a real dependency of `core` while the written rule said `core` may import one specific package only. Per the repo's own workflow rule, the documented rule was updated first, before writing new code that also depended on it (commit 37c083a).

Re-check a layering rule against `package.json` periodically. It does not hold just because it is written down.

Source: `docs/calendar-engine/critique.md`; `docs/calendar-engine/spec.mdx`.

### P035. An executor agent under a TDD mandate can skip the RED commit and say nothing.

Agents told explicitly to work red-to-green still bundled tests and implementation into single `feat()` commits with no failing-test commit in between. Nothing in the output signals it. The work looks finished and the suite is green.

The check is one command per plan: `git log --grep="^test(<plan-id>):"`. An empty result on a behavior-adding plan means the RED step never happened, and the plan should be redone with the mandate restated. Run it after each plan, not at the end of the phase.

Source: project memory, Phase 3 execution.

---

### P031. The catch ledger: defects a green suite let through.

The project numbered these as it found them. Numbering preserved. Only entries with a number in the source record are listed.

| Catch | Defect | Where it hid |
|---|---|---|
| #19 | Percentage-height chart container collapsed to 0px in production | 3,175 jsdom tests green; harness pins explicit pixel dims — [P004](#p004-jsdom-is-blind-to-a-percentage-height-collapse-catch-19) |
| #20 | Overlay marks drifted ~16% off the curves | jsdom mock renders at exactly the hardcoded constants — [P005](#p005-jsdom-is-blind-to-dual-coordinate-drift-catch-20) |
| #24 | Closed `<details>` could not be CSS-revealed; desktop left column empty at ≥1024px | jsdom class assertions are structurally blind — [L075](LAWS.md#l075-a-closed-details-cannot-be-revealed-by-css) |
| #26 | A price fell back to 0 on a newly reachable cold-start path and priced a payoff off it | Path was unreachable on desktop, so no test covered it — [L067](LAWS.md#l067-a-dedicated-mobile-tree-makes-states-reachable-that-the-desktop-structure-made-impossible) |
| #27 | 9 adjacent inline chips blew a 390px viewport to 533px | Short-content fixtures never produce enough chips — [L076](LAWS.md#l076-adjacent-inline-elements-with-no-whitespace-have-no-wrap-opportunity) |
| #28 | One `.strict()` schema conflated two wire shapes; the re-auth wizard was 100% dead in both directions | Each side's tests fed a body the other side never emits — [P002](#p002-two-sides-of-a-contract-can-both-be-green-against-fixtures-neither-producer-emits) |
| #29 | The web app was never in the root typecheck graph | The command reported clean because it never looked — [P009](#p009-an-aggregate-typecheck-is-only-as-complete-as-its-references-array-catch-29) |

Review findings carrying their own ids, worth citing by them: Phase 24 WR-01/WR-02; Phase 25 WR-01; Phase 26 CR-01, WR-01, WR-02, EXIT-09; Phase 27 CR-01, WR-01, WR-03; Phase 28 CR-01, WR-01, WR-02; Phase 29 CR-01, CR-02, WR-02; Phase 30 CR-01, WR-01, WR-02; Phase 31 CR-01, WR-02; Phase 32 CR-01, CR-02; Phase 33 CR-01, WR-01, WR-02; Phase 34 CR-01, WR-01, WR-02; Phase 35 CR-01, WR-02; Phase 35.1 WR-01, IN-05; Phase 36 WR-01; Phase 37 CR-01, CR-02, WR-03; Phase 40 CR-01, WR-01, IN-01.

---

### P032. Adversarial multi-agent research earned its keep. Three passes, three different jobs.

Three research passes appear in the record, each with a different shape and a different yield.

**18 agents, 2026-07-27.** Established that the vendor's published entry gate never fires on this underlying (0 of 2,465 candidates), that open interest breaks on 175 of 255 near-ATM legs, and locked four design decisions plus an engine spec. See [D004](domain-trading.md#d004-a-vendors-absolute-vol-point-threshold-does-not-transfer-to-a-different-underlying), [D009](domain-trading.md#d009-on-a-fresh-weekly-index-chain-neither-open-interest-nor-spread-is-a-usable-liquidity-filter).

**102 agents, 3-vote adversarial, 2026-08-24.** Verified 25 claims about calendar entry criteria. It killed four commonly-repeated heuristics outright ([R008](refuted.md#r008-four-textbook-calendar-selection-criteria)), established that a published gate is a monthly decile rank rather than a threshold, and found an index-versus-single-name sign flip that invalidates porting single-name rules ([R009](refuted.md#r009-a-slope-to-return-relationship-measured-on-single-names-holds-on-an-index)). Three gaps came back explicitly unanswered rather than guessed at.

**10 agents, corpus extraction.** Yielded [P024](#p024-an-extract-longer-than-its-source-has-something-added-audit-constants-corpus-wide) and [V065](vendors-and-infra.md#v065-webfetch-summarizes-before-handing-text-to-the-model-and-pads-the-gap-with-plausible-domain-knowledge) — the extraction tool fabricated, and the fix was raw text plus a corpus-wide numeric audit.

The pattern that worked: adversarial voting on each claim, an explicit refuted list as an output artifact, and permission to return "no published answer" rather than a fabricated one. A research pass that returns only confirmations did not adversarially test anything.

Source: `.planning/research/calendar-selection-criteria.md`; `.remember` 2026-07-27, 2026-08-24, 2026-07-28.
