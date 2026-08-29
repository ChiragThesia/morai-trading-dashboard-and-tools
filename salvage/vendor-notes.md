# Vendor Notes — salvaged from packages/adapters/

The application code is being deleted. This is the accumulated knowledge of how each
vendor actually misbehaves, extracted from the adapter source and its tests before the
code dies. Everything quoted below is verbatim from the codebase; file paths are given,
not line numbers (they rot). "Adapters" = `packages/adapters/src/`.

---

## Schwab — OAuth (`schwab/auth/oauth-client.ts`)

- Token endpoint: `https://api.schwabapi.com/v1/oauth/token`. Auth endpoint:
  `https://api.schwabapi.com/v1/oauth/authorize`. Both grants (`authorization_code` and
  `refresh_token`) POST to the **same** token URL with **Basic auth**:
  `Authorization: Basic base64(appKey:appSecret)` — the app credentials, not the user's
  access token, secure the token endpoint itself.
- Access token lifetime: `expiresIn` is **1800 seconds (30 min)**, per the type comment:
  `readonly expiresIn: number; // seconds — 1800 for access tokens`.
- Schwab's OAuth error body is `{ error, error_description? }`. The adapter treats
  **both** `invalid_grant` and `invalid_client` as the same class of failure — an
  expired/invalid credential, not a transient problem:
  > `invalid_grant   — refresh token / auth code expired (treat as AUTH_EXPIRED)`
  > `invalid_client  — wrong credentials or refresh token invalid (treat as AUTH_EXPIRED)`
  Any other non-2xx body, or a body that doesn't match that shape, degrades to a generic
  `code: "network"` error — Schwab's error taxonomy is not fully known, so unrecognized
  codes are NOT assumed to mean anything specific.
- A response that fails `response.json()` (garbage body) is reported as `code: "parse"`,
  a network-level throw (DNS, ECONNREFUSED) as `code: "network"` — these are kept
  distinct so a caller can tell "vendor is unreachable" from "vendor answered garbage".
- Security discipline stated explicitly in the file header: the Basic-auth header value
  and the token values are **never logged** — every error path returns only
  `{kind, code, message}`, never the raw body or the credential.
- Production operational note (from project memory, not this file): Schwab tokens have
  **no automatic refresh cron and no prod refresh button** — refresh happens on-use,
  driven by a separate Python sidecar service's `_trader_token_keepalive` background
  task (referenced in `sidecar/positions-reconciler.ts`: "the sidecar's trader token is
  kept fresh by the Phase 11 `_trader_token_keepalive` background task, so AUTH_EXPIRED
  should be rare in production"). The sidecar, not this adapter, is what actually drives
  the OAuth dance day to day.

## Schwab — chain adapter (`schwab/market/chain-adapter.ts`, `schwab-symbol.ts`)

- **The gateway buffer limit (SC3).** Requesting the full SPX option chain
  (`symbol=$SPX&contractType=ALL` with no other scoping) causes Schwab's gateway to
  return **HTTP 502 "Body buffer overflow"**. The fix is that `strikeCount`, `range`,
  `fromDate`, and `toDate` are **all required** on every request — not optional
  tuning knobs. Direct quote from the adapter:
  > "SC3 fix: strikeCount/range/fromDate/toDate scope the request so the Schwab gateway
  > does not overflow (HTTP 502 "Body buffer overflow" when fetching the full SPX
  > chain). All four scoping params are injected via deps — no magic numbers in this
  > file."
  The actual numeric values (strikeCount, the date window width) are supplied by the
  composition root, not hardcoded in the adapter — so no specific "safe" number is
  recorded here; only that omitting the scoping is what broke production
  (tracked as regression **BRK-01** in the test file).
- **Symbol format.** The chain endpoint wants the underlying prefixed with `$`
  (`$SPX`, not `SPX`) — used consistently in the contract/unit tests
  (`symbol: "$SPX"`). The adapter comment: "symbol is caller-supplied (RESEARCH A3)" —
  i.e. this was determined by research/experiment, not assumed, and is deliberately
  **not** hardcoded so it can be corrected without a code change.
- **Two different strike encodings in the same payload.** The top-level per-contract
  field `strikePrice` is already in **points** (e.g. `5950`), "not ×1000" (comment,
  verified by fixture: `strikePrice: 5950` → `call.strike === 5950`). But the strike
  embedded in the **21-char option symbol string** Schwab also returns
  (`"SPX   250620P07100000"`) is the OCC convention, strike×1000 — divided by 1000
  during symbol parsing. An implementer who assumes one convention applies everywhere
  in the response will be wrong for the field they didn't test.
- **Schwab symbol format** (`schwab-symbol.ts`): 21 characters — root left-padded to 6
  with spaces, then `YYMMDD`, then `C`/`P`, then an 8-digit strike×1000. Structurally
  identical to OCC, so it round-trips through the same `formatOccSymbol` helper.
  Example from the tests: `"SPX   250620P07100000"` (3 spaces to pad `SPX` to 6),
  `"SPXW  260611C07275000"` (2 spaces to pad `SPXW` to 6).
- **`?? 0` fabrication (the named scar).** `openInterest: contract.openInterest ?? 0`
  and `volume: contract.totalVolume ?? 0` in `mapSchwabContract`. The project's own
  retrospective (`plans/analyzer-chain-HANDOFF.md`) names this pattern explicitly:
  > "A vendor field mapped `?? 0` is a fabricated number. `optional()` + `?? 0` makes
  > 'not reported' indistinguishable from a real zero."
  **Caveat, also recorded in the same doc**: when this pattern was first *blamed* for a
  production GEX-wall bug, the diagnosis was wrong — CBOE was sending real open
  interest the whole time; the actual bug was elsewhere (see the Cross-Vendor section
  below). Lesson kept intact: "the `?? 0` diagnosis... was inferred from reading two
  adapters and was wrong... A root cause read off the code is a hypothesis; a root
  cause read off the wire is a finding." Treat `?? 0` as a smell to remove in the
  rebuild, not as proof of any specific bug without checking the wire.
- `markPrice` is preferred when present; when absent, mark falls back to
  `(bid+ask)/2` only if **both** bid and ask are present — otherwise mark is `null`,
  never fabricated.
- `observedAt` for a Schwab chain response is **wall-clock time at fetch**, not a
  vendor-supplied timestamp: "Schwab chain response has no top-level timestamp."
- Auth check happens **before** the network call: `getAccessToken()` is invoked first,
  and its failure short-circuits to `err({kind:"fetch-error", message:"AUTH_EXPIRED"})`
  without ever calling `fetch`. But note: an actual **HTTP 401 from Schwab itself**
  (the live chain endpoint rejecting the bearer token) is **not** specially recognized —
  it maps to the same generic `fetch-error` as any other non-2xx status. The adapter
  only distinguishes AUTH_EXPIRED at the pre-flight `getAccessToken()` step, not by
  interpreting Schwab's own error responses.

## Schwab — trader: account hash (`schwab/trader/account-hash.ts`)

- **The account hash is mandatory and non-obvious.** Comment: "RESEARCH Pitfall 5:
  trader API requires hashValue, NOT the raw account number." Every trader-data call
  (positions, orders, transactions) must first call
  `GET /trader/v1/accounts/accountNumbers` → `[{accountNumber, hashValue}]` and use
  `hashValue` in subsequent URLs. The raw account number is never usable directly.
- An empty array response, or an entry with a missing/empty `hashValue`, is treated as
  a hard failure (`fetch-error`), not silently skipped.

## Schwab — trader: positions (`schwab/trader/positions-adapter.ts`)

- **Trailing-slash trap.** Comment, verbatim: "Single-account endpoint is
  `/accounts/{hash}?fields=positions` — the trailing slash before the query (`/?`)
  returns HTTP 404 against the live API." I.e. `/accounts/{hash}/?fields=positions`
  (with the slash) 404s; `/accounts/{hash}?fields=positions` (without it) works. This
  is exactly the kind of thing that looks cosmetic and isn't.
- Only positions where `instrument.assetType === "OPTION"` are kept — everything else
  (equity, cash) is filtered out at this layer.
- `longQuantity`/`shortQuantity` are separate fields (not a signed single quantity) and
  are defaulted `?? 0` when absent — same fabrication pattern flagged above.

## Schwab — trader: orders (`schwab/trader/orders-adapter.ts`)

- Read-only by design — comment: "No order placement — only GET endpoints (T-04-22)."
  There is no write/trade path in this adapter at all.
- `instruction` (e.g. `"BUY_TO_OPEN"`, `"SELL_TO_CLOSE"`) is mapped to a coarse
  `BUY`/`SELL`/`UNKNOWN` by substring match (`instruction.toUpperCase().includes("BUY")`
  / `"SELL"`) — it does not attempt to preserve the open/close distinction here (that
  distinction is what the transactions adapter's `positionEffect` field is for).

## Schwab — trader: transactions (`schwab/trader/transactions-adapter.ts`)

This file carries the most expensive lesson in the whole vendor surface — a real
production money bug, with the fix and its reasoning left in the comments verbatim.

- **`transferItems[].amount` is the authoritative signed direction, not
  `positionEffect`.** Quoting directly:
  > "transferItems[].amount is Schwab's SIGNED per-leg contract quantity — positive
  > when contracts are received (BOUGHT), negative when delivered (SOLD). This is the
  > authoritative direction signal, independent of positionEffect (OPENING/CLOSING): a
  > single order can open one leg by buying and another by selling (e.g. a calendar's
  > back-bought/front-sold legs), which positionEffect alone cannot distinguish.
  > Deriving `side` from positionEffect (the prior approach) silently forced every
  > OPENING leg to 'buy' and every CLOSING leg to 'sell', corrupting the sign of any
  > sold-to-open or bought-to-close leg all the way through to
  > calendars.open_net_debit."
  This is the mechanism behind the "P&L was −$319,850 for a +$395 trade" incident
  recorded in project memory (`morai-journal-pnl-fill-ledger-fix`).
- **A missing/zero `amount` must never default to "buy".** Second fix layered on top
  (`mapSide`): if `amount` is present and nonzero, its sign decides buy/sell. If it's
  missing or zero, fall back to `cost`'s sign — Schwab sends `cost` as the exact
  negation of `amount`'s intent (confirmed against a real fixture: "amount +1/cost
  -1250.00 for a bought/debit leg, amount -1/cost +800.00 for a sold/credit leg");
  negative cost = money paid = bought, positive cost = money received = sold. If
  **neither** signal is usable, the function returns `null` and the caller **drops the
  leg** rather than guessing — "a missing or zero `amount` must NOT silently default to
  'buy' — that fabricates a direction with a 50% chance of being wrong."
- Fee legs are detected by `transferItems[].feeType` being set (these fail the OCC
  symbol parse on purpose, since they're currency, not a contract) and are summed into
  a separate `fees` total, **keeping Schwab's own sign** rather than normalizing it.
- **Date format trap.** `/transactions` requires full ISO-8601 datetimes for
  `startDate`/`endDate`, not date-only strings — "Schwab /transactions requires
  ISO-8601 datetimes, not date-only (date-only → HTTP 400)." The adapter always widens
  a `YYYY-MM-DD` input to `${from}T00:00:00.000Z` … `${to}T23:59:59.999Z`.
- Schwab's own transaction `tradeDate`/`time` fields are full datetimes even though the
  internal domain type wants a date-only string — sliced to the first 10 characters,
  with a comment flagging why: an unsliced datetime concatenated with `"T00:00:00Z"`
  downstream produces `Invalid Date`.
- The raw, unparsed API response element is captured **alongside** the typed parse
  (`rawElements`, same array so indexes align) rather than reconstructed from the
  Zod `.passthrough()` result — the comment is explicit that passthrough
  reconstruction is not trusted for this "Trade Ledger" raw-audit column.

## CBOE — SPX/SPXW chain (`http/cboe.ts`)

- **Endpoint quirk:** `_SPXW.json` on CBOE's CDN returns **HTTP 403 (S3
  AccessDenied)**. Both SPX and SPXW contracts are actually served together from
  `_SPX.json` (`https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json`);
  the adapter always hits that one URL and filters client-side by OSI root prefix
  (`SPXW` root: symbol starts with `"SPXW"`; `SPX` root: starts with `"SPX"` but NOT
  `"SPXW"`).
- **Timestamp is UTC**, format `"YYYY-MM-DD HH:MM:SS"` with no offset — parsed by
  literally splicing in `T` and `Z`:  `new Date(payload.timestamp.replace(" ", "T") +
  "Z")`. Comment: "production-verified 2026-06-12" — this was confirmed against the
  live feed, not assumed from docs. (Earlier project research had wrongly assumed a
  different timezone — see project memory `morai-phase2-production-lessons`: "CBOE
  timestamps are UTC (research was wrong)".)
- **Spot price resolution order ("Pitfall 3"):**
  `current_price ?? close ?? prev_day_close ?? null`, and if all three are null/0 the
  whole fetch is rejected (`fetch-error`) rather than proceeding with no spot.
- CBOE's OSI symbol format is compact with **no root padding** (unlike OCC/Schwab):
  last 8 chars = strike×1000, char before that = C/P, the 6 before that = `YYMMDD`,
  and everything before that is the bare root (`SPX` = 3 chars, `SPXW` = 4 chars) —
  e.g. `"SPXW260611C07275000"`. Converted to OCC via `osiToOcc` (left-pad root to 6).
- `openInterest`/`volume` are again defaulted `?? 0` when the vendor omits them
  (`open_interest`, `volume` fields) — same fabrication pattern as Schwab, flagged
  above; see the Cross-Vendor section for why this specific field, on this specific
  vendor, turned out NOT to be the bug when it was blamed for one.

## CBOE — VIX9D and VVIX index quotes (`http/cboe-vix9d.ts`, `http/cboe-vvix.ts`)

Nearly identical adapters, deliberately not generalized into one parameterized
fetcher — comment: "CBOE serves only 2 series, not worth a parameterized generic
fetcher." Endpoints:
`https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX9D.json` and
`.../_VVIX.json`. Same `{timestamp, data:{current_price, close, prev_day_close}}`
shape and same UTC-timestamp/spot-resolution rules as the SPX chain adapter above.

- **Why VIX9D lives here at all:** "FRED does not publish VIX9D (VIX9DCLS 404s)" — so
  CBOE is the only source, not a preference.
- **`last_trade_time` is explicitly distrusted.** Both files: "date is derived from the
  top-level UTC `timestamp` — NOT `last_trade_time`, whose timezone is unverified
  (RESEARCH Pitfall 6)."
- **Late-evening ET date-labeling trap.** The trading-day label is computed from the
  UTC timestamp converted to the `America/New_York` calendar day via
  `Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York", ...})` (en-CA formats as
  `YYYY-MM-DD` directly, convenient for this). Comment: "Between 20:00 ET and midnight
  ET the UTC date is already tomorrow — a UTC slice would store the session's
  VIX9D/VVIX under the next day." Tracked as review finding **WR-02**.
- Both return the **raw** vendor value — "no `/100` division (D-14)" — because these
  are index levels, not percentages (contrast with FRED DGS3MO below, which IS a
  percentage and IS divided by 100).

## FRED (`http/fred.ts`, `http/economic-events.ts`)

- Endpoint: `https://api.stlouisfed.org/fred/series/observations`, query params
  `series_id`, `api_key`, `file_type=json`, `sort_order=desc`, `limit=5`. Response
  shape: `{observations: [{date, value}]}` where **`value` is always a string**, even
  when numeric.
- **`.` is FRED's missing-value sentinel** ("Pitfall 7") — every observation is
  filtered for `value !== "."` before use; because the request already sorts
  `desc`, the first surviving row is the most recent real value.
- **Two distinct adapters, deliberately different failure policy:**
  - `makeFredRateAdapter` (the DGS3MO 3-month rate feeding discounting) **has a
    fallback**: missing API key, network error, non-2xx, parse failure, or an
    all-`.` window all degrade to `ok(fallbackRate)` — a caller-supplied constant,
    not fabricated in this file — with a static `console.warn`, never logging the key.
    DGS3MO's value **is** a percentage and is divided by 100 (`5.25` → `0.0525`).
  - `makeFredSeriesAdapter` (the generic parameterized macro-series fetcher, e.g. for
    VIXCLS) **has no fallback at all** ("D-09: hard-require the key — no fabricated
    fallback on missing/empty key") — every failure mode returns `err`, never a
    guessed value. And critically, it returns the **raw** value with **no `/100`**
    (D-14) — because a generic series like an index level must not be assumed to be a
    percentage the way DGS3MO is. Mixing these two conventions up (treating a raw
    index level as a percentage, or vice versa) is an easy default-wrong mistake.
- **`release/dates` is a different endpoint with a different shape** from
  `series/observations` — explicit warning against reuse: "a NEW schema is required
  (Pitfall 4), never a reuse of fred.ts's FredResponseSchema." Used for CPI
  (`release_id=10`) and NFP/Employment Situation (`release_id=50`) release-date
  calendars via `economic-events.ts`.
- **This endpoint was never actually confirmed live before the schema was written** —
  worth flagging because it means the shape is a documented *assumption*, not a
  verified fact: "A live confirmation call... could therefore NOT be issued this
  session. Proceeding on RESEARCH.md's A3 assumed shape (cross-checked via secondary
  sources, not a live response)... If this assumed shape is wrong, the Zod safeParse
  below fails LOUDLY... rather than silently corrupting data."
- **FOMC has no programmatic source at all.** There is no FRED (or other) feed for
  FOMC meeting dates, so `economic-events.ts` ships a **hand-maintained static seed
  table** (`FOMC_SEED`) of meeting statement-days through 2026-12-09, sourced from
  https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm, with an explicit
  refresh instruction ("Refresh... as new schedules are published (typically ~1-2
  years ahead)"). This seed is **unioned unconditionally** with the FRED-sourced
  CPI/NFP rows, regardless of whether the FRED fetch itself succeeds — "the seed
  supplements FRED, it never depends on it."

## CFTC (`http/cftc.ts`)

Socrata "Traders in Financial Futures" (TFF) futures-only dataset,
`https://publicreporting.cftc.gov/resource/gpe5-46if.json`. E-mini S&P 500 contract
code is **`13874A`** — noted explicitly as distinct from `13874+`, which is the
*combined* futures+options code, a different series. Anonymous access, no app token
(~1000 req/hour, far above a weekly job's needs) — and a comment warns "Do NOT send
X-App-Token (landmine 7 — keep tokens out of code/logs)."

Numbered "landmines," quoted because they're exactly the kind of vendor-specific traps
a fresh implementation would rediscover the hard way:

- **Landmine 1** — "Socrata returns ALL numeric fields as JSON strings (e.g.
  `"2987456"`)." Every numeric field uses `z.coerce.number()`.
- **Landmine 8 (dated 2026-07-01)** — inconsistent field-name suffixing that silently
  breaks schema validation: "the TFF dataset uses the `'_all'` suffix ONLY on dealer,
  nonrept, and open_interest. asset_mgr / lev_money / other_rept position fields have
  NO `'_all'` suffix." I.e. `dealer_positions_long_all`, `nonrept_positions_long_all`,
  `open_interest_all` — but `asset_mgr_positions_long`, `lev_money_positions_long`,
  `other_rept_positions_long` (no suffix). Get one wrong and the whole
  `fetch-cot` job errors on schema validation, not a partial-data warning.
- **`asOf` = the date substring of `report_date_as_yyyy_mm_dd`, never date-math** —
  the field arrives as an ISO "floating timestamp" like `"2026-06-23T00:00:00.000"`
  and is validated with a regex (`^\d{4}-\d{2}-\d{2}`) before slicing, so a
  non-ISO value fails loudly at the adapter boundary rather than producing a garbage
  date that only breaks a downstream `.parse()` later.
- **No fabricated fallback ("landmine 4")** — an empty result array from Socrata is a
  hard `err`, never a synthesized/zero row.
- **SoQL-injection guard, added explicitly (WR-01), not from vendor docs** — the
  `contractCode` parameter is validated against `^[0-9A-Z+]+$` *before* it's
  interpolated into a `$where=cftc_contract_market_code='<contractCode>'` clause, and
  a failing value never reaches `fetch` at all. This exists because the query is
  built by string interpolation, not parameterized — the CFTC Socrata API gives no
  parameterized-query mechanism, so the guard has to be hand-rolled at the call site.

## Alpaca (`http/alpaca-news.ts`)

- News API (Benzinga wire relay via Alpaca's free tier):
  `https://data.alpaca.markets/v1beta1/news?limit=50&sort=desc`. Auth is a **key
  pair**, not a bearer token: `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` headers (a
  paper-account key pair is sufficient for this read-only feed).
- **`include_content` is deliberately left off** — "headlines + summaries only, bodies
  never fetched." This wasn't a size optimization footnote; it's a stated boundary of
  what this system stores.
- No-fallback pattern, same discipline as `makeFredSeriesAdapter`: missing/empty key
  pair, network error, non-2xx, or Zod parse failure all return `err`, never a
  fabricated batch. Key values are never logged even on failure.
- Numeric vendor `id` is stringified for use as a stable upsert key; an empty-string
  `url` is normalized to `null`; `summary` defaults to `""` and `symbols` to `[]` via
  Zod `.default(...)` (a real, vendor-confirmed default — not the `?? 0` fabrication
  pattern, since an empty array/string is a legitimate "no data" value here, not a
  numeric measurement being invented).
- Downstream context from project memory (not this file): Schwab has **no news
  endpoint at all** — Alpaca/Benzinga is the only news source in the system, and the
  raw feed is heavy with analyst-note noise filtered down significantly before display
  (`morai-news-feed-d28`: "raw-store/filtered-read cut 66%-analyst-noise firehose to
  7%") — that filtering logic itself lives in core, not in this adapter.

---

## Cross-vendor: the dual-source chain union (Schwab + CBOE)

This is the single most consequential piece of cross-vendor knowledge in the adapters
package, and it lives in the **read** path, not the fetch path.

**At write time** (`packages/core/src/journal/application/fetchChain.ts` — core, not
adapters, but essential context): every fetch cycle runs **both** sources — Schwab and
CBOE — concurrently, for both roots (SPX, SPXW), and persists whatever succeeds,
append-only, each row tagged with its origin in a `source` column
(`packages/adapters/src/postgres/schema.ts` defines the enum as exactly three values:
`"schwab_chain" | "cboe" | "computed_only"`). Comment: "Partial failure is tolerated:
if ANY chain succeeds, its data persists and the run returns ok — a Schwab failure
never darkens the pipeline." Nothing is merged or deduplicated at write time.

**At read time**, two Postgres repos — `postgres/gex-snapshot.repo.ts` (feeds GEX
walls) and `postgres/repos/picker-chain.ts` (feeds the picker/journal) — independently
implement the *same* merge pattern, described as mirroring each other in their own
comments:

1. Find the latest observation `time` where the relevant BSM column is filled
   (`bsm_gamma` for GEX, `bsm_iv` for the picker).
2. Read a **10-minute lookback window** ending at that time — `const lookbackMs = 10 *
   60 * 1000` — rather than a single exact timestamp. Reason, quoted: "one fetch cycle
   lands as TWO nearby timestamps (Schwab + CBOE each stamp their own observedAt)...
   strict max(time) equality would drop a source." A calendar-slot-boundary approach
   was tried and also broke: "a CALENDAR-SLOT union breaks when the cycle straddles
   the 30-min boundary (live 2026-07-08: CBOE 16:59:31 vs Schwab 17:00:31 — cron
   jitter + Schwab latency straddle the boundary constantly)." The lookback is
   anchored to the data itself instead, specifically to avoid that boundary case, and
   is "well under the 30-min cycle spacing, so adjacent cycles never merge."
3. `SELECT DISTINCT ON (contract) ... ORDER BY contract, time DESC` — one row per
   contract, **newest row wins** for most fields (bid/ask/mark/IV/greeks).
4. **Except `openInterest`, which is the explicit exception to "newest wins."** Both
   repos compute it as `MAX(open_interest) OVER (PARTITION BY contract)` — a window
   function evaluated *before* the `DISTINCT ON`, so the surviving row already carries
   its partition's max with no second query.

**Why open interest specifically breaks the newest-wins rule — this is a measured
production incident, not a design preference.** From `picker-chain.ts`, quoted in
full because the numbers are exactly the kind of thing that can't be reconstructed
later:
> "Schwab's chain returns `openInterest: 0` for every contract outside RTH (measured
> in prod 2026-07-27: 0.0% non-zero from 04:00Z to 10:00Z, 86.3% from 10:30Z). CBOE
> carries real OI in every snapshot. Both land in this same lookback window and Schwab
> writes about a minute AFTER CBOE, so the newest-row rule handed the whole chain
> Schwab's zeros overnight — 2,971 contracts a day. GEX is open interest × gamma, so it
> computed zero gamma everywhere and reported null call/put walls until RTH data
> arrived."
>
> "MAX is correct, not a heuristic: open interest is a once-daily OCC figure and is
> never negative, so within one cohort window the larger of the two sources IS the
> reported value. A genuinely untraded strike still reads 0, because then both sources
> report 0."

The `gex-snapshot.repo.ts` copy of this comment adds the historical color: this was
first mis-diagnosed as a `?? 0` mapping bug in the adapters (see the Schwab chain-
adapter section above) — "CBOE was sending open interest the whole time" — before the
actual mechanism (Schwab's real, vendor-side RTH-only reporting, colliding with a
newest-row read rule) was found by checking the wire, not the code.

- **`source` mapping for the picker read** (`picker-chain.ts`): the three-value DB
  enum collapses to a two-value `schwab | cboe` union at this read seam —
  `source: row.source === "schwab_chain" ? "schwab" : "cboe"` — meaning
  `"computed_only"` rows (no real vendor origin) are labeled `"cboe"` by default.
  Comment: "'computed_only' has no vendor source and maps to 'cboe' (the historical
  default), mirroring snapshotCalendars.ts's identical mapping." This is an arbitrary
  historical choice, not a principled one — worth re-deciding in the rebuild rather
  than carrying forward unexamined.
- **What breaks when one source is missing:** nothing fatal — the union tolerates a
  single source's absence entirely (a Schwab outage still leaves CBOE rows in the
  window, and vice versa) — but open interest quality degrades to whichever source
  *is* present, and outside RTH that source is far more likely to be CBOE.
- **`chain.root` is not a trustworthy per-contract label** — a related, adjacent trap
  documented in `fetchChain.ts` (core): "the sidecar makes one Schwab `'$SPX'` call
  that returns BOTH SPX and SPXW contracts, so `chain.root` is a response label...
  and labelling every contract with it mislabelled 1,190 prod rows." Root and
  expiration must always be read back out of each contract's own OCC symbol, never
  off the chain-level response wrapper.

## Cross-vendor: the `?? 0` scar, precisely stated

Both Schwab (`schwab/market/chain-adapter.ts`, `schwab/trader/positions-adapter.ts`)
and CBOE (`http/cboe.ts`) default missing optional numeric fields — chiefly
`openInterest`/`volume`, also `longQuantity`/`shortQuantity` on positions — with
`?? 0`. The project's own documented verdict on this pattern
(`plans/analyzer-chain-HANDOFF.md`):
> "A vendor field mapped `?? 0` is a fabricated number. `optional()` + `?? 0` makes
> 'not reported' indistinguishable from a real zero."
This is real, general advice for the rebuild — a rebuild should almost certainly type
these as `number | null` and force every caller to handle "unreported" separately from
"reported as zero." But pair it with the correction the same document records: this
pattern was, once, *wrongly* blamed as the root cause of a specific GEX bug that
actually had a different mechanism entirely (see above). The pattern is worth fixing
on principle; it is not automatically the explanation for any given zero you see in
the data.

## UNJUSTIFIED constants

- `strikeCount`, `range`, `fromDate`/`toDate` widths for the Schwab chain request are
  explicitly **not** in the adapter — they're injected by the composition root, and no
  file in `packages/adapters/` records what numeric value was actually found safe
  against the 502 gateway limit. The rebuild will need to re-derive (or ask for) that
  number; it is not preserved here.
- FRED's DGS3MO `fallbackRate` (e.g. `0.045` in tests) is caller-supplied, not defined
  in `fred.ts` itself — the adapter takes it as a parameter and never justifies a
  specific value. Whatever number the real deployment used lives outside
  `packages/adapters/` (composition root env config) and was not found in this review.
- Alpaca's `FETCH_LIMIT = 50` (news items per poll) has no comment explaining why 50
  specifically, versus Alpaca's actual page-size ceiling. Treat as free to change.
- CFTC's `$limit=1` (one row per contract per fetch) is justified in a comment as
  "D-06: current week only" — this one IS justified, included here only to contrast
  with the unjustified ones above.
