# Phase 13: COT Adapter - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-28
**Phase:** 13-cot-adapter
**Areas discussed:** Data source mechanism, Report type + fields, History depth, Refresh timing

---

## Data Source Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Direct CFTC Socrata API (TS) | TS adapter hits publicreporting.cftc.gov behind ForFetchingCotReport; mirrors FRED adapter; no Python | ✓ |
| Python sidecar + cot-reports | Add cot-reports lib to schwab-py sidecar; worker calls sidecar REST | |

**User's choice:** Direct CFTC Socrata API (TS)
**Notes:** Keeps COT in the TS worker, consistent with FRED. Avoids coupling an unrelated data feed to the streaming sidecar.

---

## Report Type + Fields

| Option | Description | Selected |
|--------|-------------|----------|
| TFF — store all trader classes | Dealer / Asset Mgr / Leveraged Funds / Other / Non-Reportable long+short + OI; net derived in API | ✓ |
| Legacy — commercial/non-commercial | Matches success-criteria field names literally but coarser | |

**User's choice:** TFF — store all trader classes
**Notes:** Leveraged Funds = hedge-fund positioning, the real "big guys" signal for index futures. Success-criteria's legacy net_noncommercial/net_commercial names reconcile to TFF net-per-class in the API.

---

## History Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Backfill ~3 years on first run | ~156 weekly rows; chartable trend immediately | |
| Current week only | 1 row first run, +1/week | ✓ |
| Backfill ~5 years | ~260 weekly rows | |

**User's choice:** Current week only
**Notes:** History accrues week-by-week. Keeps first run trivial; backfill deferred.

---

## Refresh Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Fri 17:00 ET + read report date | Cron after the 15:30 release; as_of from report's own date field (holiday-safe) | ✓ |
| Sat AM + as_of = pub − 3d | Simpler but brittle on holiday weeks | |

**User's choice:** Fri 17:00 ET + read report date
**Notes:** as_of = report's own Tuesday date field; published_at = fetch timestamp; idempotency on as_of week.

---

## Claude's Discretion

- Exact migration column names/types, Socrata pagination + query params, fetch error/empty handling (follow FRED fallback convention), retry policy, in-memory twin shape.

## Deferred Ideas

- Historical backfill (later operator task if a deep trend chart is needed).
- COT for other instruments (E-mini S&P 500 only this phase).
- Overview COT UI panel (consumes get_cot; later UI pass, not this backend phase).
