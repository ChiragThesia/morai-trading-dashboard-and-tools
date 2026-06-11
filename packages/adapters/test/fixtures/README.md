# CBOE Delayed-Quotes Test Fixtures

## Capture Metadata

- **Captured:** 2026-06-11 (during Phase 2 Wave 0 execution)
- **SPX endpoint:** `https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json`
- **SPXW endpoint:** `https://cdn.cboe.com/api/global/delayed_quotes/options/_SPXW.json`
- **Auth:** None (public CDN, no API key)
- **User-Agent sent:** `Morai-TradingDashboard/1.0`

## SPXW Endpoint Finding (resolves RESEARCH Open Question #1)

**Finding: SPXW contracts live inside `_SPX.json`. A separate `_SPXW.json` endpoint does not exist.**

`_SPXW.json` returns HTTP 403 (S3 AccessDenied), not 404. The error body confirms it is an
S3 access policy rejection, not a missing resource. Querying the live `_SPX.json` payload
confirms it contains both SPX-root and SPXW-root contracts:

- Total contracts in `_SPX.json` on capture date: 31,242
- SPX-root contracts (`option` starts with `"SPX"` but not `"SPXW"`): 10,454
- SPXW-root contracts (`option` starts with `"SPXW"`): 20,788

**Implementation implication for Plan 04:** Fetch only `_SPX.json`. Distinguish SPX from SPXW
by OSI root (last chars before the 15-char suffix — `"SPX"` = 3 chars, `"SPXW"` = 4 chars).
Both roots must be stored per decision D-11. Do NOT attempt to fetch `_SPXW.json`.

## Timestamp Format (RESEARCH Pitfall 1)

Observed `timestamp` value: `"2026-06-11 15:13:25"`

Format: `YYYY-MM-DD HH:MM:SS` with NO timezone offset suffix — this is Eastern Time (ET)
local time. Before storing as `leg_observations.time` (timestamptz), convert to UTC by
appending the ET offset or treating it as `America/New_York`.

Failure mode: storing `"2026-06-11 15:13:25"` as-is makes Postgres interpret it as UTC,
placing the observation 4-5 hours in the future relative to the actual fetch time.

## Fixture Files

### `cboe-spx.fixture.json`

Source: trimmed from live `_SPX.json` capture. Original payload: ~13.8 MB / 31,242 contracts.

Trimmed to 31 contracts selected for test coverage:
- 4 expiry dates: 2026-06-11 (today, near-expiry), 2026-07-09 (~28 DTE), 2026-09-18 (~99 DTE),
  2027-12-17 (~18 months, well above the 90-DTE filter cutoff)
- Strikes include contracts inside the ±10% spot band (spot ≈ 7274) AND outside the band:
  - Below band: 6525 strikes (< 6546.73 lower bound)
  - Above band: 8025 strikes (> 8001.55 upper bound)
  - Near-money: 7200–7300 range
- Contains both SPX-root and SPXW-root contracts

### `cboe-spxw.fixture.json`

Source: SPXW-root contracts extracted from the same `_SPX.json` live capture.
`_SPXW.json` is inaccessible (HTTP 403). This fixture represents the SPXW subset that
the CBOE adapter will filter from `_SPX.json` by OSI root.

Trimmed to 31 SPXW-root contracts:
- 4 expiry dates: 2026-06-11, 2026-07-09, 2026-09-18, 2027-03-31
- Mix of strikes inside and outside the ±10% band
- All entries have root `"SPXW"`

## Schema Observed (matches RESEARCH Pattern 1)

```
{
  "timestamp": "<YYYY-MM-DD HH:MM:SS>  (ET local, no offset — see Timestamp Format above)",
  "data": {
    "current_price": <number>,
    "close": <number>,
    "prev_day_close": <number>,
    "options": [
      {
        "option": "<OSI string>",  // e.g. "SPX260618C00200000" or "SPXW260611C07275000"
        "bid": <number>,
        "ask": <number>,
        "iv": <number>,
        "open_interest": <number>,
        "volume": <number>,
        "delta": <number>,
        "gamma": <number>,
        "vega": <number>,
        "theta": <number>
      }
    ]
  }
}
```

OSI symbol format (compact, no root padding):
- Last 8 chars: strike × 1000, zero-padded (e.g. `07275000` = strike 7275.000)
- Char at position -9: option type `C` or `P`
- Chars at positions -15 to -10: expiry as `YYMMDD`
- Remaining prefix: root (`"SPX"` = 3 chars, `"SPXW"` = 4 chars)
