# ThinkScript Learnings

**Source**: `calendar-trade-dashboard/thinkscript/` (deleted 2026-05-06)
**Scope**: 5 production studies for SPX calendar decisions, GEX zones, AVWAP reversion. Patterns preserved for future TOS dev.

---

## Script Inventory

### 1. CalendarVerdict_Upper.ts
**Purpose**: Real-time ENTER / HOLD / EXIT / AVOID label with reason codes.
**Chart**: `$SPX`, any timeframe (1m–1D).

**Inputs**: `entryDebit`, `currentMark`, `strike`, `frontExpiryYYYYMMDD`, `backExpiryYYYYMMDD`, `profitTargetPct`, `stopLossPct`, `gammaCliffDTE`, `eventWarnDays`, `showSubLabels`.

**Patterns**:
- Multi-symbol vol fetch with daily aggregation:
  ```
  def vix    = close("VIX",   AggregationPeriod.DAY);
  def vix3m  = close("VIX3M", AggregationPeriod.DAY);
  def vvix   = close("VVIX",  AggregationPeriod.DAY);
  def ratio  = if vix3m > 0 then vix / vix3m else 1.0;
  ```
  Daily fetch stable across chart timeframe.

- DTE: `def frontDTE = -DaysFromDate(frontExpiryYYYYMMDD);`

- Verdict tree: verdict ∈ {1,2,3,4} = ENTER/HOLD/EXIT/AVOID; reason ∈ {1..10} = OK/WAIT/TGT/STP/GAMMA/BWD/DRIFT/EVT/VOL/CAUTION.

- Hardcoded event calendar (FOMC/CPI/NFP/PCE/OpEx as YYYYMMDD ints). Min-of-all helper finds nearest Tier-1.

### 2. CalendarPanel_Lower.ts
**Purpose**: Diagnostic — reveals VIX symbol resolution failure (returns 0).
**Chart**: `$SPX`, any timeframe.

**Findings**:
- `close("VIX")` returns 0 in scripts despite working in chart symbol box. Tested 9 approaches: different `AggregationPeriod` (DAY/WEEK/HOUR/MIN), offset lookback `[1]`/`[2]`, `HighestAll()`, `Highest(..., 1000)`. None resolved.
- `close("VVIX")` works reliably.

**Lesson**: VIX is a derived/special index in TOS thinkScript context. Workaround: use VVIX as vol regime proxy or accept manual VIX input.

### 3. AnchoredVWAP_Bands.ts
**Purpose**: AVWAP with ±1σ/±2σ bands for reversion zones.
**Chart**: `/ES`, SPY, or any symbol with volume. **NOT $SPX** (no volume).

**Inputs**: `anchorDate` (YYYYMMDD), `anchorTime` (HHMM), `End_Anchor`, `anchorEnd`, `deviationNum1`, `deviationNum2`.

**Patterns**:
- Conditional anchor logic:
  ```
  def postAnchorDate = GetYYYYMMDD() >= anchorDate;
  def postAnchorTime = SecondsFromTime(anchorTime) >= 0;
  def isAnchored = postAnchorDate and postAnchorTime;
  def withinEnd = !End_Anchor or GetYYYYMMDD() <= anchorEnd;
  ```

- TotalSum() stateless rolling:
  ```
  def volSum  = TotalSum(if isAnchored and withinEnd then volume else 0);
  def vol2Sum = TotalSum(if isAnchored and withinEnd then Sqr(HLC3) * volume else 0);
  plot AVWAP = TotalSum(...HLC3 * volume...) / volSum;
  def sd = Sqrt(vol2Sum / volSum - Sqr(AVWAP));  // biased variance
  ```
  HLC3 = (High + Low + Close) / 3.

- NaN carry-forward for bands:
  ```
  plot UpperBand1 = if IsNaN(AVWAP) then Double.NaN else AVWAP + deviationNum1 * sd;
  ```

- Curve styling: `SetStyle(Curve.SHORT_DASH)` (1σ), `LONG_DASH` (2σ).

### 4. GEX_Levels_Manual.ts
**Purpose**: Plot Call Wall / Put Wall / HVL (Gamma Flip) / JPM Collar as horizontal lines.
**Chart**: `$SPX`, SPY (input ÷ 10), or `/ES`.

**Inputs**: `callWall`, `putWall`, `hvlGammaFlip`, `jpmCollarCall`, `jpmCollarPut1`, `jpmCollarPut2`, `maxRangePct` (hide far levels, default 4%).

**Patterns**:
- Distance gate for clutter reduction:
  ```
  def maxD = close * maxRangePct / 100;
  def cwShow = AbsValue(callWall - close) <= maxD;
  plot CallWall = if cwShow then callWall else Double.NaN;
  ```

- `PaintingStrategy.HORIZONTAL` — infinite horizontal lines.

- Custom RGB:
  - Call Wall: `(180, 50, 50)` deep red — resistance
  - Put Wall: `(40, 140, 50)` deep green — support
  - HVL: `(255, 200, 0)` yellow — vol regime line
  - JPM levels: magenta + shades

- 2px Call/Put walls solid, 3px HVL dashed, 1px JPM dashed. `HideBubble()` for clean chart.

**Workflow**: pull MenthorQ daily, paste levels, update. TOS cannot compute GEX (no OI API).

---

## ThinkScript Gotchas (Cross-Script)

### 1. Symbol Resolution
- `close("VIX")` returns 0 in scripts → use VVIX or manual input
- `close("SYMBOL", AggregationPeriod.X)` — always specify period
- `$SPX` has no volume → AVWAP/volume studies fail. Route to `/ES` or SPY

### 2. Identifier Collisions (Case-Insensitive)
- `YH` and `yh` collide → use descriptive names (`yrHigh`, `quarterHigh`)
- Avoid single-letter / ambiguous variable names

### 3. "Too Early to Access" Errors
- Caused by `[1]`/`[2]` lookback on first bar
- **Fix**: use `rec` for self-referencing:
  ```
  rec vixRec = if IsNaN(close("VIX")) or close("VIX") == 0
               then vixRec[1]
               else close("VIX");
  ```

### 4. NaN Carry-Forward Pattern
```
if IsNaN(value) or value == 0 then priorValue[1] else value
```
Fills gaps. Alternative: return `Double.NaN` to hide plot.

### 5. Chart Squishing from Extreme Values
One plot with wild range → chart auto-scales → others unreadable.
**Fix**: normalize 0–100 OR distance gate via `maxRangePct`.

### 6. AggregationPeriod.DAY for Multi-TF Stability
Fetch vol data daily even on 1m chart:
```
def vix = close("VIX", AggregationPeriod.DAY);
```
Without it, intraday `close("VIX")` updates per bar = noisy.

### 7. TotalSum() for Rolling Calcs
- Cumulates from chart start (or anchor) — no explicit window
- Stateless — no `rec` lookback needed
- Cannot reset mid-stream → gate via conditional (`if isAnchored then ... else 0`)

### 8. Date/Time Functions
- `GetYYYYMMDD()` — current bar date as int YYYYMMDD
- `DaysFromDate(YYYYMMDD)` — negative days; negate for forward count
- `SecondsFromTime(HHMM)` — seconds from midnight; `>= 0` for intraday-start gate

### 9. Hardcoded Event Calendars
TOS thinkScript cannot read MarketWatch calendar. Define dates as YYYYMMDD constants at top; Min-of-all helper for nearest event. **Quarterly manual update**.

### 10. Higher Timeframe Compatibility (4h, 1d)
- Vol data stable via `AggregationPeriod.DAY`
- AVWAP anchor `0930` works intraday (skips overnight), harmless on daily
- GEX levels timeless (price-indexed horizontal)

### 11. rec vs def
- `def` — one-time per bar, no prior state
- `rec` — self-referencing, holds history via `[1]`/`[2]`
- Choice: `rec` only for carry-forward needs; else `def` (cleaner, lower compute)

### 12. Why MultiTF_AutoSR Was Abandoned
Original attempted native multi-TF support channels on 4h/1d aggregations. Issues: slow recompute, ambiguous period semantics, duplicated TOS native. Replaced with native `LinearRegressionChannel` / `StandardDevChannel` or manual anchor (AVWAP approach).

### 13. Top Labels Showing 0/NaN
Plots update before all data ready → label prints bar-0 NaN.
**Fix**: gate via flag:
```
AddLabel(yes, "AVWAP " + AsText(AVWAP, "0.00"),
         if IsNaN(AVWAP) then Color.DARK_GRAY else Color.LIGHT_GRAY);
```

---

## Design Decisions

1. **Manual GEX over computed**: thinkScript lacks options chain API. User pastes from MenthorQ daily. 5-min workflow beats nonexistent automation.
2. **VVIX over VIX**: VIX broken in script context. Verdict logic uses VVIX + ratio (VIX3M fallback) as proxy.
3. **AVWAP on /ES, not $SPX**: SPX no volume. Route to /ES or SPY.
4. **Hardcoded events**: No TOS event API. Quarterly update << brittle external feeds.
5. **Distance gating (maxRangePct)**: Far-OTM GEX walls clutter chart. Focus on relevant zones.
6. **Daily vol aggregation**: Stable verdict across intraday TF. Prevents 1m noise flood.

---

## Maintenance

| Item | Frequency | Source |
|------|-----------|--------|
| Event calendar (verdict scripts) | Quarterly | FOMC/CPI/NFP/PCE/OpEx schedules |
| GEX input levels | Daily morning | MenthorQ / VannaCharm |
| Position inputs (CalendarVerdict) | Per-trade | Manual entry; TOS no position API |

---

## Future: Migrate to Plugin

Plugin `trade-advisor` already auto-computes GEX from Schwab chain (`compute_gex_levels` tool — free, no MenthorQ). thinkScript GEX_Levels_Manual becomes input for daily levels pulled from plugin.

Verdict logic better served by plugin's `advise` skill (live Greeks via Schwab vs manual input). thinkScript verdict label is fallback for at-chart users.
