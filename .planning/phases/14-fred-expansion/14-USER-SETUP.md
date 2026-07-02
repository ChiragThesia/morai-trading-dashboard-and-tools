# Phase 14: User Setup Required

**Generated:** 2026-07-02
**Phase:** 14-fred-expansion
**Status:** Incomplete

Complete this item for the 7-series FRED macro fetch (MAC-01) to run in production.
Claude automated everything else — the macro adapters, use-cases, worker wiring, and
twice-daily cron are all shipped and covered by tests. This env var is the one thing
that requires a human with access to the FRED account dashboard and the Railway project.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `FRED_API_KEY` | https://fredaccount.stlouisfed.org/apikeys — request/copy your API key | Railway `WORKER` service env vars, and local `.env` |

**Note (D-13):** the user provided this key in-session during phase discussion, but it
was deliberately NOT stored in any repo file — set it directly on the Railway `WORKER`
service and in your local `.env`.

**Note (D-09):** unlike the existing DGS3MO→BSM rate fetch (which silently falls back to
a 4.5% default when this key is absent, D-02, unchanged), the new macro fetch (7 FRED
series + VVIX) HARD-REQUIRES this key — with it unset, `fetch-rates` will throw on every
run and pg-boss will mark the job failed. This is expected until the key is set.

## Verification

After setting `FRED_API_KEY`:

```bash
# Local: confirm the var is present
grep FRED_API_KEY .env

# Railway: confirm the var is set on the worker service
railway variables --service worker | grep FRED_API_KEY
```

Then, at the next scheduled `fetch-rates` run (09:00 or 18:30 ET, Mon-Fri) or via a
manual trigger, confirm no `lastErr` appears for `fetch-rates` in `/api/status` and that
`macro_observations` has fresh rows for all 8 series (`DFF, DGS1MO, DGS3MO, SOFR,
T10Y2Y, T10Y3M, VIXCLS, VVIX`).

Expected results:
- `/api/status` shows no `lastErr` for `fetch-rates`.
- `macro_observations` table has rows for today's date across all 8 series.

---

**Once complete:** Mark status as "Complete" at top of file.
