# Analyzer chain table — UAT findings, 2026-07-26 22:5x CDT

Live walk on morai.wtf, desktop 1440×900. Market closed; chain cohort observed
`2026-07-27T02:55:11Z`, spot 7411.98, 11,711 rows served.

## Verdict

The rework is **live and structurally correct** — no verdict, no score, no ranked rail, one
tree, 13 data columns, expiry-pair selects, Puts/Calls toggle, expandable rows. But the table
is **not trustworthy yet**: one root-cause defect makes most cells dash and duplicates 242
rows. Do not trade off it until fixed.

## P0 — the chain contract is missing `root`, so SPX and SPXW collide

`ChainQuoteForPicker` carries `root?: "SPX" | "SPXW"` (ports.ts). **The frozen wire contract I
specified dropped it.** That was my error, not a worker's.

The repo's `DISTINCT ON (contract)` correctly returns both roots — they are different OCC
symbols — but on the wire they are indistinguishable. Live proof, strike 6675000:

```
2026-08-21  P  dte 25  bsmIv 0.2510849  bid 10.1  ask 11.1  OI 3461   cboe
2026-08-21  P  dte 25  bsmIv null       bid 10.7  ask 11.2  OI 264    cboe
```

Same `(strike, expiration, contractType)`. One solved, one not.

Three consequences, all observed:

1. **242 duplicate row IDs.** `rowKey` is `${contractType}-${strike}`, which Unit 8 correctly
   made wing-aware — but not root-aware. Two React rows share one key and one expansion slot.
2. **Most derived columns dash.** The join's `backByStrike` map keeps whichever row it saw
   last; when that is the `bsmIv: null` twin, every IV-dependent column nulls. The Sep-18 back
   leg *does* have a solved IV (0.2285) on one root and null on the other.
3. **One row showed back IV 68.89% against front 24.69%** → H-Skew −44.21. That is an SPXW
   quote measured against an SPX quote. A cross-root pair is the same bug class as the
   cross-wing pair we engineered against, and it renders a plausible number, not a gap.

**Fix:** add `root: z.enum(["SPX","SPXW"])` to `chainRow`, carry it through `getChain`'s
mapping, include it in `rowKey`, and add it to the join key in `useChainModel` alongside
`contractType`. Same shape as the wing fix — make it part of row identity so a mixed-root pair
is unrepresentable.

## P1 — the default expiry pair is an expired front leg

Front defaults to `2026-07-26 · -1d`, back to `2026-07-27 · 0d`. `useChainModel` takes
`expirations[0]` and `[1]` sorted by DTE ascending, and the cohort still carries yesterday's
and today's expiries. A negative-DTE front means `legGreeks` nulls (dte ≤ 0) and the whole
table opens blank — the first thing you see is a wall of em dashes.

**Fix:** default to the first two expiries with `dte >= 1`, or filter `dte < 0` out of the
selector list entirely.

## P2 — the Edge legend states the formula backwards

Legend: `Edge = forward IV − front IV`. Code: `ivFront - fwd.fwdIv`.

Identical class to the H-Skew legend I corrected during the merge, and I missed this one.
Positive Edge means the front is rich relative to the forward — the setup you want. Fix the
caption, not the math.

## Not verified

- **Mobile 390px** — not walked. Desktop only.
- **Row expansion** — not clicked, because with duplicate keys the result would not have meant
  anything.
- **25Δ RR** — both header cells showed `—`. Cannot tell yet whether that is the narrow-ladder
  null-honesty path or a defect; the root collision has to be fixed before this reads clean.
- **Live RTH behaviour** — market closed.

## Unrelated, still open

`/api/analytics/gex` returns null call/put walls and ~0 net gamma; Γ flip 6812 against spot
7412 looks stale. It also feeds `resolveCarry`, so every greek on this table is currently
priced against the flat 4.5% / 1.3% defaults rather than per-expiry implied carry.
