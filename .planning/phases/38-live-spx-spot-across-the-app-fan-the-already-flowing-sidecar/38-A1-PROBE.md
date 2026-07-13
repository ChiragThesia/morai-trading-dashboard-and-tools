# Phase 38 — A1 Checkpoint Evidence (VIX-family symbol probe)

**Run:** 2026-07-13 ~16:55Z, live RTH, user-approved one-off probe inside the prod
sidecar container (railway ssh; script deleted after run). Probe used the sidecar's
own market client (`client_from_access_functions`, `token_store.make_token_callbacks`)
— the exact construction `start_indices_poll` will use.

## Result: CONFIRMED — all symbols valid via `Client.get_quotes`

```
HTTP 200
$VIX   | type: INDEX | lastPrice: 17.17  | closePrice: 15.03
$VVIX  | type: INDEX | lastPrice: 94.59  | closePrice: 87.28
$VIX9D | type: INDEX | lastPrice: 15.1   | closePrice: 11.15
$VIX3M | type: INDEX | lastPrice: 19.66  | closePrice: 18.57
$SPX   | type: INDEX | lastPrice: 7518.0 | closePrice: 7575.39
```

## Parser facts (bind on 38-02 Task 2)

- Response keyed by the literal `$`-prefixed symbol; per-symbol object has
  `assetMainType: "INDEX"` and a `quote` object.
- **Use `quote.lastPrice`** (as RESEARCH recommended). `closePrice` = prior EOD.
- **`quote.quoteTime` was `None`** in this response shape — do NOT depend on it.
  Stamp the event `ts` from sidecar receipt time (datetime.now(timezone.utc),
  Z-suffix law) instead.
- Live cross-check at probe time: RTH values differed sharply from EOD closes
  (VIX 17.17 vs 15.03) — confirms these are intraday values, not stale closes.
