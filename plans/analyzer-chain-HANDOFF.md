# Analyzer chain table — handoff

**Written 2026-07-26 22:15 CDT.** Read this plus
[`analyzer-chain-uat-findings.md`](analyzer-chain-uat-findings.md) and you can resume cold.

---

## Where things stand

The Analyzer was reworked from "engine proposes scored calendars" into a chain data table.
**11 PRs (#12–#22) are merged. `main` is green: 345 files / 3842 tests, typecheck + lint clean,
`apps/web` tsc at its pre-existing 9-error baseline.** Deployed and live on morai.wtf; Railway
serves `GET /api/chain` (200, 11,711 rows).

The screen now shows: expiry-pair selects, Puts/Calls toggle, spot + observedAt + 25Δ RR
header, a 13-column table, and the surviving payoff panel. No score, no verdict, no ranking.
The `analyzer-mobile/` tree is deleted — one tree for all viewports, Journal's recipe.

**It is live but NOT trustworthy.** See P0 below. Do not trade off this table yet.

---

## What to do next, in order

### 1. P0 — add `root` to the chain contract

`ChainQuoteForPicker` (`packages/core/src/picker/application/ports.ts`) carries
`root?: "SPX" | "SPXW"`. **The frozen wire contract dropped it.** That was the coordinator's
error in the plan, not a worker's.

SPX and SPXW quote the same `(strike, expiration, contractType)`. The repo's
`DISTINCT ON (contract)` correctly returns both — different OCC symbols — but on the wire they
are indistinguishable. Observed live at strike 6675000:

```
2026-08-21  P  dte 25  bsmIv 0.2510849  bid 10.1  ask 11.1  OI 3461
2026-08-21  P  dte 25  bsmIv null       bid 10.7  ask 11.2  OI 264
```

Consequences, all observed on morai.wtf: **242 duplicate row IDs**; most derived columns dash
because the join keeps whichever twin it saw last and that is often the `bsmIv: null` one; and
one row rendered back IV 68.89% against front 24.69% (H-Skew −44.21) — an SPXW quote measured
against an SPX one.

That last one is the dangerous class: it renders a plausible number, not a gap. Same failure
mode as the cross-wing pair, which we did engineer against.

Touch points:
- `packages/contracts/src/chain.ts` — add `root: z.enum(["SPX","SPXW"])`
- `packages/core/src/picker/application/getChain.ts` — carry it in the row mapping
- `apps/web/src/components/chain/ChainTable.tsx` — `rowKey` must include it
- `apps/web/src/hooks/useChainModel.ts` — join key alongside `contractType`

Make it part of row identity so a mixed-root pair is unrepresentable in the type, the way
Unit 8 handled the wing. Do not settle for a doc comment — this is the constraint class that
cannot null itself.

### 2. P1 — default expiry pair is an expired front leg

Front defaults to `2026-07-26 · -1d`, back to `2026-07-27 · 0d`. `useChainModel` takes
`expirations[0]` / `[1]` sorted by DTE ascending, and the cohort still carries yesterday's
expiry. Negative DTE → `legGreeks` nulls → the table opens as a wall of em dashes.

Default to the first two expiries with `dte >= 1`, or drop `dte < 0` from the selector list.

### 3. P2 — the Edge legend states the formula backwards

Legend says `Edge = forward IV − front IV`; `chain-math.edge` computes `ivFront - fwdIv`.
Fix the caption, not the math — positive Edge means the front is rich, which is the setup you
want, and matches H-Skew's direction.

(The H-Skew legend had the identical defect and was fixed during the merge. This one was
missed.)

### 3b. Detail row opens far from the row you clicked, after sorting

User report: "if I sort by a column the opening of the details does not open right below the
pane above — it opens WAY LOWER."

**Likely the same P0 root collision, not a layout bug.** `expandedKey` is
`${contractType}-${strike}`, and 242 keys are currently duplicated across SPX/SPXW. So
`renderRowDetail` returns non-null for BOTH twins. Unsorted they sit adjacent and it looks
roughly right; sorted by a data column they land far apart, so the panel appears under the twin
instead of the row that was clicked.

**Hypothesis, not confirmed.** Fix `root` first, then re-check on morai.wtf before spending any
time on layout. If it survives the root fix, look at `DataTable`'s `renderRowDetail` fragment
ordering against `ChainTable`'s internal `sorted` array.

### 4. Reshape to the TOS Trade-tab layout — USER'S NEW DIRECTION

> "this table should be by the expirations just like TOS. WE expand the EXPIRATION and it shows
> me details basically" — and "I should have the choice to select strikes".

Row = **expiration**. Expand → that expiration's strikes. This supersedes the shipped
"row = one strike, pre-paired calendar" design.

Why it is the better shape:
- The current table is an **inner join** — it only emits strikes quoted in BOTH selected
  expiries, so any strike in August but not September silently vanishes. No dash, no marker,
  the row simply is not there. On a screen whose whole point is "give me the data, do not
  decide for me", a hidden filter is the worst possible default. This is independent of the
  root bug.
- The user picks their own two legs rather than the model pre-pairing them.

**DECIDED: two surfaces, not one table doing both jobs badly.**

**Surface 1 — Browse.** Row = expiration (ALL of them, nothing filtered). Expand → every
strike that expiration lists, with per-leg IV, Δ/Γ/Θ/vega, bid/ask, OI, and V-Skew. Pure TOS
Trade tab. No pairing, no join, nothing hidden.

**Surface 2 — Pair.** User selects a front leg and a back leg. That pair renders the calendar
math: **H-Skew, Fwd IV, EDGE, the calendar's net Δ / Γ / Θ / vega, both legs' IVs, and the
haircut debit**, plus the payoff. The user explicitly asked for the calendar greeks and the IVs
on this surface — they are the reason to trade a calendar off this screen at all.

Do NOT drop surface 2 to get surface 1. Keeping the pair math was an explicit user decision.

Known cost of the reshape, accepted: today every row carries H-Skew/Fwd IV/EDGE, so the term
structure can be **scanned** at a glance. Row-per-expiration loses that. If scanning proves
painful, the follow-up is a compare mode over a chosen front leg — "this strike against every
back expiration" — which beats today's arbitrary pre-paired grid anyway. Do not rebuild the
inner join to get scanning back.

What moves:
- `useChainModel` stops joining, starts grouping by expiration.
- `ChainTableRow` becomes a **leg**, not a calendar.
- Calendar math moves to surface 2, computed for the selected pair only.
- `chain-math.ts` and `chain-risk-reversal.ts` survive **untouched**: pure functions over legs.
  `netCalendarGreeks(front, back)` already returns the full Δ/Γ/Θ/vega record the pair surface
  needs — back minus front, long the back and short the front.

Do the `root` fix FIRST so the reshape is not built on colliding rows.

### Column glossary — keep this wording, the user asked to be taught it

Worked on strike 6675P, spot 7411.98, front Aug 21 (25d) IV 25.11%, back Sep 18 (53d) IV 22.85%.

- **V-Skew** — this strike's IV minus the ATM strike's IV, same expiry AND same wing. Showed
  +9.45 at 6675P: you are paid 9.45 extra vol points for selling that far below spot. This is
  the put skew. **It picks the STRIKE.**
- **H-Skew** — front IV − back IV at one strike: `25.11 − 22.85 = +2.26`. Positive = the front
  month is the rich one, and you sell the front, so positive is the setup. Rough read only:
  25.11% covers 25 days and 22.85% covers 53 days, so the two are not directly comparable.
- **Fwd IV** — the vol the market prices for ONLY the stretch between the two expiries
  (Aug 21 → Sep 18). `√((tb·σb² − tf·σf²)/(tb − tf))`. Not an average — it is what remains in
  the back leg once the front leg's window is stripped out. Makes the comparison apples to
  apples.
- **EDGE** — front IV − forward IV. The real number: you sell the front at its IV, and what you
  keep afterward is worth the forward vol. Positive = selling the front for more than the market
  says the following window is worth. **EDGE is H-Skew done properly; when they disagree, trust
  EDGE. It picks the EXPIRY PAIR.**
- **Inverted guard** — when the back leg is cheaper in variance terms than the front, forward
  vol has no real solution. `computeFwdIv` returns `inverted` and EDGE renders `—`. An inverted
  structure has no calendar edge; the dash is the honest answer, not a missing value.

The two axes together: **V-Skew picks the strike, EDGE picks the expiry pair** — the same split
as the skew research (vertical skew chooses where, term structure chooses when).

---

## Assets worth reusing

| Thing | Where |
|---|---|
| 25Δ RR, `IV(25Δ put) − IV(25Δ call)`, null when unbracketable | `core/analytics/domain/risk-reversal.ts` → `interpolateRiskReversal` |
| Chain-row adapter for the above (computes delta via `bsmGreeks`) | `apps/web/src/lib/chain-risk-reversal.ts` |
| Forward vol, `inverted` guard | `core/picker/domain/fwd-iv.ts` → `computeFwdIv` |
| Per-strike column math, 8 exports, 36 tests | `apps/web/src/lib/chain-math.ts` |
| ATM reference IV, expiry + wing enforced **by signature** | `chain-math.atmIv` — never hand-roll this lookup |
| Fill haircut (ORATS 0.66 width) | `core/picker/domain/candidate-selection.ts` → `haircutFill` |
| Per-expiry carry (r, q) with flat fallback | `apps/web/src/lib/resolve-carry.ts` |
| Expandable table pattern | `Journal.tsx:383-411` — `DataTable` + `renderRowDetail` + `expandedId` |
| One-tree responsive | `-mx-2 overflow-x-auto px-2` wrapper + `min-w-[Npx]` table. No `useIsDesktop`. |

---

## Laws learned this round — do not relearn them

1. **A widened read turns every key-based lookup into a latent wrong-wing/wrong-root match.**
   Widening the chain to both wings produced three separate bugs: the exit advisor's
   `toRollCandidates` priced a call as a put calendar's replacement front (102.04); the table's
   row key collided the two wings; and `vSkewVsAtm` crossed the skew curves. Grep every consumer
   before widening a shared read — the picker was NOT the only one.
2. **The dangerous defects are the ones that cannot null themselves.** Every other degraded
   input in this system nulls its own column and shows an em dash. A cross-wing or cross-root
   pair has every input present and finite, so it renders a clean plausible wrong number. Those
   get enforced by **signature**, never by doc comment. `atmIv` is the model.
3. **A test fixture whose variants share a value is vacuous.** The wing test only has teeth
   because the call and put ATM IVs differ. Unit 11 proved the pre-existing "same expiry" test
   did not catch a crossed wing by breaking the lookup and watching it stay green.
4. **`apps/web` typecheck baseline is 9 — and only after `bun run typecheck` warms the project
   references.** Cold, it reports 28 (TS6305/TS2307 from unbuilt `packages/*` dist).
5. **apps/web does NOT use msw.** Mock the RPC layer:
   `vi.hoisted` + `vi.mock("../lib/rpc.ts", () => ({ setAuthToken: vi.fn(), apiFetch: mockApiFetch }))`.
6. **The `code-review` skill is `disable-model-invocation`** in worker environments. Substitute
   a reviewer subagent — but note it read **stale file state** in a worktree and reported 4 of 5
   findings as "missing" when present. Treat its output as leads, not verdicts.
7. **Peer completion reports are not proof.** One unit reported `main.ts` wiring as committed
   when it was uncommitted working-tree state; the next unit caught it only because its own
   typecheck kept failing. Check the branch.
8. **`bsmIv` can be the literal string `"NaN"`**, not just null. Passing it through yields a JS
   `NaN` that fails Zod at the route seam and 500s the endpoint. Both map to null; a genuine
   `"0"` must survive as `0`.
9. **Array reads return `200 []`, never 404** (COT pattern). Mount routes in the *chained*
   `apiRouter` builder — sequential `.route()` breaks Hono RPC type inference silently.
10. **Parallel worktree PRs cost real integration time.** Unit 11 ran against four absent
    siblings and wrote stubs; reconciling them surfaced five wrong assumptions plus a sign
    disagreement. The units talking to each other across seams is what caught the worst bugs —
    none were found by anyone reviewing their own unit.

---

## Also open, unrelated to this work

`/api/analytics/gex` returns null call/put walls and ~0 net gamma; Γ flip 6812 against spot
7412 looks stale. It feeds `resolveCarry`, so every greek on the chain table is currently priced
against the flat 4.5% / 1.3% defaults instead of per-expiry implied carry. Worth its own
investigation.

Two stale comments were fixed in #17 (`rules.ts` weights, `candidate-selection.ts` back-gap).
A third was found and fixed in passing (`picker-rules.md` said `eventAdjustment` w10, actual 5).

`screens/HeldPositionsPanel.tsx:69` still carries a byte-identical private copy of
`formatAsOf`; the shared one now lives at `apps/web/src/lib/format-as-of.ts`. One-line dedupe,
deliberately held out of #18 to keep that diff clean.

---

## OPEN AT HANDOFF — sorting appears stuck (2026-07-26 22:46)

**Symptom (user):** "sorting gets stuck on one thing and then just that, and the rows below
sort" — and separately, "the strikes with missing data in any column are at the top and don't
sort at all".

**Mechanism, confirmed in code:** `DataTable.tsx:106` keys each row
`<React.Fragment key={testId}>` where `testId = chain-row-${rowKey(row)}`. `rowKey` was
`${contractType}-${strike}`. SPX/SPXW share both → 242 duplicate React keys (measured live).
React reconciles by key and will not move a node whose key it believes is already positioned,
so duplicated rows freeze while uniquely-keyed rows reorder around them. The frozen rows are
the null-IV ones because the unsolved twin is the duplicate.

**Fix merged in PR #23:** `rowKey` is now `${root}-${contractType}-${strike}`.

**NOT VERIFIED.** Could not confirm the Vercel deploy completed before running out of context.
Three browser checks found the Analyzer rendering but zero rows matching
`tr[data-testid^="chain-row-"]` — inconclusive.

**First thing to do next session:**
1. Confirm the deploy is live: a row testid should read `chain-row-SPXW-P-7400000` (three
   segments). If it still reads `chain-row-P-7400000`, the build has not shipped.
2. Re-count duplicates on the live page. Expect 0.
3. Click each column header and confirm order changes and nulls land last.

**If duplicates are 0 and sorting is STILL wrong, the diagnosis above was wrong.** Next suspect
is the sort path itself: `ChainTable`'s `compare` (nulls last both directions — has tests) and
`activeCol.value` accessors. Check whether any column's `value` reads a different field than
its `render`. Do not assume; instrument it in the browser and read the actual before/after
order for one column.

Also merged in #23 and unrelated to the above: metric columns now open DESCENDING on first
click (strike stays ascending). That was a real UX defect but was NOT the stuck-sort bug —
worth keeping separate when reasoning about what fixed what.
