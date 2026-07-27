# Analyzer chain — handoff

**Rewritten 2026-07-27 ~04:45 CDT**, replacing the 2026-07-26 22:15 version. Everything the
previous handoff listed as open is now done and verified live, so this is a fresh state-of-play
rather than a diff. The old UAT findings are archived in
[`analyzer-chain-uat-findings.md`](analyzer-chain-uat-findings.md) — read it only for history;
every P0/P1/P2 in it is closed.

---

## Where things stand

**Done and live on morai.wtf.** `main` is at `8dc1dce`: **3890 tests / 346 files green**, root
typecheck clean, `apps/web` tsc at its pre-existing **9-error baseline**, lint clean. Production
deploy for `8dc1dce` succeeded and was walked end to end in the browser at 1440×900 and at an
emulated 390×844.

The Analyzer is now **two surfaces** instead of one table:

- **Browse** — row = one `(root, expiration)` cohort, all of them. Expand it and you get that
  cohort's entire strike ladder, each strike a single LEG: its own IV, V-Skew, Δ/Γ/Θ/vega,
  bid/ask, OI, and Front/Back pick buttons. Nothing joined, nothing filtered.
- **Pair** — the front and back legs you picked. Only then does calendar math appear: H-Skew,
  Fwd IV, EDGE, net Δ/Γ/Θ/vega, the haircut debit, and a TOS order line with a button that fills
  the Risk profile paste box below.

The old shape put one row per strike pre-paired across two chosen expiries. That was an **inner
join** — only strikes quoted in BOTH expiries got a row, so a strike listed in August but not
September was silently absent, with no dash and no marker. That is why it is gone.

### Live verification, morai.wtf, chain observed 2026-07-27T04:30Z, spot 7411.98

| Check | Result |
|---|---|
| Cohorts listed | **54** |
| Duplicate row keys | **0** (was 242) |
| Both OCC roots visible separately | Yes — e.g. `SPX-2026-07-27` *and* `SPXW-2026-07-27` |
| Their ATM IVs genuinely differ | 28.67% (SPX) vs 21.84% (SPXW) — the collision that used to be invisible |
| Negative-DTE cohort present | None. Nearest is Jul 27 at DTE 0 |
| Em-dash cells in an expanded ladder | **0 of 551** — the "most columns dash" symptom is gone |
| Sorting | Works. Toggle reverses, strike returns to ascending, theta reorders, nulls last |
| Pair math, hand-checked against live legs | All correct — see below |
| Three odd-pair flags | All three fire, and each suppresses the TOS button |
| Mobile 390px | Body never scrolls horizontally; each table scrolls in its own wrapper |

The hand-check, SPXW 7400P Aug 21 (25d, IV 15.94%) against Sep 18 (53d, IV 15.84%):

```
H-Skew  +0.10   = 15.94 − 15.84                                    ✓
Fwd IV  15.74%  = √((53·15.84² − 25·15.94²)/28)                    ✓
EDGE    +0.19   = 15.94 − 15.74                                    ✓
Net Δ   +0.009  = −0.448 − (−0.457)          back − front          ✓
Net Γ   −0.0004 = 0.0009 − 0.0013            NEGATIVE = short front gamma ✓
Net Θ   +0.79   = −1.38 − (−2.17)            positive = collecting ✓
Debit   47.28   = (158.40 + .66·1.20) − (112.70 − .66·1.20)        ✓
```

---

## What was fixed, and what it cost

### The root collision, properly closed (was P0)

PR #23 added `root` to the wire contract but only fixed ONE consumer. Two more were still
root-blind, and both are the dangerous class — every input present and finite, so nothing dashes
and the cell renders a plausible wrong number:

| Function | Was | Now |
|---|---|---|
| `chain-math.atmIv` | `(rows, spot, expiration, contractType)` — the cohort held two rows per strike and `find` returned whichever the vendor union emitted first, often the twin whose IV never solved | takes `root`; scopes the cohort **and** `atmStrike`, because the two roots list ragged ladders |
| `chain-risk-reversal.riskReversalForExpiry` | filtered on expiration alone → ONE smile built from TWO books, two IVs per delta | takes `root` |

Both are enforced **by signature**, not a doc comment. `api-design.md` also never picked up
`root` when #23 landed; it now documents it as row identity with the production failure attached.

### The other closed items

- **P1** — cohorts with `dte < 0` are dropped. An expired contract cannot be traded. 0DTE stays.
- **P2** — the Edge legend said `forward IV − front IV`; the code computes `ivFront - fwdIv`.
  Caption fixed, math untouched. Verified live.
- **3b, the detail row opening far from the clicked row, and the stuck sort** — both dissolved
  with the reshape. They were the same duplicate-React-key cause; keys now carry all four
  identity fields and there are 0 duplicates live.
- **`formatAsOf`** — the byte-identical private copy in `HeldPositionsPanel.tsx` is gone.
- **Column glossary** — all of it is in the two legends, including the mental model the previous
  handoff flagged as must-teach: *V-Skew picks the STRIKE, EDGE picks the EXPIRY PAIR.*

### Caught by the live UAT, after the merge

1. **The TOS order tagged an SPXW leg `[AM]`.** `formatTosDate` tags any third Friday, because
   the older candidate builder had no root and "third Friday" was the only proxy for the
   AM-settled monthly. Wrong proxy: SPXW is PM-settled on every date it lists. A real SPXW
   Aug-21/Sep-18 7400P calendar came out `[AM]` on both legs — **that selects the wrong contract
   in Thinkorswim**. `buildTosPairOrder` now tags on the root.
2. **The expanded ladder dragged the cohort table to 1030px.** A cell's content counts toward
   table width, so the ~1000px ladder stretched every cohort row on expand and, at 390px, had no
   scroll of its own. `w-0 min-w-full` on the detail wrapper fixes it (cohort wrapper now stays
   576px before and after expand; ladder scrolls 996-in-542).

### Deliberately accepted costs

- **The term structure can no longer be scanned at a glance.** Every row used to carry
  H-Skew/EDGE. Row-per-expiration loses that. If it bites, the follow-up is a compare mode over
  one chosen front leg — "this strike against every back expiration" — **not** a rebuilt inner
  join. Recorded in D29.
- A cross-root, inverted, or diagonal pair is **reachable but flagged**, and emits no TOS line.
  You built it deliberately; the join used to build them silently.
- A mixed-wing pair stays unrepresentable: switching Puts/Calls clears both picks.

---

## FIXED 2026-07-27 — the open-interest zeros, and the diagnosis that was wrong

**The earlier version of this section blamed `?? 0` in the two vendor adapters. That was wrong,
and the way it was wrong is the lesson: it was inferred from reading code, never checked against
the vendor.** What checking found:

- **CBOE sends open interest on everything.** The raw public payload carries `open_interest` on
  all 29,186 contracts, 21,320 of them non-zero, max 268,662. It is present in *every* snapshot,
  at a steady 78.7% non-zero.
- **The DB has real values too.** `SPX 260821P06675000` → 3,461, matching CBOE exactly. The
  3461 / 264 figures the first handoff recorded were real, and still are.
- **So `?? 0` was never the cause.** It is still a latent defect worth cleaning up one day —
  `optional()` + `?? 0` makes "not reported" indistinguishable from a real zero — but nothing
  currently reaches it.

**The actual cause was merge order.** Schwab's chain returns `openInterest: 0` for *every*
contract outside RTH — measured 0.0% non-zero from 04:00Z through 10:00Z, flipping to 86.3% at
10:30Z. CBOE always has real values. Both land in the same 10-minute cohort window, and Schwab
writes about a minute *after* CBOE, so `DISTINCT ON (contract) ORDER BY time DESC` handed the
whole chain Schwab's zeros overnight. **2,971 contracts a day.** And GEX is open interest ×
gamma, so it computed zero gamma at every strike and reported null walls — the entire "GEX is
broken" story. It self-heals when RTH data lands, which is why GEX read perfectly healthy a few
hours later (flip 7446 against spot 7412, walls 7500 / 7000, real gamma throughout).

That also explains why the first UAT saw "OI 0 everywhere": it sampled the 04:00Z cohort, where
Schwab was the only writer. Re-checked at 11:30Z the same ladder reads `Open Int = 950`, 3,461,
23,640 — correct all along, in a different snapshot.

**Fixed in all THREE consumers**, because fixing one hides the others:

| Read | Who it feeds |
|---|---|
| `postgres/repos/picker-chain.ts` | the chain the Analyzer and the picker read |
| `postgres/gex-snapshot.repo.ts` | GEX — the primary victim |
| `postgres/repos/backtest-chain.ts` | every replayed cohort, so the calibration corpus was scored against open interest that did not exist |

Each now takes `max(open_interest) over (partition by contract)` rather than the newest row's
value. This is correct, not a heuristic: open interest is a once-daily OCC figure and never
negative, so within one cohort window the larger of the two sources IS the reported value, and a
genuinely untraded strike still reads 0 because both sources then report 0. Postgres evaluates
window functions *before* `DISTINCT`, so the surviving row already carries its partition's max —
one query, no subselect. Prices, gamma and IV still come from the newest row.

### Also fixed: the parity-implied dividend yield

Parity divides the residual by T, so the noise gain is 1/T. Live readings: **0DTE q = 0.2984
(29.8%)**, 1DTE 0.0823, 2DTE 0.0450, 3DTE 0.0291, settling to the ~0.009–0.012 SPX actually
yields only from 4DTE out — plus **negative** values on sparse expiries (2026-08-23 → −0.1201,
2026-09-02 → −0.0857), which is not a quantity an index can have.

`impliedDivYield` now refuses a horizon under 7 days and any answer outside `[0, 0.10]`. **Null,
not a clamp** — `computeImpliedCarry` already emits no entry for an unsolved expiry, so every
consumer falls back to its flat default, whereas a clamped number would still pose as a
measurement. This matters because Browse lists every expiry: a 1DTE front leg is one click away
and its greeks were being priced at an 8% dividend yield.

### Correction that still stands

The first handoff claimed "every greek on the chain table is priced against the flat 4.5% / 1.3%
defaults instead of per-expiry implied carry". **False.** `gex.impliedCarry` is fully populated
(39 expirations) and `resolve-carry.ts:22` is a plain lookup that finds them. Chain greeks do use
implied carry — which is exactly why the bad `q` values above mattered.

---

## Also open

- **`apps/web/src/screens/Analyzer 2.tsx` — delete it.** An untracked accidental duplicate dated
  Jul 25, holding the pre-reshape "ranked-cards PICKER" version of the screen. Nothing imports
  it, so it is not bundled and CI is unaffected, but it imports the now-deleted `ChainTable`, so
  its types collapse to `any` — and it is the **sole source of all 10 `bun run lint` errors and
  11 of the 20 errors `apps/web`'s own tsc reports**. Excluding it, that tsc is at its exact
  9-error baseline. Left in place because deleting an untracked file is unrecoverable; it is your
  call: `rm "apps/web/src/screens/Analyzer 2.tsx"`.
- **Vercel preview deploys cannot run the app at all.** The preview build throws
  `Uncaught Error: supabaseUrl is required` — the Supabase env vars are scoped to Production
  only. So no PR in this repo can be UAT'd on its preview URL; tonight's UAT had to happen on
  production after merging. Worth fixing in the Vercel dashboard (add the vars to the Preview
  environment) because it removes the only safe place to check UI before it ships.
- `MarketRail.test.tsx` has one CWD-dependent test: it reads its own source with a repo-relative
  path, so it passes from the repo root and fails from `apps/web`. Pre-existing, harmless, one
  line to fix.
- The picker's own root-awareness was not audited. `candidate-selection.ts` reads each leg's
  `root` for settlement timing (`yearFractionToSettlement`), so it is not obviously broken, but
  whether its *pairing key* includes root is an open question and out of scope tonight.

---

## Assets worth reusing

| Thing | Where |
|---|---|
| ATM reference IV — expiry, wing AND root enforced **by signature** | `chain-math.atmIv` — never hand-roll this lookup |
| 25Δ RR, root-scoped, null when unbracketable | `lib/chain-risk-reversal.ts` → `riskReversalForExpiry` |
| Forward vol + its `inverted` guard | `core/picker/domain/fwd-iv.ts` → `computeFwdIv` |
| Per-strike column math, 8 exports | `apps/web/src/lib/chain-math.ts` |
| Fill haircut (ORATS 0.66 width) | `core/picker/domain/candidate-selection.ts` → `haircutFill` |
| Per-expiry carry (r, q) with flat fallback | `apps/web/src/lib/resolve-carry.ts` |
| Shared chain number formatting + the em-dash `Num` cell | `components/chain/chain-format.tsx` |
| Full row identity (root, expiry, wing, strike) | `useChainModel.legKey` |
| TOS order line for two picked legs, root-tagged | `lib/tos-order.ts` → `buildTosPairOrder` |
| Nested table inside an expanded row | `ChainBrowse.tsx` — note the `w-0 min-w-full` wrapper |
| One-tree responsive | `-mx-2 overflow-x-auto px-2` wrapper + `min-w-[Npx]` table. No `useIsDesktop` |

---

## Laws learned, this round and last — do not relearn them

1. **A widened read turns every key-based lookup into a latent wrong-wing/wrong-root match.**
   Widening the chain produced FIVE separate bugs across two sessions: the exit advisor's
   `toRollCandidates`, the table's row key, `vSkewVsAtm`'s reference, `atmIv`'s cohort, and the
   RR adapter's smile. **Grep every consumer before widening a shared read — and again after
   fixing one, because fixing the first hides the rest.**
2. **The dangerous defects are the ones that cannot null themselves.** Every other degraded input
   nulls its own column and shows an em dash. A cross-wing or cross-root pair has every input
   present and finite, so it renders a clean plausible wrong number. Enforce those by
   **signature**, never by doc comment. `atmIv` is the model.
3. **A test fixture whose variants share a value is vacuous.** Prove teeth by breaking the code
   and watching the test fail. Done twice tonight — and it paid: the RR root test's
   "leak" assertion turned out to pass even root-blind (the interpolator takes the tightest
   bracket), so the comment now says which assertions are actually load-bearing.
4. **`apps/web` typecheck baseline is 9 — and only after `bun run typecheck` warms the project
   references.** Cold, it reports 28 (TS6305/TS2307 from unbuilt `packages/*` dist).
5. **apps/web does NOT use msw.** Mock the RPC layer:
   `vi.hoisted` + `vi.mock("../lib/rpc.ts", …)`.
6. **A testid prefix is a namespace.** `chain-cohort-count` on a header stat shadowed every
   `/^chain-cohort-/` row query. Do not give a scalar the row prefix.
7. **A vendor field mapped `?? 0` is a fabricated number.** `optional()` + `?? 0` makes "not
   reported" indistinguishable from a real zero. This is what silently killed GEX.
8. **`bsmIv` can be the literal string `"NaN"`**, not just null — a genuine `"0"` must survive.
9. **Array reads return `200 []`, never 404.** Mount routes in the *chained* `apiRouter` builder.
10. **Verify on production, not on a preview** — until the preview env vars are fixed, the
    preview cannot even boot. Merge during a market-closed window and walk it immediately.
11. **A "sort looks stuck" report may be correct behaviour.** V-Skew descending matched
    strike-ascending on a live ladder because put skew is monotone there. Check the data's shape
    before believing the UI is broken.
12. **Check the vendor before blaming the mapping.** The `?? 0` diagnosis in this file's first
    version was inferred from reading two adapters and was wrong — CBOE was sending open interest
    the whole time. One `curl` of a public endpoint would have caught it, and would have saved a
    nullable-contract migration that fixes nothing. **A root cause read off the code is a
    hypothesis; a root cause read off the wire is a finding.**
13. **A symptom sampled once is not a symptom.** "OI is 0 for every contract" was true of the
    04:00Z cohort and false of the 11:30Z one. Anything that varies with the ingest cycle has to
    be measured across cycles before it gets called broken — `group by time, source` was the query
    that actually explained it.
14. **Reviewer output is leads, not verdicts — and variance claims especially.** A reviewer
    subagent cleared five categories correctly, then reported the `onPickFront={chain.pickFront}`
    handoff as "parameter variance backwards, technically unsound". It is the opposite: passing
    `(ChainLegId) => void` where `(ChainLegRow) => void` is wanted is the CONTRAVARIANT, sound
    direction, and TS accepts it for that reason. Proved with a two-line probe under
    `--strict --strictFunctionTypes` — only the reverse assignment errors (TS2322). Before acting
    on a variance finding, compile that probe: it separates "TS allows it because it is sound"
    from "TS allows it because of method bivariance", and only the second is real. Related:
    `ChainLegId` is also the honest type for those functions, since they only call `legKey`.
