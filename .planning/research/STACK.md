# Technology Stack — v1.1 Additions

**Project:** Morai Trading Dashboard — milestone v1.1 (Real-Time Schwab Streaming)
**Researched:** 2026-06-25
**Scope:** Additions only. The existing Bun/Hono/Supabase/Drizzle/pg-boss/Vitest/Railway stack
is locked in `docs/architecture/stack-decisions.md` and is not re-researched here.
**Confidence:** MEDIUM (all schwab-py claims verified against PyPI + readthedocs.io + source;
COT/FRED verified against official CFTC/St. Louis Fed sources)

---

## 1. schwab-py — Python Schwab Gateway

### Version and Runtime

| Attribute | Value |
|-----------|-------|
| Package | `schwab-py` on PyPI |
| Current version | **1.5.1** (released June 30, 2025) |
| Python requirement | **>=3.10** |
| License | MIT |
| Maintenance | Actively maintained; 38 PyPI releases; Discord community; authored by Alex Golec |
| PyPI classifier | Listed as "1-Planning" — this is stale metadata; ignore it |

Install: `pip install schwab-py`

### REST Client — Relevant Method Surface

All methods live on the client object returned by the auth factories. Methods that matter for
this milestone:

| Method | What It Returns |
|--------|-----------------|
| `get_accounts(fields=[Account.Fields.POSITIONS])` | All linked accounts with positions |
| `get_account(account_hash, fields=[Account.Fields.POSITIONS])` | Single account + positions |
| `get_transactions(account_hash, ...)` | Order/fill transaction history |
| `get_option_chain(symbol, ...)` | Full option chain snapshot (REST, not streaming) |
| `get_quote(symbol)` | Single symbol quote |
| `get_quotes(symbols)` | Batch quotes |
| `get_market_hours(markets, date)` | RTH/ETH schedule by market |
| `get_instruments(symbols, projection)` | Instrument lookup by symbol |
| `get_price_history(symbol, ...)` | OHLCV price history |
| `get_price_history_every_minute(symbol, ...)` | Convenience wrapper |
| `get_orders_for_account(account_hash, ...)` | Open/filled orders |

### Token Management: How It Works

**30-minute access token auto-refresh:** schwab-py detects expiry before each API call and
silently refreshes using the refresh token. No caller intervention required.

**Client factory functions:**

| Factory | When to Use |
|---------|-------------|
| `client_from_login_flow(api_key, app_secret, token_path)` | Initial setup on a machine with a browser; NOT usable headless |
| `client_from_token_file(token_path, api_key, app_secret)` | Normal startup after initial auth; loads file, auto-refreshes access token |
| `client_from_manual_flow(api_key, app_secret, token_path)` | Headless initial auth: prints a URL for you to open on another machine, accepts the callback URL by copy-paste |
| `client_from_access_functions(api_key, app_secret, token_read_func, token_write_func)` | Custom token storage (Postgres, S3, etc.); intended for serverless/Lambda environments |

**Custom Postgres storage via `client_from_access_functions`:**

```python
def token_read() -> dict:
    # SELECT token_json FROM broker_tokens WHERE provider = 'schwab' ORDER BY id DESC LIMIT 1
    row = db.fetchone("SELECT token_json FROM broker_tokens WHERE provider='schwab'")
    return json.loads(row["token_json"])

def token_write(token: dict) -> None:
    # UPSERT to broker_tokens, pgcrypto-encrypt same as TS side
    db.execute("INSERT INTO broker_tokens (...) VALUES (...)  ON CONFLICT ...")
```

schwab-py calls `token_write` on every access-token refresh. The TS server and sidecar share
the same `broker_tokens` row — the sidecar becomes the sole writer, eliminating refresh races.
Do not inspect the token dict structure; just `json.loads`/`json.dumps` it.

**7-day refresh token expiry:**

Schwab hard-expires refresh tokens 7 days after issuance. Refreshing the access token does NOT
extend the refresh token. When it expires, schwab-py raises `OAuthError: invalid_client: refresh
token invalid`.

**The only re-auth mechanism:**

1. Run `client_from_manual_flow()` on any machine that has browser access (local laptop is fine).
2. It prints a URL — open it, complete the OAuth dance, copy the redirect URL back.
3. schwab-py writes a new token JSON string.
4. If using Postgres storage: the `token_write` callback persists it; the Railway sidecar picks
   it up on next startup (reads from `token_read`). No SSH, no redeploy, no Railway volume.
5. If using file storage: copy the token file to the Railway service volume. More fragile;
   Postgres storage is the right approach for this architecture.

**During the re-auth window (up to 24h alert window):** CBOE no-auth fallback stays active for
chain snapshots; streaming pauses gracefully; `AUTH_EXPIRED` flag propagates through existing
status endpoint. This is already the designed behavior from D16.

---

## 2. schwab-py StreamClient — Streaming Details

### Available Services

| Service | What It Streams |
|---------|-----------------|
| `LEVELONE_EQUITY` | Level 1 quotes for equities |
| `LEVELONE_OPTION` | Level 1 quotes + greeks for options |
| `LEVELONE_FUTURES` | Futures quotes |
| `LEVELONE_FUTURES_OPTIONS` | Futures options quotes |
| `LEVELONE_FOREX` | FX quotes |
| `CHART_EQUITY` | OHLCV candles for equities |
| `CHART_FUTURES` | OHLCV candles for futures |
| `NYSE_BOOK` | Level 2 NYSE order book |
| `NASDAQ_BOOK` | Level 2 Nasdaq order book |
| `OPTIONS_BOOK` | Level 2 options order book |
| `SCREENER_EQUITY` | Equity screener |
| `SCREENER_OPTION` | Options screener |
| `ACCT_ACTIVITY` | Account events: fills, orders, positions |

### LEVELONE_OPTION Fields (from `schwab/streaming.py` source)

All fields are delivered unless the subscription specifies a subset. Key fields for this project:

| Field Name | Field # | Trading Use |
|------------|---------|-------------|
| `SYMBOL` | 0 | OCC symbol (e.g. `SPX   251219C05000000`) |
| `BID_PRICE` | 2 | Bid |
| `ASK_PRICE` | 3 | Ask |
| `LAST_PRICE` | 4 | Last trade |
| `TOTAL_VOLUME` | 8 | Volume |
| `OPEN_INTEREST` | 9 | OI |
| `VOLATILITY` | 10 | **Implied volatility** (Schwab's label; this is IV) |
| `DELTA` | 28 | Delta greek |
| `GAMMA` | 29 | Gamma greek |
| `THETA` | 30 | Theta greek |
| `VEGA` | 31 | Vega greek |
| `RHO` | 32 | Rho greek |
| `THEORETICAL_OPTION_VALUE` | 34 | Model price |
| `UNDERLYING_PRICE` | 35 | SPX spot |
| `MARK` | 37 | Mark (mid) |
| `QUOTE_TIME_MILLIS` | 38 | Quote timestamp |
| `TRADE_TIME_MILLIS` | 39 | Last trade timestamp |
| `DAYS_TO_EXPIRATION` | 27 | DTE |
| `STRIKE_TYPE` | 20 | Put/Call |

All five standard greeks (delta/gamma/theta/vega/rho) plus implied vol (`VOLATILITY` field) are
delivered in the stream. No separate Schwab greeks API call is needed during RTH.

### AccountActivityFields

`SUBSCRIPTION_KEY`, `ACCOUNT`, `MESSAGE_TYPE`, `MESSAGE_DATA` — the `MESSAGE_TYPE` field
distinguishes fill events, order events, position updates. Parse `MESSAGE_DATA` for trade details.

### Critical Constraints

**One streamer session per account, enforced by Schwab:**
If a second WebSocket session is opened for the same account, Schwab sends a code 12
`CLOSE_CONNECTION` to the newer session and closes it. The sidecar must own the single session;
no other process may open a second one.

**500-symbol cap per session:**
The schwab-client-js Developer Reference states "up to 500 stock symbols to stream at one time."
This cap applies to the streaming session across all subscriptions combined.

**The full SPX chain CANNOT be streamed:**
SPX has approximately 2,000-5,000 option contracts across near-term expirations. The 500-symbol
cap makes full-chain streaming impossible. Stream only the specific legs in open positions
(typically 2-6 legs per calendar, 10-30 symbols total). Use the existing REST `get_option_chain()`
snapshot job for chain-level data — it is not being replaced.

---

## 3. Sidecar Process Shape

### Framework: FastAPI + Uvicorn

Use **FastAPI** with **uvicorn** as the ASGI server. Do not use Flask.

| Criterion | FastAPI | Flask |
|-----------|---------|-------|
| Async support | Native (asyncio); runs schwab-py's async `StreamClient` in the same event loop | Sync-first; streaming requires threads or Quart port |
| SSE | `EventSourceResponse` from `sse-starlette` or native FastAPI >=0.135.0 | Needs flask-sse + Redis or awkward generator hack |
| Performance | 15k-20k req/s (TechEmpower) | 2k-3k req/s |
| Railway + Dockerfile | Single `uvicorn app:app --host 0.0.0.0 --port 8001` command | Gunicorn sync workers block |
| Pydantic models | First-class; shared validation with schwab-py response parsing | Manual |

FastAPI is the correct choice because the sidecar is inherently async: it bridges schwab-py's
async StreamClient (which runs an asyncio event loop internally) to SSE consumers. Flask's sync
model requires threading workarounds that create race conditions in this exact use case.

### SSE Transport: sse-starlette

Use `sse-starlette` for the SSE endpoint. As of FastAPI 0.135.0 there is native
`fastapi.sse.EventSourceResponse` — use whichever ships with the installed version, but
`sse-starlette` is safe on both old and new FastAPI.

```
pip install fastapi uvicorn sse-starlette
```

**Why SSE over WebSocket for the sidecar-to-TS link:**

The sidecar pushes data; the TS server only reads. SSE is unidirectional by design, reconnects
automatically (browser EventSource protocol), has zero framing overhead, and traverses Railway's
HTTP proxying without custom WebSocket upgrade handling. The TS server already understands HTTP;
no new protocol is needed.

**Sidecar internal architecture (minimal):**

```
schwab-py StreamClient  →  asyncio queue  →  FastAPI SSE endpoint  →  TS server fan-out
schwab-py REST client   →  FastAPI REST endpoints  →  TS server (for chain snapshots, transactions)
```

The TS server is the sole consumer of the sidecar. The sidecar does NOT push to browsers
directly. Fan-out to N browser clients is the TS server's job (via its existing HTTP/WS endpoints
+ Supabase JWT auth guard).

### Recommended Python libraries (sidecar only)

| Library | Version | Purpose |
|---------|---------|---------|
| `schwab-py` | 1.5.1 | All Schwab interaction |
| `fastapi` | >=0.110 | HTTP + SSE framework |
| `uvicorn` | >=0.29 | ASGI server |
| `sse-starlette` | >=2.1 | SSE response (or use fastapi native >=0.135) |
| `psycopg2-binary` (or `asyncpg`) | latest | Postgres connection for custom token read/write |
| `python-dotenv` | >=1.0 | Load env vars from Railway env |

Keep the sidecar dependency footprint minimal. Do not add pandas, numpy, or any analytics
library — all computation stays in `packages/quant` (TypeScript). The sidecar is a thin I/O
boundary, not a compute layer.

---

## 4. CFTC COT Data

### Access Method

**No auth required.** CFTC publishes COT data freely.

**Recommended approach: `cot-reports` Python library**

```
pip install cot-reports   # v0.1.3, Dec 2023
```

The library downloads compressed bulk CSV files directly from CFTC servers and returns pandas
DataFrames. No API key, no rate limit, no Socrata account needed.

```python
import cot_reports as cot

# Traders in Financial Futures (TFF) — preferred for equity futures
df = cot.cot_all("traders_in_financial_futures_fut")
es = df[df["Market and Exchange Names"] == "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE"]
```

### Which Report Type

Use **Traders in Financial Futures (TFF)** (`traders_in_financial_futures_fut`), not Legacy.

| Report | Breakdown | Best For |
|--------|-----------|---------|
| Legacy | Commercial vs Non-Commercial | Simple sentiment signal |
| TFF | Dealers / Asset Managers / **Leveraged Funds** / Other | SPX options traders — Leveraged Funds net positioning is the actionable signal (trend-following hedge funds) |

For an SPX calendar spread trader, the Leveraged Funds net position (long minus short) in
E-mini futures is the primary positioning analytic: when Leveraged Funds are heavily net long
and reversing, it signals hedging flow that moves volatility structure.

### E-mini S&P 500 Instrument Identification

| Field | Value |
|-------|-------|
| CFTC Code | `13874A` |
| Filter value | `"E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE"` |
| DataFrame column | `"Market and Exchange Names"` |
| Consolidated code | `13874+` (standard SPX + e-mini + micro combined — broader but noisier) |

### Data Cadence and Lag

- **Released:** Fridays at 3:30pm ET
- **As-of date:** Prior Tuesday close (3-day lag)
- **Cadence:** Weekly — one pg-boss cron job in `apps/worker`, not a sidecar concern

### Alternative: Direct CFTC Socrata API

If `cot-reports` becomes unmaintained, use the CFTC Socrata endpoint directly (no auth):

- TFF Futures-only dataset ID: `gpe5-46if` at `publicreporting.cftc.gov`
- Legacy Futures-only dataset ID: `6dca-aqww`
- Filter by `cftc_contract_market_code = '13874A'`

The `sodapy` library wraps the Socrata API but adds a dependency. A plain `requests.get()` to
the Socrata SODA endpoint is simpler and has zero dependencies.

### Where COT Fetching Lives

COT is a **weekly TS worker job**, not the Python sidecar. The sidecar is for Schwab auth +
streaming. COT uses no Schwab auth and no streaming; it is a plain HTTP fetch of a public CSV.
Add a `fetch-cot` pg-boss job to `apps/worker`, parsing the DataFrame into a new `cot_snapshots`
Postgres table.

---

## 5. FRED — Existing Adapter, Expanded Series

### Approach: Keep in TS Server, Do Not Move to Sidecar

The existing FRED adapter in `packages/adapters/` already covers the REST pattern
(GET `https://api.stlouisfed.org/fred/series/observations`). The only missing piece is
setting the `FRED_API_KEY` env var in Railway prod (currently unset). Do not add a Python
FRED client in the sidecar — that duplicates logic and splits ownership with no benefit.

### API Access

- **Free, self-service:** Register at `fred.stlouisfed.org` — takes 30 seconds.
- **Key:** Single env var `FRED_API_KEY`.
- **No rate limit concern** at this cadence (daily pulls).

### Concrete Series to Add

| Series ID | Name | Freq | Why an SPX Options Trader Needs It |
|-----------|------|------|------------------------------------|
| `DFF` | Effective Federal Funds Rate | Daily | The policy rate; primary risk-free rate signal |
| `DGS3MO` | 3-Month Treasury CMR | Daily | Standard risk-free rate input for short-dated SPX BSM |
| `DGS1MO` | 1-Month Treasury CMR | Daily | Risk-free rate for 0-DTE and weekly options |
| `SOFR` | Secured Overnight Financing Rate | Daily | Modern risk-free rate benchmark (post-LIBOR); from 2018 |
| `T10Y2Y` | 10Y minus 2Y spread | Daily | Yield curve shape; inversion precedes vol regime shifts |
| `T10Y3M` | 10Y minus 3M spread | Daily | Alternative inversion measure; closer to recession signal |
| `VIXCLS` | CBOE VIX Index | Daily | Implied vol benchmark; cross-check against own BSM |

**Best risk-free rate for BSM in this codebase:** `DGS3MO` for options with >30 DTE; `DGS1MO`
for short-dated. Use continuous compounding: `r = ln(1 + DGS / 100)`. SOFR is the theoretically
correct post-2022 benchmark, but DGS3MO is what most practitioners and vol surfaces use for SPX.

**Do NOT add:** UMCSENT (monthly, too infrequent), DFII10 (useful for equity risk premium but
not for short-term options pricing), GDP or CPI series (wrong cadence and granularity for a
per-session trading view).

---

## 6. What NOT to Add — Explicit Anti-Features

| Do Not Add | Why | What to Do Instead |
|------------|-----|--------------------|
| Message broker (Kafka, RabbitMQ, Redis Pub/Sub) | One sidecar → one TS server: a direct SSE connection needs no broker; broker adds infra, latency, operational burden | Direct SSE from sidecar to TS server |
| Second auth system (Auth0, Okta, Cognito) | Supabase Auth + JWKS (D20) already gates the API; adding a second system creates two places to configure and break | Use existing Supabase Auth JWT at every boundary |
| Full SPX chain streaming | 500-symbol cap makes it physically impossible; would deliver thousands of ticks/second for positions the trader doesn't hold | Stream only open position legs (10-30 symbols); use REST snapshot job for full chain |
| Python FRED client in the sidecar | FRED is already in the TS adapter; splitting ownership means two places updating `rate_snapshots`; Python doesn't add anything here | Keep FRED in TS `fetch-rates` job; only expand the series list |
| pandas/numpy/scipy in the sidecar | The sidecar is I/O-only; all analytics live in `packages/quant`; adding a compute layer in Python creates two BSM implementations and risks divergence | Keep BSM and skew math in `packages/quant`; sidecar passes raw numbers |
| A second Railway Postgres service | The existing Supabase Postgres is the token store and COT/FRED target; a separate Python DB breaks single-source-of-truth | Connect sidecar directly to `DATABASE_URL` (same Supabase direct connection string) |
| WebSocket from sidecar to TS server | TS server is the initiator that opens the SSE connection; websocket adds bidirectional complexity for a one-way data flow | SSE is sufficient; TS server sends no data back to sidecar |
| Streaming the entire ACCT_ACTIVITY firehose to browsers | Account data contains PII (account numbers, all positions); the TS server must parse and filter before fan-out | TS server normalizes ACCT_ACTIVITY events into `position_updates` and `fill_events` types, then fans out to authed SSE endpoints |
| schwabdev or schwab-trader as alternatives | These are community alternatives to schwab-py but have less documentation, fewer releases, and a smaller community; schwab-py (alexgolec) is the canonical unofficial client | Use schwab-py only |

---

## 7. Integration with the Existing TS Hexagon

The sidecar is a **driven adapter** in hexagonal terms — it sits behind a port in `packages/core`.
The existing TS Schwab adapters in `packages/adapters/schwab/` become thin proxies that call the
sidecar HTTP endpoints instead of Schwab directly. Token ownership moves fully to the sidecar.

**Token migration path:**
1. `broker_tokens` Postgres row remains the single store.
2. Sidecar uses `client_from_access_functions` with `token_read`/`token_write` callbacks that
   read/write the same `broker_tokens` row (pgcrypto-encrypted, same as TS side).
3. TS `refresh-token` daily job is retired; sidecar handles all token lifecycle.
4. TS Schwab adapters that currently call Schwab REST directly are rerouted to call the sidecar's
   REST proxy endpoints. This is a one-directory change (adapter swap), not a hexagon change.

**New Railway service:**
The sidecar is `apps/sidecar/` with its own `Dockerfile` (Python base image). Railway adds it as
a third service alongside `server` and `worker`. Internal Railway network communication means no
public URL is needed for the sidecar-to-server SSE link; use a Railway private networking address
or a shared Railway project service URL (Railway private network recommended).

---

## Sources

- [schwab-py PyPI page](https://pypi.org/project/schwab-py/) — version 1.5.1, Python >=3.10 (MEDIUM confidence)
- [schwab-py Authentication docs](https://schwab-py.readthedocs.io/en/latest/auth.html) — client factories, token storage, 7-day expiry behavior (MEDIUM confidence)
- [schwab-py Streaming docs](https://schwab-py.readthedocs.io/en/latest/streaming.html) — services list, field enum names (MEDIUM confidence)
- [schwab-py streaming.py source](https://github.com/alexgolec/schwab-py/blob/main/schwab/streaming.py) — LevelOneOptionFields enum verified field-by-field (MEDIUM confidence)
- [schwab-client-js DeveloperReference](https://github.com/slimandslam/schwab-client-js/blob/main/docs/DeveloperReference.md) — 500-symbol cap confirmed (MEDIUM confidence, cross-referenced with Schwab streamer API docs pattern)
- [Schwab Streamer API community sources](https://grokipedia.com/page/Schwab_Trader_API) — 1 session/account, code 12 CLOSE_CONNECTION (MEDIUM confidence)
- [cot-reports GitHub](https://github.com/NDelventhal/cot_reports) — library API, report types, auth-free (MEDIUM confidence)
- [cot-reports PyPI](https://pypi.org/project/cot-reports/) — v0.1.3, Dec 2023 (MEDIUM confidence)
- [CFTC COT Tradingster](https://www.tradingster.com/cot/futures/fin/13874A) — CFTC Code 13874A confirmed for E-MINI S&P 500 (MEDIUM confidence)
- [CFTC Socrata API](https://dev.socrata.com/foundry/publicreporting.cftc.gov/gpe5-46if/) — TFF dataset ID gpe5-46if (MEDIUM confidence)
- [FRED SOFR series](https://fred.stlouisfed.org/series/SOFR) — series confirmed, from 2018 (MEDIUM confidence)
- [FRED T10Y2Y series](https://fred.stlouisfed.org/series/T10Y2Y) — series confirmed (MEDIUM confidence)
- [FRED VIXCLS series](https://fred.stlouisfed.org/series/VIXCLS) — series confirmed (MEDIUM confidence)
- [FastAPI SSE docs](https://fastapi.tiangolo.com/tutorial/server-sent-events/) — native SSE from v0.135.0 (MEDIUM confidence)
- [sse-starlette PyPI](https://pypi.org/project/sse-starlette/) — production SSE for Starlette/FastAPI (MEDIUM confidence)

---

*Stack research for: Morai v1.1 — Python schwab-py sidecar, COT feed, expanded FRED*
*Researched: 2026-06-25*
