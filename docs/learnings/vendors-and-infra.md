# Vendors and infrastructure

Every trap in something we did not write. Organised by vendor.

Each entry gives the trap, the tell, and the workaround.

**Everything in this file is conditional on that vendor still being in use.** Swap the
vendor and the entry becomes history. The stack-independent laws these traps taught are
in [LAWS.md](LAWS.md) and are cross-referenced where they apply.

---

## Schwab

### V001. The refresh token expires 7 days after issuance. Nothing extends it.

**Trap.** Server-side, hard, no sliding window. Using the access token does not extend it. Refreshing does not extend it. No client library, language or SDK changes this — confirmed while evaluating a mature Python SDK as a replacement.

**Tell.** `invalid_grant`, exactly 7 days after the last full re-authorization.

**Workaround.** Build re-authentication as a permanent operational requirement, not a bug. Vendor-dependent jobs pause on `invalid_grant` rather than crashing, a distinct status flag surfaces in both the UI and the machine-readable status endpoint, and one app's expiry never blocks the other. The re-auth path itself was iteratively lowered in friction — ending at an in-app hosted OAuth wizard — because the ceiling recurs weekly and every point of friction compounds on that cadence. One operational step is easy to miss after a successful re-auth: the sidecar reads its tokens once at container boot, not on file change, so a freshly seeded token needs `railway redeploy --service sidecar -y` before anything uses it.

**Source.** `docs/architecture/stack-decisions.md` D16; `.planning/notes/schwab-client-decision.md`; `docs/architecture/jobs.md`.

### V002. Two processes refreshing the same rotating token invalidate each other inside one cycle.

**Trap.** The vendor invalidates the old refresh token on every refresh. Two independent refreshers against one storage row orphan each other's cached token.

**Tell.** `invalid_grant` within a single 30-minute cycle, with no expiry in sight.

**Workaround.** Architectural, not a distributed lock. Exactly one process owns the token's whole lifecycle. Because the vendor also allows only one active streaming session, token ownership and session ownership were made the same process by construction, removing the second writer entirely. See [L051](LAWS.md#l051-isolate-a-vendor-that-demands-single-process-ownership-in-its-own-service).

**Source.** `docs/architecture/stack-decisions.md` D16, D22.

### V003. The chain endpoint accepts only the literal `$SPX`.

**Trap.** `SPX`, `SPXW` and `$SPXW` all return 400 `Check Param Values`. One `$SPX` call returns both SPX and SPXW contracts.

**Tell.** A 400 that the error handler will happily relabel as an auth failure. Five days of debugging went to the token while the token was fine. See [L034](LAWS.md#l034-never-collapse-every-non-200-to-one-error-code).

**Workaround.** Send `$SPX`. Live-probed: `symbol=$SPX&strikeCount=2` returns 200.

**Source.** `.planning/debug/resolved/chain-frozen-schwab-symbol.md`.

### V004. An unbounded strike ladder returns 502 before auth or parameter validation runs.

**Trap.** Even with the correct symbol, a wide expiry window with no `strikeCount` overflows Schwab's own API gateway body-size limit: 502, `Body buffer overflow` / `TooBigBody`.

**Tell.** A 502 that looks unrelated to the 400 in V003 but is the same request-shaping problem.

**Workaround.** `strikeCount=50` is the empirically verified value that fits. Live probes: `strikeCount` 150, 200 and 300 all return 502; `strikeCount=50` returns 200 at 4.08-4.4MB. Widening the call further is a dead end — see [R024](refuted.md#r024-widen-the-single-schwab-chain-call-to-cover-the-full-strike-range).

**Source.** `.planning/debug/resolved/chain-frozen-schwab-symbol.md`; `.planning/notes/schwab-client-decision.md`.

### V005. The narrow window does not just miss data. It biases the derived risk metric in a known direction.

**Trap.** A `strikeCount=50` window spans roughly ±125 points around at-the-money. The far-OTM put open interest it drops carries real gamma mass. Nothing errors — the fetch succeeds, rows are written.

**Tell.** A distorted derived output that only a domain expert notices. Measured: GEX put wall 7455 / flip 7360 — an inverted, atypical put-wall-above-flip relationship — against the prior full-chain CBOE snapshot's 7475 / 7495. The flip moved 135 points overnight purely from the source switch, not the market. The narrow window also missed 6 of 8 open position legs, gapping journal marks.

**Workaround.** Dual-source. Fetch the narrow-but-fresh Schwab call *and* the full-width delayed CBOE feed every cycle and union them per contract, newest wins. They are complementary, not primary and fallback. A healthy market token therefore means both run.

**Source.** `.planning/debug/resolved/chain-window-narrow-regression.md`; `docs/architecture/jobs.md`; `packages/core` chain-source selection.

### V006. `accounts[0]` is not the trading account.

**Trap.** Array order in a multi-account response is not a documented contract.

**Tell.** The account resolver read an empty account (72130768) instead of the real one (76363972, holding $18.9k, YTD +$1,486 — realized +$653, unrealized +$833).

**Workaround.** Pin the target explicitly with a `SCHWAB_ACCOUNT_NUMBER` environment variable.

**Source.** `.remember` 2026-08-17.

### V007. The trader API needs the resolved account hash, never the raw account number.

**Trap.** Passing the account number fails.

**Workaround.** Resolve `hashValue` via `GET /accountNumbers` first.

**Source.** `packages/adapters` Schwab account-hash resolver.

### V008. `transferItems[].amount` is signed. Do not take its absolute value.

**Trap.** Positive means contracts received or bought; negative means delivered or sold. The `cost` sign in the same item corroborates it independently — negative cost is a debit, a buy.

**Tell.** Downstream code guessing direction from `positionEffect` or a record's status column. See [L023](LAWS.md#l023-mathabs-on-a-vendors-signed-amount-destroys-the-only-field-carrying-direction) and [L022](LAWS.md#l022-read-a-directional-signal-once-at-its-authoritative-source-never-re-derive-it-from-mutable-app-state).

**Workaround.** Carry the sign through every pipeline layer as an explicit field. The fixture pins the convention: an OPENING row with `amount:1, cost:-1250.00`, a CLOSING row with `amount:-1, cost:800.00`.

**Source.** `packages/adapters` Schwab transactions adapter and fixture.

### V009. `quote.quoteTime` is null for INDEX symbols.

**Trap.** `get_quotes` on `$`-prefixed index symbols returns `assetMainType: "INDEX"` with a correct live `lastPrice`, and a null `quoteTime`.

**Tell.** Freshness logic that reads the vendor's own timestamp field silently gets nothing.

**Workaround.** Stamp the event's timestamp at receipt, UTC with a `Z` suffix. Verified live 2026-07-13 around 16:55Z across `$VIX`, `$VVIX`, `$VIX9D`, `$VIX3M` and `$SPX` — for example `$VIX | type: INDEX | lastPrice: 17.17 | closePrice: 15.03`.

**Source.** Phase 38 probe.

### V010. The fills API can return a null payload.

**Trap.** Null is a fetch failure, not "no new fills".

**Tell.** The journal goes stale silently and positions orphan. Three verdicts ended up unlinked to any real position.

**Workaround.** Detect the null case explicitly and switch to a per-run reconciliation window. See [L036](LAWS.md#l036-a-null-vendor-payload-is-a-fetch-failure-not-no-new-data) — the same missing guard was found four days later in a different module consuming the same job's data.

**Source.** `.remember` 2026-07-10, 2026-07-14.

### V011. Open interest reads zero outside regular trading hours.

**Trap.** Every contract comes back with `openInterest: 0` when queried outside regular hours. Those are real zeros from a real successful call.

**Tell.** Measured in production: 0.0% of contracts carried non-zero OI between 04:00Z and 10:00Z, against 86.3% non-zero from 10:30Z onward. With a newest-row-wins dedup across two vendor feeds, a zero landing a minute after the good feed's write zeroes roughly 2,971 contracts per day and nulls both GEX walls.

**Workaround.** `MAX(open_interest) OVER (PARTITION BY contract)` over a 10-minute union window, so a stale-but-non-zero value always beats a fresh zero. See [L013](LAWS.md#l013-a-window-function-evaluates-before-distinct-use-that-to-max-one-column-while-newest-row-wins-the-rest) and [L045](LAWS.md#l045-latest-is-not-best-the-newest-row-can-be-a-placeholder-zero).

**Conflict.** A standing regression gate from an earlier milestone says SPX index options report OI = 0 *always*, with SPY × ~10.048 used as a proxy. That contradicts the 86.3% measurement. Reconcile before rebuilding either behavior. See [D042](domain-trading.md#d042-spx-index-options-report-open-interest-as-zero-the-workaround-was-an-etf-proxy).

**Source.** `docs/calendar-engine/current-state.md`; `plans/analyzer-chain-HANDOFF.md`.

### V012. A 401-refresh branch that skips the retry counter loops forever.

**Trap.** In a retry-with-backoff HTTP client, the special-cased "401, refresh once, then retry" path did not increment the same attempt counter the normal loop used. If the refresh itself fails, retries continue on a confirmed-stale token, uncapped.

**Tell.** Unbounded retries in exactly the failure mode that most needs a hard stop.

**Workaround.** Route the auth-refresh branch through the same attempt counting and backoff capping as ordinary retries.

**Source.** `knowledge-base/calendar-trade-dashboard-learnings.md`.

### V013. The Python sidecar serializes UTC as `+00:00`, not `Z`.

**Trap.** A TypeScript Zod schema accepting only the `Z` form rejects it. No clear validation error surfaced.

**Tell.** The symptom looked like a data-source fallback bug. The cause was a cross-language ISO-8601 assumption never pinned to one canonical form at the service boundary. It routed the pipeline to the degraded secondary source for days while every health check stayed green. See [L047](LAWS.md#l047-verify-data-provenance-not-just-a-health-endpoint).

**Workaround.** Pin one canonical serialization at the boundary and test it there. The contract test for this boundary was green throughout. Its fixtures were hand-written with a trailing `Z`, and its assertion only checked that the field was a string — so it tested neither the producer's real output nor Zod's actual grammar. Fixed at the producer with `.isoformat(timespec="milliseconds").replace("+00:00","Z")` (commit a6a6893) and at the test by asserting against the real grammar. Same class as P002.

**Source.** `.remember` 2026-06-28; `.planning/RETROSPECTIVE.md`.

### V014. `schwab-py` is pinned at exactly 1.5.1.

**Trap.** The pin carries an explicit instruction never to upgrade without a research review.

**Source.** `apps/sidecar/requirements.txt`.

### V015. Schwab's quote symbol format is structurally OCC. Reuse the codec.

**Trap.** Writing a second symbol codec invites a second set of parsing bugs.

**Workaround.** Delegate to the existing OCC formatter rather than duplicating it.

**Source.** `packages/adapters` Schwab market symbol module.

### V069. The authorization code expires in about 30 seconds. Auto-capture beats a paste flow.

**Trap.** A two-step "copy this code, paste it here" exchange routinely loses the race against the code's own expiry.

**Workaround.** A login flow that auto-captures the redirect in the same browser session. That was what made the CLI re-auth reliable, and the reasoning carried forward into the in-app wizard.

**Source.** `.planning/RETROSPECTIVE.md`.

### V078. There is no news endpoint on the Trader API.

**Trap.** ThinkorSwim shows a Dow Jones, MT Newswires and Benzinga feed, which reads as evidence that the API exposes one. That feed is licensed for display in the terminal only. Neither `pyschwab` nor `schwab-py` can reach it.

**Workaround.** A separate vendor. Alpaca's news API carries the same Benzinga wire — see [V026](#v026-alpaca-news-relays-benzinga-headlines-only-article-bodies-are-deliberately-off) for what it does and does not include.

**Source.** Project memory, news feed build 2026-07-24.

---

## CBOE

### V016. CBOE timestamps are UTC, not Eastern.

**Trap.** The reasonable assumption is that a US options vendor stamps Eastern time. It does not.

**Tell.** Applying an ET→UTC conversion shifted every stored timestamp by the offset — observed as a systematic −4h shift in production.

**Workaround.** Parse `YYYY-MM-DD HH:MM:SS` with a `Z` suffix directly. Production-verified 2026-06-12 and carried forward as a standing regression gate across three milestones. The belief this replaced is [R001](refuted.md#r001-cboe-timestamps-are-eastern-time-and-need-conversion).

**Source.** `packages/adapters` CBOE HTTP adapter; `.planning/STATE.md` regression gates.

### V017. `SPX` is a literal prefix of `SPXW`.

**Trap.** A naive `startsWith("SPX")` pulls the whole weekly book into the monthly book.

**Workaround.** Require `startsWith("SPX")` **and not** `startsWith("SPXW")`. See [L001](LAWS.md#l001-a-composite-key-missing-a-true-discriminator-silently-drops-30-50-of-every-batch) for what the two books colliding costs downstream.

**Source.** `packages/adapters` CBOE HTTP adapter.

### V018. CBOE is delayed but full-width. Run it every cycle regardless.

**Trap.** Treating it as a fallback rather than a complement loses the strike breadth that GEX needs. See V005.

**Workaround.** CBOE always runs; Schwab runs additionally when its token is fresh or stale.

**Source.** `packages/core` chain-source selection.

### V019. CBOE sends open interest correctly. Do not blame the adapter.

**Trap.** A root cause inferred from reading adapter code — spotting an `optional() ?? 0` fallback and concluding the vendor omits the field — was wrong, and a migration was built to fix a field that was never broken.

**Tell.** One `curl` of the public endpoint settles it: 21,320 contracts non-zero, 78.7% non-zero.

**Workaround.** Check the wire before the code. See [P020](process-and-verification.md#p020-a-root-cause-read-off-the-code-is-a-hypothesis-a-root-cause-read-off-the-wire-is-a-finding).

**Source.** `plans/analyzer-chain-HANDOFF.md`.

---

## FRED

### V020. A series id can diverge permanently from the index's public name.

**Trap.** CBOE renamed its 3-month vol index from VXV to VIX3M in September 2017. FRED still serves it as `VXVCLS`.

**Tell.** Live-verified 2026-07-09: `fredgraph.csv?id=VXVCLS` returns 200 with 4,852 daily rows current to the prior trading day. `VIX3M`, `VIX3MCLS` and `VXV` all return 404.

**Workaround.** Verify every series id with a direct live fetch. Never derive it from the ticker or branding.

**Source.** `.planning/research/STACK.md`.

### V021. A plausible-sounding series id can simply not exist.

**Trap.** `VIX9DCLS` looks like a natural sibling to `VIXCLS` and `VXVCLS`. It is not a real FRED series — it was a hallucinated identifier during indicator research.

**Tell.** HTTP 404, and absent from FRED's own category listing.

**Workaround.** Same as V020: resolve the id against the live API before admitting an indicator to any evidence table. The real VIX9D came from CBOE's delayed-quote endpoint instead. See [R016](refuted.md#r016-vix9dcls-is-a-fred-series).

**Source.** Phase 24 review and verification.

### V022. The missing-value sentinel is the literal string `.`.

**Trap.** The value field is a string, and a gap is a period, not null or an empty string.

**Source.** `packages/adapters` FRED HTTP adapter.

---

## CFTC / Socrata

### V023. Every numeric field comes back as a JSON string.

**Source.** `packages/adapters` CFTC HTTP adapter.

### V024. The `_all` suffix is inconsistent across field families.

**Trap.** `_all` applies to `dealer`, `nonrept` and `open_interest`, but **not** to `asset_mgr`, `lev_money` or `other_rept`.

**Tell.** A mismatch fails Zod silently and errors the whole job. Verified against the live dataset 2026-07-01.

**Workaround.** Encode the exact per-field convention in the schema. Related: `asOf` must be the date *part* of the timestamp, never date arithmetic. Never send an `X-App-Token` header.

**Source.** `packages/adapters` CFTC HTTP adapter.

### V025. The contract code is `13874A`, not `13874+`.

**Trap.** One character pulls a different dataset with no error. `13874A` is the E-mini leg-level code; `13874+` is the consolidated code TradingView displays.

**Tell.** A comparison against TradingView's COT display looks like a data-quality divergence. It is a code-scope mismatch — plus roughly a one-week lag on the TradingView side.

**Workaround.** Pin both sides to the same code and the same report cadence before comparing anything.

**Source.** `packages/adapters` CFTC HTTP adapter; `.remember` 2026-07-31.

---

## Alpaca

### V026. Alpaca News relays Benzinga headlines only; article bodies are deliberately off.

**Trap.** `include_content` stays off on the free tier by design. Headlines and summaries only.

**Source.** `packages/adapters` Alpaca news adapter.

---

## Supabase, Supavisor and Postgres

### V027. Supavisor silently strips a connection-string `statement_timeout`.

**Trap.** A startup parameter set on the connection string is dropped by the pooler. The query is effectively unbounded regardless of what the connection says.

**Tell.** A job timed out at 120s while the worker was configured for 600s.

**Workaround.** Issue `SET LOCAL statement_timeout = '…'` inside the transaction, wrapped around the query (commit 8c6b56b). The startup-parameter form is invisible in tests. A direct Postgres connection — a testcontainer, say — honours `statement_timeout` passed on the connection string, so the local suite proves the wrong thing; only the pooled production URL drops it. Both forms were probed live against production and both still timed out at 120s: the postgres.js `connection: {}` object and the libpq `?options=-c` query parameter. The first fix (commit b52c49b, a `statementTimeoutMs` startup parameter in `makeDb`) was a complete no-op and jobs kept dying at 120s for another cycle. `SET LOCAL` is pooler-proof because it reverts at COMMIT, so it cannot leak into the next session the pooler hands out.

**Source.** `.remember` 2026-07-20.

### V028. The transaction pooler cannot do LISTEN/NOTIFY, advisory locks, or prepared-statement reuse.

**Trap.** One database exposes two endpoints. The PgBouncer transaction-mode pooler drops session state between statements, so session semantics do not survive it.

**Tell.** The job queue's coordination and the migration runner's stable-session requirement both fail on the pooled URL.

**Workaround.** Carry two connection strings by design, permanently. The direct/session URL is mandatory for the worker and the migrator. The pooled URL is optional and safe only for stateless read-path queries that never touch LISTEN/NOTIFY or locks. The reason the session pooler is mandatory rather than merely preferred: Supabase's direct Postgres host resolves IPv6-only and Railway has no outbound IPv6, so the direct URL is physically unreachable from the worker. Port 5432 on the pooler host is session mode; 6543 is the transaction pooler and breaks migrations and pg-boss.

**Source.** `docs/architecture/stack-decisions.md` D18; `docs/architecture/jobs.md`.

### V029. An advisory lock survives a crashed process. It needs a timeout plus a heartbeat.

**Trap.** A crashed or redeployed process leaves the lock held. Advisory locks do not auto-release on connection loss the way you hope under pooling.

**Tell.** A permanently blocked single-writer service, cleared only by manual `pg_terminate_backend`.

**Workaround.** `idle_session_timeout` so a dead session is eventually reaped, plus an application heartbeat, so a stale lock self-heals (commit 5c17a60; pid 1501696 killed manually before the fix; verified against a pooler reap test afterward). Numbers, since the shape recurs. One zombie lock — key 8876543210 — lived two days. The fix set `idle_session_timeout` to 60s on the lock session with a 20s `SELECT 1` heartbeat, so a live holder stays alive and an abandoned one self-reaps. Supavisor really does reap idle session-mode connections, proven by taking a dummy lock (key 8876543299) with `idle_session_timeout = 5s` through the live production pooler and watching it go. The failure is intermittent: one sidecar redeploy needed a guarded `pg_terminate_backend` on a connection older than 300s, and the next rolled over cleanly on its own in about 40 seconds.

**Source.** `.remember` 2026-06-28; `apps/sidecar/advisory_lock.py`.

### V030. Cap every pool. Supavisor's session pooler stops at 15 clients.

**Trap.** Several services each opening an uncapped pool against the same pooled endpoint sum past the hard ceiling under a connection burst. Whichever component loses the race gets starved.

**Tell.** A cluster of unrelated-looking symptoms at once. One mechanism produced five: a crashed API server, a silently failing token-refresh write (so the chain returned empty), frozen chain ingestion, frozen BSM and GEX compute, and failing COT fetches. Independently reproduced against the same DSN: `EMAXCONNSESSION: max clients are limited to pool_size: 15`.

**Workaround.** Cap every pool so total demand fits under the ceiling with margin — server 4+2, worker 4+3, roughly 13 against 15 — not raise the ceiling, which only delays recurrence, and not chase each symptom. Verified live: the chain resumed with 28,402 new rows the same day, GEX advanced, and the BSM backlog drained.

**Source.** `.planning/debug/resolved/market-data-pipeline-stalled.md`.

### V070. Drizzle's error wrapper drops the underlying Postgres error before it reaches a job log.

**Trap.** Drizzle wraps a failed query in its own `Failed query` error. The `cause` carrying the real Postgres error — including code `57014`, statement timeout — does not survive pg-boss's JSON serialization of the job output. The stored failure message says nothing useful.

**Tell.** Read the job's `started_on` and `completed_on` instead. A death at exactly 120s is a timeout kill, not a crash. Confirm with a live `pg_stat_activity` watch: the same query ran in 3.5ms hot and blew the cap on a cold cache.

**Workaround.** Never diagnose a repeating job failure from its stored error message alone. Time the deltas first.

**Source.** Project memory, BSM statement-timeout fix.

### V083. `postgres.js` hands back `timestamptz` as Postgres text through a raw query.

**Trap.** A raw query returns `2026-06-12 13:31:38.031+00` — not a `Date`, and not strict ISO. Zod's `.datetime()` rejects it.

**Workaround.** Normalize to ISO with a `Z` suffix at the repository boundary, before any contract parse. Same canonical-form discipline as [V013](#v013-the-python-sidecar-serializes-utc-as-0000-not-z).

**Source.** `packages/adapters` repository read paths; project memory, Phase 2.

---

## pg-boss

### V031. An unlistened `error` event kills the process.

**Trap.** pg-boss recovers from a pooler blip on its own. Node's rethrow of an unlistened `error` event pre-empts that recovery.

**Workaround.** Attach a listener in every composition root, even one that only logs. Full mechanism and cost in [L033](LAWS.md#l033-an-eventemitter-error-event-with-no-listener-kills-the-process).

**Source.** `docs/architecture/deployment.md`.

### V032. `schedule()` upserts on `(name, key)`, not on name alone.

**Trap.** Looks like a name collision; is not.

**Workaround.** Schedule the same job name at several cadences by varying the `key` option. No distinct job names needed. A hand-rolled fake `boss` in tests will not model the upsert, so the suite stays green while production silently keeps only the second schedule. Assert on the `(name, key)` pairs the code registers, not on the number of `schedule()` calls it made.

**Source.** `.planning/RETROSPECTIVE.md`.

### V033. `retry_delay: 0` still looks like a 15-minute backoff.

**Trap.** The observed ~15-minute gap between failure and retry has nothing to do with the configured backoff. A stuck job is only marked failed once the maintenance cycle notices it has run past `expire_seconds` (900s default). The configured immediate retry then fires right after that detection. A redeploy produces the same gap and is not a retry at all. Killing a long-running handler mid-flight — deploying the worker while the BSM drain is running — surfaces as `job timed out` and a roughly 15-minute wait, costing one stale computation cycle. Deploy between cycles when cycle freshness matters.

**Tell.** Reading the gap as configured backoff sends debugging to the wrong knob entirely.

**Source.** `docs/architecture/jobs.md`.

### V034. The 900s handler cap is a hard design constraint, not a tuning value.

**Trap.** Any handler whose work grows with history will eventually cross it.

**Tell.** `handler execution exceeded 900s`, retry_count exhausted, zero forward progress.

**Workaround.** Two patterns, both proven here. Bound the batch and commit per batch, sized so worst-case overshoot stays under the cap — see [L016](LAWS.md#l016-commit-each-bounded-batch-in-its-own-transaction-exit-ok-on-budget-exhaustion-and-resume-for-free-off-the-pending-predicate). Or move the work out of the queue entirely into an operator CLI — see [L018](LAWS.md#l018-a-bulk-history-scan-belongs-in-an-operator-cli-not-a-timeout-capped-queue-handler).

**Source.** `.planning/debug/resolved/market-data-pipeline-stalled.md`; `docs/architecture/jobs.md`.

### V077. A local worker pointed at the live queue is a second consumer of real jobs.

**Trap.** pg-boss has no notion of a development consumer. A worker started locally against the production connection string competes for, fetches and completes real scheduled jobs.

**Workaround.** For read-only UI verification run the server and web app only, never the worker. Where a local worker is genuinely needed, give it its own database.

**Source.** Project memory, UAT standing permissions.

### V086. A scheduled job's `data` arrives as `null`, not `{}`.

**Trap.** A cron fire delivers `job.data = null`. Any handler parsing its payload strictly throws on every single fire, forever, while a manual trigger of the same handler works fine.

**Workaround.** Type the handler as `Job<unknown>` and parse `job.data ?? {}`. This has bitten at least three handlers here — `sync-fills` twice and the hourly journal self-heal. Related on the vendor side: [L036](LAWS.md#l036-a-null-vendor-payload-is-a-fetch-failure-not-no-new-data).

**Source.** Project memory, Phase 40-41 journal repair.

---

## Railway

### V035. A git push silently SKIPs a service whose watch paths it did not touch.

**Trap.** In a multi-service monorepo, a cross-cutting push can leave one service running a stale image while the dashboard looks healthy.

**Tell.** Nothing. A SKIP is not a failure. Hit across four separate phases (v1.0 phase 8; v1.1 phases 11, 14, 15).

**Workaround.** Force `railway up --service <name>` per service after any cross-cutting change, and verify the running image, not the push event. The success line is not necessarily the first line. `railway up` can print the real deployment's SUCCESS row *underneath* an unrelated SKIPPED row from a git-push event, so reading the top row misreports a good deploy as skipped. Grep for the deployment id.

**Source.** `.planning/RETROSPECTIVE.md`; `.planning/MILESTONES.md`.

### V036. `railway up` reports `commitHash: null`. Prove deploy identity by timestamp.

**Trap.** You cannot read which commit is running off the deploy record.

**Workaround.** Correlate the deploy's `createdAt` against the last known commit's push time. Both services landed fresh SUCCESS at 2026-07-03T19:19Z, after the last phase-15 commit — that correlation is what proved the stale-image gap was closed. One tempting shortcut does not work: the presence of a newly-added response key is a false-positive build marker. `refreshExpiresIn` appeared in the payload of the *stale* build too, because the field predated the fix being verified. Timestamp correlation is the only proof.

**Source.** `.planning/STATE.md` Phase 16; `.planning/MILESTONES.md`.

### V037. `railway domain` is not a read command. It provisions a domain as a side effect.

**Trap.** Even scoped with `--service`, calling it against a service with no domain creates one. Using it to *check* exposure exposes an internal service.

**Tell.** A public domain on a service that must not have one. This re-broke a locked security gate during a verification step.

**Workaround.** Never run it against a service that must stay private. Verify domain state through the dashboard or the GraphQL API. Recovery from the accident required a GraphQL domain delete. To find a service's existing public URL without provisioning one, grep it out of the deployed frontend's JS bundle. That is how `server-production-f5ca2.up.railway.app` was recovered.

**Source.** `.planning/STATE.md` Phase 16; `.remember` 2026-07-03; `.planning/MILESTONES.md`.

### V038. `bun run migrate` locally validates the full worker composition root.

**Trap.** The migration script imports and validates every service's config on boot, not just the database connection.

**Tell.** "Just run the migration" fails on an unrelated missing environment variable (`SIDECAR_URL`).

**Source.** `.planning/RETROSPECTIVE.md`.

### V039. The sidecar needs Hypercorn, not uvicorn, for Railway's health check.

**Trap.** Railway needs an IPv4 health check and an IPv6 private network. Hypercorn dual-stack binds `[::]`; uvicorn cannot from the CLI.

**Source.** `apps/sidecar/requirements.txt`.

### V071. `railway logs` streams forever unless `-n` is given, and deadlocks any pipe.

**Trap.** Without `-n`, the command tails indefinitely. Piping that into `head` hangs the shell rather than returning.

**Workaround.** Always pass `-n <count>` for a bounded historical fetch: `railway logs -n 200 -f <filter>`.

**Source.** Project memory, BSM statement-timeout fix.

### V079. `railway variables --set` does not restart the service.

**Trap.** The variable is stored; the running process keeps the environment it booted with. The service goes on logging "keys unset" against a variable that is visibly present in the dashboard.

**Workaround.** `railway redeploy --service <name> --yes` afterwards, and confirm it took — one redeploy attempt was silently ineffective and only the second one landed.

**Source.** Project memory, news feed build 2026-07-24.

### V082. `railway up` cannot archive a directory containing a unix socket.

**Trap.** The deploy tars the working tree. A live socket file left behind by a local dev daemon cannot be tarred, and the deploy fails on something no source change explains.

**Workaround.** A committed `.railwayignore` excluding every tool-generated and untracked directory — here `.codegraph/`, `graphify-out/`, `.planning/`, `mockups/`, `plans/` and `node_modules`.

**Source.** Project memory, Phase 19 execution.

---

## Vercel

### V072. A Production-scoped environment variable makes every preview deployment unbootable.

**Trap.** Variables scoped to Production only are absent from preview builds. The app throws at boot, so a pull request's own preview URL cannot be opened at all — there is nothing to UAT against.

**Tell.** `Uncaught Error: supabaseUrl is required` on the preview URL while production is healthy.

**Workaround.** Scope the required variables to Preview in the dashboard. Until that is done, verification means merging in a low-risk window and walking production directly — which is exactly the review gap previews exist to close.

**Source.** Project memory, chain browse-and-pair UAT.

The web app deployed there, but the project's deploy-discipline lessons
([V035](#v035-a-git-push-silently-skips-a-service-whose-watch-paths-it-did-not-touch),
[V036](#v036-railway-up-reports-commithash-null-prove-deploy-identity-by-timestamp),
[P027](process-and-verification.md#p027-deploy-debt-compounds-an-undeployed-alert-surface-protects-nothing))
came from Railway.

---

## Recharts

Adopted deliberately to end the hand-rolled-SVG overflow bug class
([L080](LAWS.md#l080-a-real-charting-library-kills-the-overflow-bug-class-structurally)).
It brought its own traps. Verified against recharts 3.9.2.

### V040. A `<Customized>` child paints before every zIndex band, whatever its JSX position.

**Trap.** A bare custom child renders its whole tree before every zIndex band — Line and ReferenceLine share one band, Area and Bar a lower one — regardless of JSX order. An arbitrary non-preset zIndex value silently renders nothing at all.

**Tell.** Marks meant to sit on top render underneath, with no error.

**Workaround.** Give the custom layer an explicit preset zIndex matching the band it needs, then use JSX order only to tiebreak inside that band. Breakeven markers and edge arrows were moved into a zIndex layer placed after the wall reference lines; 18 `compareDocumentPosition` regression tests pin it.

**Source.** Phase 33 review and fix.

### V041. `ReferenceLine` silently vanishes off-domain unless `ifOverflow="hidden"` is set.

**Trap.** The default `ifOverflow="discard"` renders nothing at all — not even a clipped element. That is a regression from a hand-rolled SVG with `overflow: visible`, which at least drew a partial line past the plot bounds as a signal.

**Workaround.** Set `ifOverflow="hidden"` explicitly on every reference line whose value can legitimately fall outside the domain (fixed in commit bdda9ca, with tests asserting an off-domain line still renders a structurally-clipped element).

**Source.** Phase 33 review.

### V042. An explicit `domain` does not clip. The axis silently widens to fit outliers.

**Trap.** Default `allowDataOverflow={false}` stretches the rendered domain to include any out-of-range point rather than clipping at the stated domain. That defeats a locked domain-fitting requirement more subtly than a hardcoded range would.

**Workaround.** Set `allowDataOverflow={true}` per axis to get true clipping and the automatic clipPath that replaces hand-rolled clamps.

**Source.** Phase 33 research, pitfall 3.

### V043. `XAxis` defaults to a categorical band scale.

**Trap.** Without `type="number"`, points are placed at evenly-spaced band centres keyed by index, not by value — silently reordering or unevenly spacing continuous data that does not already sit on exact grid steps.

**Workaround.** Always set `type="number"` plus an explicit domain for a continuous axis (spot price, strike, DTE). Relying on `auto` reintroduces a hardcoded-domain-shaped bug class.

**Source.** Phase 33 research, pitfall 2.

### V044. `position="insideBottom"` on a zero-height segment renders the label above the line.

**Trap.** For a `ReferenceLine` segment whose two points share a y value, `insideBottom` computes `y − offset` — above the line, anchored at the end — the opposite of what the name suggests. `bottom` computes `y + height + offset`, which for a zero-height segment is `y + offset`: below the line, as intended.

**Tell.** A bracket label flipping from 16px below the line to roughly 5px above it after migration. Traced through the installed library's own Cartesian-position and Label sources (default offset 5).

**Workaround.** Use `position="bottom"` with an explicit offset for a zero-height bracket label.

**Source.** Phase 33 review.

---

## Tailwind

### V084. Tailwind cannot see a class name you build by string interpolation.

**Trap.** The scanner reads source text at build time. `bg-${tone}` matches nothing, so the utility is never generated and the element renders unstyled. No error at build or at runtime — the same silence as [L078](LAWS.md#l078-a-deleted-utility-class-fails-silently-only-a-lint-rule-catches-it) on a deleted class.

**Workaround.** An explicit lookup map from the variant value to the full literal class name. Never interpolation.

**Source.** Project memory, Phase 21 button system.

---

## Bun

### V080. Bun's server closes an idle connection after 10 seconds.

**Trap.** The default `idleTimeout` is 10s. Any server-sent-events stream with a gap between events longer than that is killed by the server itself, which reads on the client as a flaky network.

**Workaround.** Set `idleTimeout: 255` on the server and send a heartbeat well inside it — the sidecar's ping moved from 25s to 5s (commit 17bda79).

**Source.** Project memory, Phase 12 livestream cascade.

---

## Vitest

### V085. `singleFork: true` limits processes, not files. Test files still run concurrently.

**Trap.** `pool: "forks", singleFork: true` reads as serialization and is not. Files still run in parallel inside that one process. Any suite whose `beforeEach` does `TRUNCATE … CASCADE` on a shared database then wipes fixtures another file has just inserted — passing when run alone, failing only in the full suite.

**Tell.** Row counts that drop mid-run (5,000 → 3,000) and reads returning null for data the test just wrote.

**Workaround.** Set `fileParallelism: false` explicitly, and always run the full suite as the gate. A per-file run cannot reproduce this class by construction.

**Source.** Project memory, Phase 3 execution.

---

## TradingView: Pine Script

### V045. A ternary or computed symbol argument demotes `request.security()` to a series string.

**Trap.** The symbol argument must be a simple string. Any computed expression makes it a series. The editor reports **zero errors**. The script dies only when added to a chart, with a bare "cannot compile script" — no line number, no message, an empty pane and a red marker.

**Tell.** A study that renders nothing on chart while the editor says it is clean.

**Workaround.** Pass a plain `input.symbol(...)` value straight through. Never a fallback ternary on the symbol string. Paid for twice.

**Source.** `tools/tradingview/vol-state.pine`; `tools/tradingview/breadth.pine`.

### V046. `dynamic_requests = false` turns that whole class of silent death into a compile error.

**Trap.** A non-const symbol argument compiles and runs on historical bars, then throws on the first live bar if that path was never exercised historically.

**Workaround.** Declare `dynamic_requests = false` on the `indicator()` call. The failure becomes a hard compile error, permanently. Call `request.security()` once per literal candidate string and ternary-select between the resulting floats afterward — implemented as six separate calls in the expected-move study.

**Source.** `tools/tradingview/expected-move.pine`.

### V047. A daily series requested at `timeframe.period` returns `na` on any intraday chart.

**Workaround.** Request the literal string `"D"`.

**Source.** `tools/tradingview/vol-state.pine`.

### V048. Indexing the output of `request.security()` shifts by chart bars, not by sessions.

**Trap.** `term[termLb]` on a 30-minute chart shifts `termLb` chart bars — 2.5 hours — not `termLb` sessions. The same applies to accumulators: `ta.cum()` computed on the outer series adds the same daily value roughly 13 times per session on a 30m chart, and the line looks plausible while being garbage.

**Workaround.** Do the shift and the accumulation **inside** the `request.security()` call, as part of the security expression.

**Source.** `tools/tradingview/vol-state.pine`; `tools/tradingview/breadth.pine`.

### V049. `lookahead_off` returns the last *completed* daily bar. Use `close[1]` with `lookahead_on`.

**Trap.** On a Friday evening, `lookahead_off` hands back Thursday's close — verified at 17.09 against a real Friday close of 15.99. `lookahead_on` alone leaks the future into history and corrupts anything plotting history or backtesting.

**Tell.** Caught live 2026-08-21 at 14:38 ET: a bare `close` + `lookahead_off` version read that day's still-forming VIX1D at 9.86 instead of the prior close at 12.31, producing a band 20% narrower than designed.

**Workaround.** `close[1]` **with** `lookahead_on`. Because the requested bar has already closed, this gives the same number replaying history or running live — unlike plain `close` + `lookahead_off`, which silently starts serving the forming daily bar the moment the chart goes realtime. After the fix, sigma reconciled at 0.6148% in-script against 0.6147% plotted.

**Source.** `tools/tradingview/vol-state.pine`; `tools/tradingview/expected-move.pine`.

### V050. `for i = 0 to size(arr) - 1` on an empty array executes. It does not skip.

**Trap.** Pine's `for` is bidirectional. On an empty array the upper bound is −1 and the loop runs, counting down from 0.

**Workaround.** Guard every loop over a possibly-empty array with an explicit `if array.size(arr) > 0`.

**Source.** `tools/tradingview/gamma-levels.pine`.

### V051. Drawing objects created per bar exhaust their budget by garbage collection, never by error.

**Trap.** Pine collects the oldest object rather than raising anything. Objects quietly vanish off the left of the chart.

**Workaround.** Gate every line, label and box on `barstate.islast`, and delete-then-recreate rather than accumulate. Declared caps in the gamma-levels study: 10 lines, 16 labels, 30 boxes, with the pusher's zone limit held at 24 to stay under the box cap.

**Source.** `tools/tradingview/gamma-levels.pine`; `tools/tradingview/push-gex.ts`.

### V052. `time_close(timeframe.period, spec, tz)` returns the current bar's close, not the session's end.

**Trap.** Used as the denominator of an elapsed-session fraction it collapses to exactly 1.0 on every regular-hours bar.

**Tell.** The panel read "100% elapsed, 0% variance left" from the opening bell and printed ±0.00 all day. It never surfaced pre-market, because outside regular hours the row correctly says pre/post. Cost a live session to find.

**Workaround.** Hand-parse the session-spec string — substring `0930` and `1600` out of `0930-1600` — to compute true session start and end.

**Source.** `tools/tradingview/expected-move.pine`.

### V053. A futures-root prefix match needs a `syminfo.type == "futures"` guard.

**Trap.** Without it, `str.startswith(ticker, "ES")` quietly matches Essex Property Trust (ESS) and hands it the S&P's volatility index. No error of any kind.

**Source.** `tools/tradingview/expected-move.pine`.

### V054. A regular-hours-only series needs `plot.style_linebr` and `na` outside the session.

**Trap.** `plot.style_line` with a non-`na` value outside the session bridges the overnight gap with a diagonal, which reads as a trend line that does not exist.

**Source.** `tools/tradingview/expected-move.pine`.

### V055. A level far from spot forces autoscale to fit it and flattens the candles.

**Tell.** Measured 2026-08-05: the near-term call wall sat at 8000 against spot 7729, +3.5% away.

**Workaround.** Do not draw a level beyond a configurable percent distance from spot — list it in a status readout instead — and set the price scale to "Scale price chart only".

**Source.** `tools/tradingview/gamma-levels.pine`; `tools/tradingview/README.md`.

### V056. `σ` is not a legal Pine identifier.

**Source.** Project memory, TradingView expected-move work.

### V089. A `var` assigned only inside a session guard is stale everywhere outside it.

**Trap.** A `var` written only under `if inSession` holds whatever it last held — which, pre-market, is a value from the previous session or the one before that. The script reads correctly during regular hours and lies at every other time.

**Tell.** An anchor holding a close from two sessions back at 06:00 ET. The band mid read 7710.9 against a real prior close near 7647.

**Workaround.** Ask what every session-guarded `var` holds at 06:00 before shipping. The fix here was `float refClose = inRth ? priorClose : lastClose`, which moved the mid to 7644.8.

**Source.** `tools/tradingview/expected-move.pine`.

---

## TradingView: desktop, MCP and CDP

### V057. Three failed compiles ban the script from compiling for one hour.

**Trap.** A scheduled push that rewrites Pine source and recompiles will eventually trip this on a bad cycle. A 30-minute republish loop is exactly the shape that does.

**Workaround.** With CDP access to your own chart, set the running indicator's **input** value directly. That skips compilation entirely. This is legal only because you own the chart session — a published-script author selling to strangers must rewrite and republish source. See [R026](refuted.md#r026-rewrite-and-recompile-the-pine-source-on-every-scheduled-push).

**Source.** `tools/tradingview/README.md`; `tools/tradingview/push-gex.ts`.

### V058. Setting an indicator input over CDP does not persist. Send Cmd+S.

**Trap.** The change lives only in the rendered chart. A reload or app restart reverts to the last saved layout, dropping the pushed value silently — while it stays visibly correct on screen in the meantime, which makes the loss easy to miss.

**Workaround.** Send Cmd+S immediately after every successful set.

**Source.** `tools/tradingview/README.md`; `tools/tradingview/push-gex.ts`.

### V059. `pine_open` fuzzy-matches a title prefix and can return a different script.

**Trap.** Asked for one study by name and got another, because both shared a naming prefix. Separately, `pine_new` does not rebind the UI editor, so the next compile saves your code over the wrong script — the internal API and the UI editor point at different scripts simultaneously. `pine_smart_compile`'s `has_errors: false` is a false negative, and pressing Enter in the save dialog mints a blank script instead of saving.

**Tell.** A study's code appearing under another study's name. One incident saved new code as an unrelated study at a wrong version, requiring a restore.

**Workaround.** Read the UI title back before any save. Use a Save-As-style flow rather than trusting `pine_new` to isolate a fresh script.

**The title check is not sufficient. This supersedes the workaround above.** `pine_set_source` writes into the internal API's buffer for whichever script `pine_open` matched, while the visible editor stays bound to a different one. The editor title can read correctly the whole time and the buffer underneath still hold another script's source; the save then commits that buffer, and "MORAI · Expected Move" was published as v2 containing Breadth's code with the correct title showing. The only valid guard is reading the buffer *content* back and matching a unique string from the source you meant to inject — a reported `lines_set: 392` says nothing about where the lines landed. Two facts from the same work: the editor retains whatever script was last opened across sessions and even across days, so a session that never called `pine_open` can still be pointed at a live study; and the reliable repair after a clobber is the script-name dropdown's Version history, Restore this version, then Save, because re-injecting the source travels the same unreliable path that caused the clobber.

**Source.** Project memory, TradingView studies rebuild and expected-move work; `.remember` 2026-08-05.

### V060. A ticker resolving in symbol search does not resolve in `request.security()`.

**Trap.** The search index and the Pine resolver disagree on real symbols. CFTC data needs the **bare** symbol — a `COT:` prefix returns `na`, and inconsistently across the same series family. `USI:ADVN` and `USI:DECN` do not resolve on this account while the pre-differenced `USI:ADD` does. Same family, different answer. `request.quandl()` compiles in v6 and is dead at runtime: the study renders nothing and raises no error.

**Workaround.** Probe every symbol with a real `request.security()` call or a live quote read showing a fresh timestamp. Never trust search. 20 of 22 tickers passed a live probe on the real chart.

**Source.** `tools/tradingview/README.md`; `tools/tradingview/breadth.pine`; `.remember` 2026-07-31.

### V061. TradingView silently aliases an unentitled symbol to a substitute.

**Trap.** No error anywhere. `CBOE:SPX` needs an index entitlement this account lacks and silently aliases to `SPCFD:SPX`. `CBOE:VIX` resolves to the delayed `CBOE_DLY:VIX` feed.

**Tell.** Only by reading back the actually-resolved symbol and feed type, never the string passed in. A related session-boundary trap: `SPCFD:SPX` showed Thursday's session (VIX 17.09) while the live session was Friday (16.00), which reads as staleness but is the CFD's own session alignment. `SP:SPX` was the tested fix direction.

**Source.** `tools/tradingview/README.md`; `tools/tradingview/watchlists-calendar.md`; `.remember` 2026-07-31.

### V062. The watchlist API reports false failures and false successes. Only a screenshot is ground truth.

**Trap.** Four separate lies, all confirmed:

- `watchlist_add_bulk` returns `added_as` reporting only the resolved **first leg** of a multi-symbol expression. Sending `CBOE:VIX3M/CBOE:VIX` reports `added_as: "TVC:VIX"`. The expression stores correctly; the field is simply wrong.
- The same call reported one symbol as failed. It landed. False negative.
- `watchlist_get` returns `{count: 0, source: "empty"}` for a populated list once the chart or DOM context has switched. It reads the DOM and loses the container reference. Not a wipe.
- Creating a list through the UI does not reliably move the active-list pointer. 13 symbols landed in the wrong list.

**Workaround.** Confirm by screenshot, and click the target list explicitly before any bulk add.

**Source.** `tools/tradingview/watchlists-calendar.md`.

### V063. On macOS the debug port only survives a Terminal-owned process.

**Trap.** `nohup` dies with the spawning shell. `open -a --args` fails differently: LaunchServices silently reuses a running instance and drops the debug-port flag, so any running instance must be quit first — there is no way to add a debug port to a live process. TradingView also self-relaunches on auto-update and comes back without the flag.

**Workaround.** A Terminal window that owns the process directly, left open, output redirected to a log file, never sent Ctrl-C. A backgrounded Bash launch also held the port open in a separate confirmed observation — the failure was `nohup` specifically, not backgrounding in general.

**Source.** `tools/tradingview/README.md`; `tools/tradingview/push-gex.ts`; `.remember` 2026-07-31.

### V087. TradingView carries no option-chain data at all.

**Trap.** No option contract resolves in any format — OCC, TradingView-style, dotted. There is no OPRA exchange on the platform and `window.TradingView` exposes no option-related keys.

**Tell.** Every public gamma-exposure Pine script on the platform hardcodes its levels into an `input.text_area()` string the author repastes by hand each week. That is the whole field, not a shortcut somebody took.

**Workaround.** Compute off-platform and push the levels in. There is no alternative to go looking for. See [L101](LAWS.md#l101-build-on-someone-elses-surface-only-what-your-own-surface-cannot-do) for what is worth pushing and what is not.

**Source.** Project memory, TradingView bridge research.

### V088. An open modal swallows every subsequent tool call and still reports success.

**Trap.** A leftover dialog — an "Open my script" picker left standing — absorbs clicks and source injections. The tool results come back `success: true` and nothing happened.

**Workaround.** Probe `document.querySelector('[role="dialog"]')` before trusting any UI-driving result. Same false-success family as [V062](#v062-the-watchlist-api-reports-false-failures-and-false-successes-only-a-screenshot-is-ground-truth).

**Source.** Project memory, TradingView expected-move work.

### V090. A dead index feed renders as an ordinary current number.

**Trap.** `CBOE:SKEW` last ticked on 2022-11-25 and still displays a plausible value, with no staleness cue anywhere in the interface.

**Tell.** Only the feed's own last-tick timestamp. Plausibility is not a check.

**Workaround.** Read the timestamp on every index symbol before admitting it to a watchlist or a study. `NASDAQ:SDEX` replaced SKEW here. Two neighbours from the same audit: `DSPX` does not exist on TradingView at all — search returns only Goldman warrants — and `CBOE:SPX` silently aliases to `SPCFD:SPX` on an account with no CBOE index entitlement, see [V061](#v061-tradingview-silently-aliases-an-unentitled-symbol-to-a-substitute).

**Source.** `tools/tradingview/watchlists-calendar.md`.

---

## ThinkorSwim

### V064. Recursive variables initialize to 0, not NaN, so an `IsNaN()` latch never fires.

**Trap.** "This should be NaN until first assignment, so check `IsNaN` to detect an unset state" silently fails. The guard looks correct in review and fails only at runtime.

**Workaround.** Latch on `0` instead — ratios and prices are never legitimately zero.

**Source.** `docs/tos-studies-learnings.md`.

---

## The Claude Code harness

### V065. WebFetch summarizes before handing text to the model, and pads the gap with plausible domain knowledge.

**Trap.** Fluent, wrong output. One extracted file invented a strike ladder for a worked example the source never gave. Two supplied numeric constants — 252 trading days, 15.9 as an annualization divisor — that appear nowhere in the source.

**Tell.** Repeated round constants appearing identically across sections written independently. Audit the whole corpus for suspicious constants, not unit by unit — see [P024](process-and-verification.md#p024-an-extract-longer-than-its-source-has-something-added-audit-constants-corpus-wide).

**Workaround.** Download the corpus as raw text (curl plus local text extraction) and rewrite from that. 59 articles, 103,078 words re-downloaded; 5 of 10 modules rewritten locally; rewritten sections held to 60-83% of their source article's length.

**Source.** `docs/research/predicting-alpha-ultimate-guide-to-selling-options.md`; `.remember` 2026-07-28.

### V066. CDP cannot sever an SSE connection.

**Trap.** The "stream went quiet" failure mode is untestable with the standard browser-automation toolkit.

**Workaround.** A purpose-built initScript-wrapped EventSource harness, invented mid-UAT. Budget for it rather than discovering it during a review gate.

**Source.** `.planning/RETROSPECTIVE.md`, Phase 12.

### V067. Browser automation cannot set a React-controlled input by assigning `.value`.

See [L082](LAWS.md#l082-setting-value-on-a-react-controlled-input-is-silently-ignored). Dispatch real input events instead.

### V068. Named server-sent events never reach `onmessage`.

**Trap.** An event carrying an explicit `event: <name>` field goes only to `addEventListener(name, handler)`. Setting `es.onmessage` receives nothing. Pure spec behavior, easy to get backwards when adding a new named lane to an existing connection.

**Workaround.** Register the named listener. A related rule from the same work: do not set connection status inside `onerror` — let a heartbeat interval own status.

**Source.** Phase 38 patterns.

### V073. macOS has no `timeout`.

**Trap.** Any gate script, retry proof or bounded run written against GNU coreutils fails on this machine.

**Workaround.** Two that work. Background the process and poll with `kill -0 <pid>` when you need to observe it — that is how the database-outage retry loop in [L032](LAWS.md#l032-three-failure-classes-need-three-different-responses-one-blanket-trycatch-is-worse-than-none) was proven, by bringing the database up mid-retry and watching the worker reach "19 queues created" with no restart. Or call the command bare and let the Bash tool's own `timeout` parameter bound it.

**Source.** Project memory, worktree execution notes and crash 2026-07-23 verification.

### V074. A worktree-isolated executor forks from `origin/main`, not from local HEAD.

**Trap.** Agents run with worktree isolation branch from the remote. Any commit sitting unpushed on local main is invisible to them, and the base-mismatch guard fails the run with exit 42.

**Workaround.** `git push origin main` immediately before dispatching each wave. Related, from the same toolchain: `worktree.cleanup-wave` self-blocks in a permanent loop, because its SUMMARY-rescue step copies the worktree's `SUMMARY.md` into the main checkout as an untracked file and its own merge then fails on "untracked working tree files would be overwritten". Deleting the file does not help — the next run recreates it. Merge by hand with `git merge --no-ff` after checking `git merge-base` against the expected base, then run the cleanup tail only.

**Source.** Project memory, worktree execution gotchas.

### V075. A research subagent can die mid-response, and a stale same-named file hides it.

**Trap.** Three of four researcher subagents failed on first spawn with `API Error: Connection closed mid-response` and wrote nothing. A completeness check that only asks whether the expected files exist passes anyway, because the previous milestone's files sit at the same paths under the same names.

**Workaround.** Check file mtimes, not file presence, then re-spawn the dead agents with identical prompts. The retries succeeded.

**Source.** Project memory, v1.2 milestone start.

### V076. The milestone-close CLI mangles state. Hand-finish both files, every time.

**Trap.** Two closes, two different failures, one tool. At v1.1 the stats query computed over *all* phases — 9 phases and 74 plans belonging to a previous milestone — for a 6-phase milestone, and reset `STATE.md` frontmatter to those stale numbers. At v1.2 the stats were right but the milestone header rendered literally as `## v1.2 v1.2` with no name lookup, the frontmatter took a garbage `current_phase` and a regressed `stopped_at`, and the roadmap and requirements files were left un-collapsed despite being listed workflow steps. Separately, `state.planned-phase` no-ops after a milestone switch because the new frontmatter lacks the field its matcher expects, and the executor's own state write then regresses the progress block to the previous milestone's numbers.

**Workaround.** Treat the CLI's output as a draft. Read `STATE.md` frontmatter and `MILESTONES.md` back after every phase and every close.

**Source.** Project memory, v1.1 and v1.2 milestone closes; GSD state-drift notes.

### V081. `EventSource`'s built-in reconnect replays the ticket you already spent.

**Trap.** With single-use auth tickets, the browser's native reconnect retries the same consumed ticket. The result is a permanent 401 on a connection whose whole design assumed it would self-heal.

**Workaround.** Close the `EventSource` inside `onerror`, mint a fresh ticket, and reconnect manually with backoff (commit 6b52bca). See [L083](LAWS.md#l083-authenticate-an-sse-stream-with-a-short-lived-opaque-ticket-never-a-jwt-in-the-query-string) for why the ticket is single-use in the first place.

**Source.** Project memory, Phase 12 livestream cascade.

---

## macOS and iCloud Drive

### V091. A repo inside a synced folder gets silent duplicate files, and one can reach git history.

**Trap.** iCloud Drive syncs `~/Desktop` and `~/Documents` by default. When two writers touch the same path — two machines, or one machine racing the sync daemon — iCloud does not merge and does not error. It keeps both versions and renames one by appending ` 2` before the extension. Build tools and index caches, which write constantly, produce these by the hundred.

Measured in this repo: 116 collision artifacts in the working tree, plus a `codegraph 2.lock` through `codegraph 14.lock` series — thirteen abandoned, sync-collided index runs. Three families: 13 empty ` 2` directories, 30 ` 2` directories inside `node_modules`, and 73 ` 2.*` files, nearly all `.d.ts` under `dist/`.

The damage is not the wasted bytes — 200 KiB total. It is that **one collision got committed**: `.planning/phases/37-.../37-REVIEW 2.md`. Once tracked, git replicated it into all eleven agent worktrees on every checkout. The mechanism outran the cleanup and entered history, where deleting the working copy cannot reach it.

**Tell.** Any file or directory whose basename ends in ` 2`, or contains ` 2.` before the extension. Confirm the cause two ways:

```
ls -d ~/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop
xattr ~/Desktop        # com.apple.file-provider-domain-id
```

**Workaround — bandaid.** Delete them and add the pattern to `.gitignore`:

```
* 2
* 2.*
```

Verify no tracked file matches before adding it, or the rule silently ignores real work:

```
git ls-files | grep -E '(^|/)[^/]* 2(\.[^/]*)?$'
```

This treats the symptom. The artifacts return, because the cause is the filesystem.

**Workaround — real fix.** Move the repository off the synced volume. Three things break, all recoverable:

1. **Worktree registrations.** Git stores absolute paths, so every linked worktree breaks at once. Run `git worktree repair <paths>` from the new location and pass the paths explicitly — a bare `git worktree repair` fixes the main worktree's record as seen from linked worktrees, not the stale absolute paths in `.git/worktrees/*/gitdir`.
2. **Hardcoded paths**, most often hook commands in `.claude/settings.json`. Grep for the old path before moving.
3. **The Claude Code project key.** Claude Code derives its per-project directory from the working-directory path with `/` replaced by `-`. Move the repo and it computes a new key, finds nothing, and starts with empty memory. The old memory is not deleted — it is orphaned under a key nothing looks up any more. Rename the directory under `~/.claude/projects/` to the new derived key in the same sitting as the move, then open a session in the new path and confirm the memory index loads.

Do the move **after** any large cleanup. Pushing gigabytes through a sync daemon is slow and can itself collide.

**A second-order trap worth stating separately.** Backups do not escape this by being in a different folder. A backup directory created on the same synced Desktop produced its own collision — two `.bundle` files with different checksums, one silently stale. A backup on the volume you are protecting against is not a backup.

**Source.** Measured in this repo 2026-08-25 to 2026-08-29; `37-REVIEW 2.md` is the committed instance.
