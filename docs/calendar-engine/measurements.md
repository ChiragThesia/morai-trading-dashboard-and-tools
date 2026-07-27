# Measurements — the production chain, 2026-07-27

Every number in [spec.mdx](./spec.mdx) §3 and Appendix A comes from here. All queries are
read-only `SELECT`s against the production database, run on cycle `2026-07-27`, spot
`7401.89`.

The point of this file is that the design rests on measurements a reader can reproduce,
not on assertions. The earlier audit's production figures were traced to a handoff
document rather than to a query; these are the queries.

Run any of them with:

```bash
bun run --env-file=.env <script.ts>
```

---

## 1. History depth — the ceiling on every percentile

```sql
select min(time)::date lo, max(time)::date hi, count(*) n,
       count(distinct time::date) days
from leg_observations;
```

```
lo=2026-06-12  hi=2026-07-27  n=14,476,691  days=30
```

Weekdays only: **24**. Per-day cycle counts run 92–139 (`*/30` cadence), 350k–870k rows
per day.

```sql
-- analytics tables
select count(*) n, count(distinct snapshot_time::date) days,
       min(snapshot_time)::date lo, max(snapshot_time)::date hi
from risk_reversal_observations;
```

| Table | Rows | Days | Range |
|---|---|---|---|
| `leg_observations` | 14,476,691 | **30** | 2026-06-12 → 07-27 |
| `skew_observations` | 610,497 | 23 | 2026-06-18 → 07-27 |
| `risk_reversal_observations` | 8,327 (4,819 ranked) | 23 | 2026-06-18 → 07-27 |
| `gex_snapshots` | 917 | 25 | 2026-06-23 → 07-27 |
| `term_structure_observations` | 291 | 17 | 2026-07-01 → 07-27 |

`term_structure_observations` columns are `(snapshot_time, calendar_id, value, front_iv,
back_iv)` — **keyed by calendar id**, so it only ever covers expiry pairs already held as
positions. It is not a general term-structure history.

```sql
select series_id, count(*) n, min(date) lo, max(date) hi
from macro_observations group by 1 order by 1;
```

`VIXCLS`: **17 rows**, 2026-06-30 → 07-23. `VIX9D` 13, `VXVCLS` 13, `VVIX` 19.

> A 12-month IV percentile needs ~252 observations. A VIX 80th-percentile kill switch
> needs the same. We have 17 to 30. Every percentile gate in the doctrine is unbuildable
> today.

There is no `daily_spot_closes` table; `readDailySpotCloses` is `DISTINCT ON (time::date)`
over the 24/7 `*/30` feed, i.e. the ~23:30Z sample in UTC buckets — not the 16:00 ET
print. `RV20` inherits that bias.

---

## 2. IV coverage on the newest cycle

```sql
select count(*) n, count(bsm_iv) with_iv, count(distinct contract) contracts
from leg_observations
where time = (select max(time) from leg_observations);
```

```
n=3,558   with_iv=3,200   contracts=3,558
```

~10% of legs on any cycle have no solved IV. Those legs have no skew, no edge and no
greeks — they do not have zero ones.

---

## 3. The candidate space

Front 15–60 DTE, gap ≥ 15, back ≤ 90, puts, same root, `bsm_iv` solved and not the
string `'NaN'` on both legs:

```sql
with newest as (select max(time) t from leg_observations),
 legs as (
  select c.root, c.expiration, c.strike,
         (c.expiration - (select t::date from newest)) dte,
         lo.bsm_iv::float8 iv, lo.underlying_price::float8 spot,
         lo.bid::float8 bid, lo.ask::float8 ask, lo.open_interest oi
  from leg_observations lo
  join contracts c on c.occ_symbol = lo.contract
  where lo.time = (select t from newest)
    and c.contract_type = 'P'
    and lo.bsm_iv is not null and lo.bsm_iv::text <> 'NaN')
select count(*) candidates
from legs f
join legs b on b.root = f.root and b.strike = f.strike and b.dte - f.dte >= 15
where f.dte between 15 and 60 and b.dte <= 90;
```

```
candidates                          = 2,454
distinct (root, front, back) pairs  =   124
both legs two-sided (bid > 0)       = 2,454  (100%)
```

By the trader's working windows:

| Front window | Candidates |
|---|---|
| 15–30 | 1,883 |
| 21–45 | 1,482 |
| 21–60 | 1,608 |
| 30–60 | 640 |

Expiry pair counts under the raw gates, before the strike join:

| Constraint | Pairs |
|---|---|
| front ≥ 15, gap ≥ 15, **same root** | 139 |
| front ≥ 15, gap ≥ 15, any root | 273 |
| …that actually share strikes | 125 |

Full enumeration is ~2,500 candidates. There is no sampling problem.

---

## 4. Forward Factor — the gate that never fires

For every candidate: `σ_fwd = sqrt((T_b·σ_b² − T_f·σ_f²)/(T_b − T_f))`,
`FF = σ_f/σ_fwd − 1`, `cushion = σ_b − σ_fwd`.

```
candidates = 2,465        inverted (σ_fwd undefined) = 0

FF:  min = −16.39%   p10 = −7.12%   p50 = +0.36%   p90 = +7.06%   max = +14.40%
     FF ≥ 16%  →      0 / 2,465
     FF >  0   →  1,292 / 2,465   (52%, local backwardation)

cushion (vol points):  p10 = −0.49   p50 = +0.02   p90 = +0.47
```

Against the doctrine: entry gate **≥ 16–20%**, KRE cushion **17 vol points**.

### 4.1 The skew leak

Top candidates by per-strike FF:

| Root | Strike | Front/Back | IV f | IV b | σ_fwd | FF | \|K − S\| |
|---|---|---|---|---|---|---|---|
| SPXW | 7100 | 31/46d | 20.01% | 19.22% | 17.49% | **14.4%** | **302** |
| SPX | 7300 | 16/53d | 18.17% | 16.67% | 15.98% | 13.7% | 102 |
| SPXW | 7125 | 31/46d | 19.64% | 18.91% | 17.32% | 13.4% | **277** |
| SPXW | 7150 | 31/46d | 19.31% | 18.61% | 17.09% | 13.0% | **252** |

Best near-ATM (|K − S| ≤ 25):

| Root | Strike | Front/Back | IV f | IV b | σ_fwd | FF |
|---|---|---|---|---|---|---|
| SPXW | 7380 | 18/35d | 16.20% | 15.65% | 15.04% | **7.7%** |
| SPX | 7400 | 16/53d | 16.23% | 15.45% | 15.10% | 7.5% |

The top of the unadjusted ranking sits 250–300 points from spot at roughly double the
near-ATM reading. That gap is SPX put skew — the front smile is steeper than the back —
not term structure. **This is why the scored term-structure signal is computed from each
cohort's 50Δ IVs, not from the traded strike's IVs.**

---

## 5. Liquidity — the incumbent gate is wrong for SPX

1,218 SPX puts, 15–90 DTE, on the newest cycle:

```
spread / mid:  p10 = 0.4%   p50 = 0.6%   p90 = 1.0%   max = 7.8%

open interest: p10 = 0   p25 = 4   p50 = 39   p75 = 153   p90 = 532   max = 50,572
               OI = 0    :   191 / 1,218
               OI < 100  :   829 / 1,218   (68%)

near-ATM (|K − S| ≤ 50), n = 380:   OI p50 = 39 → 58   volume p50 = 1
near-ATM SPXW failing OI ≥ 100  :   175 / 255   (69%)
```

Applying `isLiquidQuote` (`rules.ts:103` — `spread/mid ≤ 10%` **and** `OI ≥ 100`) to the
2,454 candidates:

```
both legs two-sided        = 2,454
+ OI ≥ 100 both legs       =   450   (18%)
+ spread ≤ 10% of mid      =   450   (removes nothing further)
```

Two conclusions.

1. **The spread gate is inert.** The whole distribution is inside 1% of mid, so it cannot
   discriminate. A cost or liquidity *score* term would be near-constant — noise with a
   weight attached. PA's 12% / 22% / 58% figures are retail single-name weeklies.
2. **The OI gate is actively harmful.** It removes 82% of candidates and 69% of the
   near-ATM SPXW ladder — the exact strikes the doctrine says to trade. Low open interest
   on a fresh SPXW weekly strike is not illiquidity.

`volume` is stored (`schema.ts:141`, `notNull`) and populated (1,822 of 3,564 legs
non-zero, max 28,188) but is equally thin near ATM at these tenors. Neither open interest
nor volume is a valid liquidity proxy for SPX weeklies at 15–90 DTE. The two-sided quote
is.

---

## 6. Expiry ladder available on the newest cycle

Puts, DTE ≥ 15, showing the strike count per `(root, expiration)`:

| DTE | Root | Expiration | Strikes |
|---|---|---|---|
| 15 | SPXW | 2026-08-11 | 33 |
| 16 | SPXW / SPX | 2026-08-12 | 50 / 14 |
| 21 | SPXW / SPX | 2026-08-17 | 46 / 5 |
| 25 | SPXW / SPX | 2026-08-21 | 50 / 50 |
| 31 | SPXW / SPX | 2026-08-27 | 47 / 15 |
| 36 | SPXW / SPX | 2026-09-01 | 40 / 40 |
| 46 | SPXW | 2026-09-11 | 50 |
| 53 | SPXW / SPX | 2026-09-18 | 50 / 50 |

Strike counts cap at 50 — the sidecar requests `strikeCount = 50`
(`apps/sidecar/chain_proxy.py:53`), and ingest bounds are 90 DTE
(`apps/worker/src/config.ts:25`) and roughly ±10% of spot. Nothing outside those bounds
exists to rank.

---

## 7. The root / expiration ingest defect

```sql
select
  count(*) total,
  count(*) filter (where substring(occ_symbol,1,4) = 'SPXW' and root = 'SPXW') occ_w_root_w,
  count(*) filter (where substring(occ_symbol,1,4) <> 'SPXW' and root = 'SPX') occ_x_root_x,
  count(*) filter (where substring(occ_symbol,1,4) = 'SPXW' and root = 'SPX') mismatch
from contracts;
```

```
total = 26,109
OCC=SPXW, root=SPXW  = 22,197   clean
OCC=SPX,  root=SPX   =  2,722   clean
OCC=SPXW, root=SPX   =  1,190   WRONG
expiration off by −1 =  1,290
root mismatch only   =      0   ← proves one writer, not two bugs
day-delta values     =  only 0 and −1, never anything else
```

Example: `"SPXW  260828C08300000"` stores `root=SPX`, `expiration=2026-08-27`.

`root_only = 0` is the load-bearing part: every root mismatch also carries the date
mismatch, so this is a single ingest defect, not two. The shape — root taken as the first
three characters, plus a timezone-shifted date — points at
`fetchChain.ts:143` (`root: chain.root`, the requested label rather than the OCC symbol)
and `:135-138` (local date getters on a UTC-midnight date). Both verified open at HEAD
`6622dec`.

Those two columns feed `computeT`, which picks AM 09:30 ET against PM 16:00 ET off
`root` — so those legs were solved with `T` short by a full day and their `bsm_iv` is
biased high. See [spec.mdx](./spec.mdx) §9.

---

## 8. Carry, verified after the guard landed

Cycle `2026-07-27T12:30:00Z`, the first to run the horizon-floor and `[0, 0.10]` clamp on
the parity-implied dividend yield:

```
32 carry entries   0 negative   0 above 0.10   q range 0.002796 … 0.016142
```

Pre-fix the same payload carried `q = 0.2984` at 0DTE and two negative readings
(−0.1201, −0.0857). GEX unaffected: flip 7453 against spot 7412, walls 7500 / 7000.

Two traps worth recording, because both nearly produced a false pass:

1. Railway reported the deploy SUCCESS while the 12:00Z cycle **still ran the old code**.
   Verify against the first cycle that actually started after the new instance came up.
2. Calendar-day DTE is not the guard's `T`. The guard measures to the settlement instant,
   so an expiry that looks like 6 days is 7.31 and correctly passes.
