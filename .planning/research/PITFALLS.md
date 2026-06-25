# Pitfalls Research

**Domain:** Python sidecar + Schwab streaming + SSE/WS fan-out in a hexagonal Bun/TS trading app
**Researched:** 2026-06-25
**Confidence:** HIGH (auth/token mechanics confirmed against official Schwab docs + schwab-py source; streaming limits confirmed via community + API reference; domain gotchas from first-party project history)

---

## Critical Pitfalls

### Pitfall 1: Streamer Symbol Cap — Subscribing the Full SPX Chain

**What goes wrong:**
The SPX options chain has thousands of strikes across 20+ expirations. Subscribing every symbol via `LEVELONE_OPTIONS` floods the websocket with a firehose of ticks. Schwab's streamer has undocumented per-connection payload limits. At high subscription counts the streamer silently drops symbols, starts returning stale data for some strikes, or the connection is killed by the server-side throttle with no clear error code. The sidecar continues running and reporting healthy; positions show as updated; but specific strikes go dark.

**Why it happens:**
schwab-py's `level_one_option_subs()` takes a symbol list with no enforced cap. Developers pull the chain to discover all symbols (which is correct for REST snapshots) and then naively pass the same list to the streamer. The full SPX chain near-the-money is ~500–2000 symbols depending on expirations loaded.

**How to avoid:**
Scope subscriptions to the minimum live-required set only:
- Position legs (the specific OCC symbols of open calendar positions) — typically 2–6 symbols
- SPX spot index (for delta/gamma context)
- Fill confirmations via `ACCT_ACTIVITY` stream, not option quotes

Never stream the full chain. REST snapshots (`get_option_chain`) remain the correct path for chain-wide GEX/skew computation; the stream is only for position mark refresh and fill detection. Build an explicit symbol whitelist derived from the positions query at startup and re-subscribed on position change. Log the symbol count at subscription time; alert if it exceeds 20.

**Warning signs:**
- A position's mark stops updating while the streamer appears connected
- Stream handler call frequency drops below expected cadence without a disconnect event
- Subscription count in logs exceeds 50

**Phase to address:**
Auth-migration + sidecar scaffold phase. The subscription scope must be locked in the sidecar design before any `LEVELONE_OPTIONS` handler is written. Verification criterion: integration test that subscribes only position-leg symbols and asserts the symbol list is derived dynamically from the positions table, not from the chain response.

---

### Pitfall 2: Dual-Refresher Rotating-Token Race

**What goes wrong:**
Schwab's access token lasts 30 minutes. The old TS daily refresh job (`broker_tokens` table + pgcrypto) still holds Schwab credentials and will attempt to refresh on schedule. If the new Python sidecar also refreshes (which it must, continuously), both processes can be in-flight simultaneously. On each successful access token refresh, Schwab issues a **new refresh token** and invalidates the old one. If the TS job wins and writes a new access token using the old refresh token, the sidecar's in-memory token is now wrong. On the next sidecar refresh, it presents a stale refresh token and Schwab returns `invalid_grant` — silently breaking auth.

**Correction on "refresh token stays constant":** Several community sources incorrectly state the refresh token is constant for its 7-day window. The official Schwab OAuth 2.0 flow and schwab-py source both show that the token response on each access token refresh includes a `refresh_token` field with a new value. The refresh token is rotated, not reused. Any second refresher that reads from a stale token store will clobber the sidecar's auth within one 30-minute cycle.

**Why it happens:**
The old TS Schwab adapter was built to be self-sufficient. Migrating to the sidecar requires explicitly decommissioning the TS token refresh path, which is easy to miss if the adapter continues to be used for REST calls during the transition.

**How to avoid:**
Single-refresher rule: the Python sidecar is the sole process that touches the Schwab OAuth token lifecycle from the moment it is introduced. Concretely:
1. The auth-migration phase explicitly removes (or permanently disables) the TS Schwab token refresh job — not "comments out," removes from pg-boss schedule.
2. The TS REST adapters that currently call `broker_tokens` are repointed to the sidecar's internal REST proxy endpoint (or decommissioned if the sidecar handles all chain REST pulls).
3. The sidecar uses `token_write_func` to persist the current token to Postgres (`broker_tokens` or a new `sidecar_tokens` table) as the single source of truth, so a sidecar restart can resume without re-auth.
4. A startup check confirms exactly one refresh-capable process is running before the sidecar starts its auto-refresh loop.

**Warning signs:**
- `invalid_grant` error in sidecar logs after a previously healthy session
- The TS worker logs a successful Schwab token refresh at a time when the sidecar should own it
- Sidecar token age (log it) is older than 30 minutes

**Phase to address:**
Auth-migration phase (must be its own phase, not bundled into streaming). The verification criterion is a concurrency test: start the TS job and the sidecar in a staging env, let both run for 2 hours, assert only the sidecar's refresh events appear in logs.

---

### Pitfall 3: 7-Day Headless Re-auth on Railway

**What goes wrong:**
Schwab refresh tokens hard-expire 7 days after issuance. There is no way to extend this. On a headless Railway container there is no browser, so the standard schwab-py `client_from_login_flow` (which opens localhost and waits for the OAuth redirect) cannot be used. If the re-auth is missed — because there is no alert, or the alert fires but re-auth takes a day — the sidecar silently falls back to returning stale position data. No exception is raised to callers; journal jobs keep running with the last-cached values; GEX analytics keep computing from stale chain snapshots. The staleness is invisible unless you look at the data timestamps.

**The headless re-auth procedure (concrete):**
schwab-py provides `client_from_manual_flow()`. This flow prints an authorization URL to stdout. The operator opens that URL in any browser, completes the Schwab login, copies the redirected URL (or authorization code) from the address bar, and pastes it back into stdin (or an environment variable). The sidecar must implement a weekly re-auth trigger that:
1. Logs the re-auth URL prominently (stdout + a webhook/Slack alert) at T-24h and T-2h before the token's 7-day expiry.
2. Provides a Railway-accessible endpoint (`POST /sidecar/reauth`) or a Railway service CLI command that accepts the pasted redirect URL and completes the token exchange.
3. Stores the fresh token via `token_write_func` to Postgres so a restart doesn't require re-auth again.
4. Falls back to CBOE for chain data if Schwab auth is expired (existing CBOE fallback retained per PROJECT.md).

**Why it happens:**
The schwab-py docs describe "run locally, copy token.json to server" as the typical pattern. That works for one-time setup but breaks the weekly re-auth cycle because on week 2 the token is stale and the engineer must SSH in or redeploy. Without an explicit re-auth workflow built into the sidecar, the first weekly expiry causes a production outage.

**How to avoid:**
Build the re-auth endpoint and expiry-alert webhook in the sidecar scaffold phase — before streaming is added. The alert must fire early enough for the engineer to re-auth before expiry; a 24-hour warning at T-168h is correct. The CBOE fallback must be tested in this phase (confirm journal keeps writing via CBOE when Schwab auth is expired).

**Warning signs:**
- Sidecar logs `OAuthError` or `invalid_client` on a refresh attempt
- Position data timestamp hasn't advanced in >30 minutes during market hours
- Journal snapshots are being written but all greeks are unchanged across multiple entries

**Phase to address:**
Auth-migration / sidecar scaffold phase. CBOE fallback validation is a verification criterion for this phase. Re-auth endpoint smoke test (POST a test auth code, verify token is written to Postgres) is a second criterion.

---

### Pitfall 4: Python-in-a-TS-Monorepo Drift

**What goes wrong:**
Adding a Python service introduces a second dependency universe (pip/uv/poetry), a second lock file, a second linter (ruff/mypy), a third Railway service with its own Dockerfile, and a second set of env vars that must be kept in sync with the TS services. The drift takes three forms:
1. **Env drift**: A secret (e.g., `ENCRYPTION_KEY` for pgcrypto, `SCHWAB_CLIENT_ID`) is added to the Railway `server` and `worker` services but not to the new `sidecar` service. The sidecar starts and appears healthy until it tries to decrypt a token.
2. **Dependency lock drift**: The sidecar's `uv.lock` is not updated after a `uv add`, so CI installs a different version than prod, introducing subtle bugs (e.g., a schwab-py version with a known reconnect bug).
3. **CI lane collision**: A TS typecheck + lint run passes but does not cover the Python sidecar. A Python type error ships to prod undetected.

**Why it happens:**
Bun workspaces have no concept of Python packages. There is no shared CI step that naturally covers both runtimes. Engineers add env vars to the services they're touching and forget the third. The sidecar Dockerfile has a different build context than the TS services (it needs `apps/sidecar/` + root `pyproject.toml` but not the full monorepo), causing Railway to either include too much or exclude needed files.

**How to avoid:**
- **uv** for the Python sidecar (not poetry or pip): faster, lock-file-exact installs, works well in Docker multi-stage builds.
- A dedicated `apps/sidecar/` directory with its own `pyproject.toml` + `uv.lock`. The Dockerfile uses `--mount=type=cache` for the uv cache layer.
- Railway `RAILWAY_DOCKERFILE_PATH` and `watch_paths` set to `apps/sidecar/**` so TS changes don't trigger a sidecar rebuild.
- A shared env-var checklist (or Railway shared variables) for secrets that cross all three services: `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `DATABASE_URL` (session pooler), `ENCRYPTION_KEY`.
- CI: separate jobs for `bun run typecheck && bun run lint` (TS) and `uv run mypy && uv run ruff check` (Python), both required to pass before merge.
- `docs/architecture/stack-decisions.md` updated with the Python-sidecar decision and its Dockerfile path before any implementation starts (existing workflow rule).

**Warning signs:**
- A CI run that takes the same time whether Python files changed or not (watch_paths not set)
- `KeyError` or `ValueError` in sidecar startup from a missing env var
- `uv.lock` file shows `Modified: (in-repo)` but `uv sync` in CI installs different versions than local

**Phase to address:**
Sidecar scaffold phase (first Python phase). The verification criterion is that a clean CI run (no local caches) passes all four lanes: TS typecheck, TS lint, Python mypy, Python ruff. Env-var checklist is a deliverable of this phase.

---

### Pitfall 5: Streamer Connection Lifecycle — Reconnect Storms and Session Killing

**What goes wrong:**
The Schwab streamer allows exactly **one active session per account**. If a second `login()` call is issued — whether from a second process, a sidecar restart, or a misconfigured retry loop — the first session is immediately terminated by Schwab's server. The old session receives a close frame; any in-flight handlers on the old connection get no further callbacks. The new session starts but may itself be killed if a third login attempt races in during startup.

Additional lifecycle issues:
- The streamer requires subscriptions to be sent **after** the `LOGIN` response is confirmed. Commands sent before `LOGIN` completes are silently dropped or cause a crash within 90 seconds with the error "likely no subscriptions or invalid login."
- Aggressive reconnect logic (exponential backoff without jitter, or a fixed 1-second retry) can trigger rapid successive `login()` calls during a network blip, which Schwab rate-limits, causing a longer outage than the original blip.
- The streamer has no built-in heartbeat (schwab-py documentation explicitly does not document one). A silent TCP half-open can leave the client believing the stream is alive while no data is flowing.

**How to avoid:**
- **Single login, single session**: the sidecar is the only process that calls `StreamClient.login()`. No retry logic should call `login()` more than once without first confirming the session is fully closed.
- **Login-then-subscribe ordering**: await the `LOGIN` response before issuing any `level_one_option_subs()` or `ACCT_ACTIVITY` subscription commands.
- **Reconnect with jitter**: exponential backoff starting at 5s, cap at 5 minutes, ±50% jitter. Log each reconnect attempt. Alert if more than 3 reconnects in 10 minutes.
- **Application-level heartbeat**: send a `GET /sidecar/health` probe from the TS server every 30 seconds to the sidecar's internal health endpoint, which checks that the stream received at least one message in the last 60 seconds. If the sidecar fails 3 consecutive probes, the TS server marks Schwab stream as degraded and switches positions to last-known values.
- **Startup guard**: the sidecar holds a Postgres advisory lock (`pg_try_advisory_lock`) during its session. A second sidecar instance attempting to start will fail to acquire the lock and exit cleanly, preventing duplicate sessions on a Railway redeploy overlap.

**Warning signs:**
- Streamer silently stops receiving messages but the connection appears open
- "Stream has crashed within 90 seconds" error in sidecar logs
- Multiple `LOGIN` log lines within a 60-second window

**Phase to address:**
Sidecar scaffold phase (connection manager) and streaming integration phase (reconnect policy, health probe wiring to TS server). The advisory lock check is a verification criterion for the scaffold phase.

---

### Pitfall 6: SSE vs WebSocket Fan-Out and Auth

**What goes wrong:**
Two distinct failure modes:

**A. JWT in query parameter (SSE auth):**
The browser's native `EventSource` API cannot set `Authorization` headers. The naive workaround is `new EventSource('/stream?token=<jwt>')`. JWTs in URL query parameters appear in Railway access logs, browser history, proxy logs, and error reporting tools (Sentry dsn breadcrumbs). For a single-trader personal tool the operational risk is lower, but the token is still in logs indefinitely.

**B. Slow client stalls the fan-out:**
The TS server fans one upstream Schwab stream to N browser clients (SSE or WS). If one browser tab on a slow connection cannot drain its write buffer, Node.js's non-blocking I/O still allocates the message in that client's outgoing buffer. With no backpressure mechanism, a single stalled client causes memory growth that eventually crashes the process, starving all other clients.

**Why it happens:**
SSE is simpler to implement than WS for uni-directional streaming, so it's the default choice. The auth header limitation is discovered after the endpoint is built. Backpressure is not thought about until the process crashes in staging.

**How to avoid:**
- **Auth**: Use a short-lived (60-second) SSE-specific token issued by a `POST /api/stream/token` endpoint that verifies the Supabase JWT and returns a single-use opaque token. The `EventSource` URL carries the opaque token, not the JWT. The TS stream endpoint verifies the opaque token from an in-memory set and discards it after first use. Alternatively, use the `event-source-polyfill` library on the client to enable `Authorization` header support — this is the cleanest approach if the client is already bundled with Vite.
- **Backpressure**: For each connected client, maintain a bounded in-memory queue (max 50 messages). If the queue is full, drop the oldest message and log a `stream:slow-client` metric. If the client is unreachable for 10 seconds, close the connection server-side. Never let a slow client block the write path for other clients.
- **WS vs SSE**: For this milestone (single trader, uni-directional marks), SSE is fine. WS is warranted if the UI needs to send commands back (e.g., subscribe to different symbols). Do not introduce WS just for auth header support — the opaque-token pattern solves that.

**Warning signs:**
- JWTs appearing in Railway log search results
- Memory footprint of the TS server process growing monotonically during a session
- One browser tab's disconnection causes others to lag

**Phase to address:**
TS server fan-out phase. The opaque-token pattern and backpressure queue are verification criteria. Auth security check: search Railway logs after a test stream connection for any JWT-shaped string.

---

### Pitfall 7: Persisting Stream Data — Write Amplification

**What goes wrong:**
The Schwab `LEVELONE_OPTIONS` stream fires on every quote change. For 6 position-leg symbols during market hours this is ~1–5 ticks/second/symbol, or up to 30 inserts/second into Postgres. Plain Postgres on Supabase at that insert rate is fine in isolation (D7 sets the threshold at >10M rows or p95 >500ms). The problem is conflation: writing every tick to `calendar_snapshots` or a new `live_ticks` table conflates the durable 30-minute journal with the ephemeral live view. If the stream has a reconnect gap, the journal now has holes at sub-30-minute granularity. Consumers expecting 30-minute snapshots get confused by intermediate values.

**Why it happens:**
The streaming data and the snapshot journal feel like they should share a table because they describe the same thing (position greeks at a point in time). The difference is temporal resolution and durability intent.

**How to avoid:**
- Keep the 30-minute `calendar_snapshots` table unchanged. The snapshot job continues to write to it on its existing schedule; it is the durable journal.
- Streaming marks are a separate, ephemeral layer. The sidecar maintains an in-memory last-known-value map per position leg. The TS server reads from this map to serve the live `/api/positions/live` endpoint. Nothing is persisted per tick.
- If a persistent tick log is desired later (for intraday replay), it is a separate table with a separate retention policy — not mixed into `calendar_snapshots`.
- The snapshot job can optionally read from the sidecar's last-known-value API instead of making a fresh Schwab REST call at snapshot time, eliminating the 30-minute access-token window problem. But this is additive; the journal's correctness must not depend on the stream being alive.

**Warning signs:**
- `calendar_snapshots` row count growing at more than 2 rows per position per 30-minute period
- P95 write latency for the snapshots table increasing during market hours
- Journal queries returning multiple rows for the same calendar at the same timestamp

**Phase to address:**
Sidecar scaffold + streaming integration phases. The verification criterion is an explicit data model decision: `calendar_snapshots` schema is unchanged; a new `sidecar_live_state` in-memory map is documented as the streaming layer. Any PR that adds a streaming insert to `calendar_snapshots` is a merge blocker.

---

### Pitfall 8: COT Misinterpretation — Timing, Contract, and Positioning Type

**What goes wrong:**
CFTC COT reports describe **futures positioning** for E-mini S&P 500 futures (ES), not SPX options. They cover dealer, asset manager, leveraged fund, and other reportable categories, but the "dealer" category in ES futures does not map cleanly to dealer options gamma exposure (GEX). Treating COT dealer short as "dealers are short gamma" or as a same-directional SPX signal conflates futures directional positioning with options hedging positioning.

The second error is timing. COT data reflects positions as of the preceding **Tuesday close**, published the following **Friday at 3:30 PM ET**. During a sharp market move (e.g., a Fed surprise on Wednesday), Tuesday's snapshot is already 3 days stale when published. Displaying COT as a "current" signal during an event-driven week can invert the actual positioning story.

**Why it happens:**
COT data is freely available and has a simple JSON/CSV format. It is tempting to add it quickly as a "macro overlay." The positioning categories and lag are in the documentation but easy to skim past.

**How to avoid:**
- Store the COT data with its **as-of date** (the Tuesday close date) and its **publication date** (the Friday). Display both in the API response. Never display COT without the as-of label.
- The analytic is `ES_futures_net_positioning_by_category`, not `SPX_dealer_gamma`. Name it correctly in the API contract and the data model.
- The COT adapter fetches on Friday after 3:30 PM ET via the CFTC public API — no polling needed, just a scheduled job.
- Cross-check COT against GEX only as a corroborating signal, never as a substitute. Document the distinction in the analytics bounded context.

**Warning signs:**
- API response field named `dealer_gamma` populated from COT data
- COT "publication date" displayed without the "as-of date"
- COT job polling more than once per week

**Phase to address:**
COT adapter phase. The verification criterion is an API integration test that asserts the response includes both `as_of_date` (Tuesday) and `published_at` (Friday), and that the field name does not use the word "gamma."

---

## Known Morai Domain Gotchas (Do Not Regress)

### Gotcha 1: SPX OI = 0 — SPY Proxy Scaled ×10.048

**What goes wrong:**
The Schwab chain API and CBOE chain data return `open_interest = 0` for SPX index options in some contexts (particularly outside CBOE's settlement window). GEX computation requires OI. Substituting SPY options OI as a proxy is valid but requires the correct scale factor: SPY notional ≈ SPX / 10.048. GEX levels computed from SPY OI must be multiplied by 10.048 before comparing to SPX-denominated levels.

**Prevention:**
The GEX computation path must check for SPX OI = 0 and apply the SPY proxy + scale factor, not fail silently. The scale factor 10.048 is a named constant in the `analytics` bounded context, not a magic number. A property test asserts that GEX computed from SPX OI and from scaled SPY OI agree within 1% on test fixtures.

**Phase to address:**
Any phase that touches GEX computation. Regression test already documented; do not remove it.

---

### Gotcha 2: CBOE Timestamp is UTC, Not ET

**What goes wrong:**
CBOE's delayed chain API returns timestamps in UTC. The previous Phase 2 bug stored these as ET, causing all CBOE-sourced observations to appear 4–5 hours early in the journal. Snapshot logic that compares "is this snapshot within the 30-minute RTH window" used ET thresholds; UTC timestamps passed the check outside market hours.

**Prevention:**
All timestamp ingestion from external APIs (CBOE, Schwab, COT) normalizes to UTC immediately at the adapter boundary. The journal schema stores all timestamps as `timestamptz`. UI display converts to ET. Any new adapter that ingests timestamps must include a timezone assertion in its integration test.

**Phase to address:**
All adapter phases. The sidecar must confirm Schwab stream timestamps are UTC (they are; confirm in the streaming integration phase).

---

### Gotcha 3: GEX Put-Sign Regression

**What goes wrong:**
In v0.4 of the GEX computation, put open interest contribution was multiplied by -1 in only one of three calculation conventions (shares, dollars-per-$1, dollars-per-1%). The other two treated puts identically to calls. This meant net GEX could never go negative, permanently reporting LONG-GAMMA even during short-gamma regimes.

**Prevention:**
The property test `puts always contribute negative gamma exposure; net GEX must be able to go negative` must remain green on every commit that touches the GEX computation. Do not modify or delete this test. Any refactor of GEX computation starts by running this test in isolation to confirm it's still failing for the broken case.

**Phase to address:**
Any phase that refactors analytics. The test is a non-negotiable gate; it is not optional even during streaming integration.

---

### Gotcha 4: Postgres 65,534-Parameter Insert Limit

**What goes wrong:**
Postgres rejects any single prepared statement with more than 65,534 bind parameters. A full SPX option chain observation (thousands of strikes × columns per row) exceeds this limit in a single batch insert. Phase 2 hit this when inserting the CBOE chain; the fix was to chunk inserts at 2,000 rows.

**Prevention:**
Any new table that receives chain-scale data (e.g., a streaming tick log if one is added later) must use the 2,000-row chunk helper. The chunk size is a named constant. A unit test inserts 3,000 rows and asserts it succeeds without a Postgres error.

**Phase to address:**
Any phase that writes bulk data to Postgres. The sidecar's REST chain snapshot path (used for journal gap-fill) hits this on a full SPX chain insert and must use the chunked helper.

---

## Scope / Over-Engineering Traps

### Trap 1: Adding a Message Broker

**What goes wrong:**
The fan-out pattern (one upstream Schwab stream → N browsers) looks like a textbook message broker problem. Engineers reach for Redis Pub/Sub, NATS, or Kafka to mediate between the sidecar and the TS server. This adds a fourth infrastructure dependency, a third language runtime concern, and a new failure mode (broker down = no stream even when Schwab is healthy).

**Prevention:**
For one trader and one upstream stream, the sidecar writes to an in-memory last-known-value map and exposes a single internal HTTP endpoint (`/internal/stream`) that the TS server reads via SSE or HTTP streaming. No broker. The TS server does its own fan-out to N browser clients. This is the correct scope for v1.1. A broker is a revisit trigger only if there are multiple sidecar instances or multiple simultaneous stream consumers.

**Phase to address:**
Sidecar scaffold phase. Record the broker-deferral in `stack-decisions.md` as D-NEW.

---

### Trap 2: Streaming the Full Chain

**What goes wrong:**
With a streaming connection established, it feels natural to subscribe to the full SPX chain to power GEX in real time. This conflicts directly with Pitfall 1 (symbol cap), adds no value for the journal (which uses 30-minute snapshots), and introduces a new data model problem (streaming OI vs. daily OI). GEX from streaming is also methodologically wrong: OI is only updated once per day by the exchanges; streaming tick updates are bid/ask/last, not OI changes.

**Prevention:**
GEX remains a batch analytics job that runs against the nightly CBOE chain or a scheduled Schwab REST snapshot. The stream is for position marks only. This constraint is documented in the sidecar's API contract and in `docs/architecture/jobs.md`.

**Phase to address:**
Sidecar scaffold phase (API contract design).

---

### Trap 3: Building UI in This Milestone

**What goes wrong:**
The streaming endpoint is tempting to wire up to a React component "just to see it working." This pulls in UI work (TanStack Query, component design, chart integration) that belongs in the UI-rebuild milestone. Each UI component added in v1.1 creates merge conflicts with the planned UI-rebuild milestone and increases the scope of v1.1 testing.

**Prevention:**
v1.1 deliverable is data + backend + contracts only. The verification gate is API + MCP reachability, not browser rendering. The SSE/WS endpoint is tested with `curl` or a minimal Node.js subscriber, not a React component.

**Phase to address:**
All v1.1 phases. The out-of-scope boundary is in PROJECT.md; any PR adding `.tsx` component files to `apps/web` during v1.1 is a merge blocker.

---

### Trap 4: Second Auth System

**What goes wrong:**
The sidecar needs to call back to the TS server (to write last-known-value, to report health). Some implementations add a separate API key or JWT between the sidecar and the server, creating a second auth system alongside Supabase Auth. This key then needs rotation, storage, and documentation.

**Prevention:**
Sidecar ↔ TS server communication is on Railway's private network (internal DNS). No auth between internal services. The sidecar's `/internal/*` endpoints are bound only to the private network interface, not exposed on the public port. Railway's internal network is the auth boundary.

**Phase to address:**
Sidecar scaffold phase. Verify that `RAILWAY_PRIVATE_DOMAIN` is used for sidecar ↔ server communication in the deployment checklist.

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification Criterion |
|---------|-----------------|----------------------|
| Streamer symbol cap | Auth-migration + sidecar scaffold | Subscription list derived from positions table; symbol count logged and asserted <20 |
| Dual-refresher race | Auth-migration (dedicated phase) | TS refresh job removed from pg-boss schedule; concurrency test: 2h run, only sidecar refresh events in logs |
| 7-day headless re-auth | Auth-migration + sidecar scaffold | Re-auth endpoint smoke test; CBOE fallback confirmed when Schwab auth expired |
| Python monorepo drift | Sidecar scaffold | CI: 4 lanes pass (TS typecheck, TS lint, Python mypy, Python ruff); env-var checklist deliverable |
| Streamer connection lifecycle | Sidecar scaffold + streaming integration | Advisory lock test; reconnect jitter config in code; health probe wired to TS server |
| SSE auth + backpressure | TS server fan-out | JWT not in Railway logs; memory stable under 10-minute test with one stalled client |
| Write amplification | Sidecar scaffold + streaming integration | `calendar_snapshots` schema unchanged; no streaming inserts to snapshot table |
| COT misinterpretation | COT adapter | API response has `as_of_date` + `published_at`; no field named `*gamma*` in COT response |
| SPX OI=0 / SPY proxy | Any GEX-touching phase | Property test: SPX and scaled-SPY GEX agree within 1% |
| CBOE UTC timestamp | All adapter phases | Integration test: timezone assertion on every new external-data adapter |
| GEX put-sign | Any analytics-touching phase | Property test: net GEX can go negative; test not deleted or modified |
| 65,534-param limit | Any bulk-insert phase | Unit test: 3,000-row insert succeeds; chunk constant named |
| Message broker scope creep | Sidecar scaffold | No Redis/NATS/Kafka in `package.json` or `pyproject.toml`; stack-decisions entry |
| Full-chain streaming | Sidecar scaffold | API contract: stream subscription is position-legs only; no chain-REST-to-stream path |
| UI in v1.1 | All v1.1 phases | No new `.tsx` component files in `apps/web` during v1.1 PRs |
| Second auth system | Sidecar scaffold | Sidecar internal endpoints use Railway private DNS; no API key between sidecar and server |

---

## Sources

- schwab-py authentication documentation: https://schwab-py.readthedocs.io/en/latest/auth.html
- schwab-py streaming documentation: https://schwab-py.readthedocs.io/en/latest/streaming.html
- Schwab Developer Portal — OAuth restart vs refresh token: https://developer.schwab.com/user-guides/apis-and-apps/oauth-restart-vs-refresh-token
- Schwabdev issue #28 — stream crash within 90 seconds: https://github.com/tylerebowers/Schwabdev/issues/28
- schwab-py issue #100 — access token not refreshing: https://github.com/alexgolec/schwab-py/issues/100
- The Unofficial Guide to Charles Schwab Trader APIs: https://medium.com/@carstensavage/the-unofficial-guide-to-charles-schwabs-trader-apis-14c1f5bc1d57
- CFTC COT release schedule: https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm
- Node.js backpressure in streams: https://nodejs.org/learn/modules/backpressuring-in-streams
- Secure EventSource SSE authentication patterns: https://openillumi.com/en/en-eventsource-auth-header-solution/
- Railway monorepo deployment: https://docs.railway.com/deployments/monorepo
- uv Docker integration: https://docs.astral.sh/uv/guides/integration/docker/
- Morai project history: `docs/tos-studies-learnings.md`, `docs/iv-engine-discrepancy-and-solver.md`, project MEMORY.md (Phase 2 production lessons, Phase 5-6 review lessons)

---
*Pitfalls research for: schwab-py sidecar + streaming + SSE fan-out in hexagonal Bun/TS monorepo*
*Researched: 2026-06-25*
