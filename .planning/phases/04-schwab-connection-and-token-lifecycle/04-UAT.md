---
status: testing
phase: 04-schwab-connection-and-token-lifecycle
source: [04-VERIFICATION.md]
started: 2026-08-31T23:05:00Z
updated: 2026-08-31T23:05:00Z
---

## Current Test

number: 1
name: Real Railway deployment with Schwab credentials set, and Hypercorn access-log confirmation
expected: |
  The Railway web service boots with `schwab_credentials` populated (no RuntimeError from
  `Settings.schwab_credentials`), a real `/schwab/connect` + `/schwab/callback` round-trip
  against Schwab succeeds, and Hypercorn's access-log line for that request does not
  contain the query string.
awaiting: user response

## Tests

### 1. Real Railway deployment with Schwab credentials set, and Hypercorn access-log confirmation

expected: The web service boots with `schwab_credentials` populated, one real OAuth
round-trip succeeds, and Hypercorn's access log never renders the callback's query string.

why human: An in-process `ASGITransport` test cannot start a real Hypercorn server and so
cannot observe its access log. Recorded as Manual-Only in `04-VALIDATION.md` across all four
plans — disclosed from the start, not discovered late. Setting the Railway secrets is also
inherently out-of-band: `preserve()` keeps a value that is already set; it cannot create one.

steps:
  1. Set `SCHWAB_API_KEY`, `SCHWAB_APP_SECRET`, `SCHWAB_CALLBACK_URL` on the Railway `web`
     service (also `MORAI_APP_DB_PASSWORD` and `MORAI_MASTER_KEY` if still unset — see the
     Phase 2 deferred items, which unblock from the same action).
  2. `railway config apply`, then confirm the web service boots and passes its healthcheck.
  3. Run one real `/schwab/connect` → `/schwab/callback` round-trip.
  4. Inspect the Hypercorn access log for that request; confirm no query string appears.

result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
