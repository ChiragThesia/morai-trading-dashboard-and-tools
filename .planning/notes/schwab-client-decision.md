---
title: Schwab client — vendored TS vs schwab-py sidecar vs @sudowealth/schwab-api
date: 2026-06-21
context: Phase 4 UAT found the vendored chain adapter 502s on the live $SPX chain; explored whether to adopt a library.
status: decided (revisit @sudowealth later — see trigger)
---

# Schwab client decision

## TL;DR

The live chain **502 is a missing-query-param bug, not a missing-library bug.** Fix the
vendored TS adapter with scoping params now. **Reject** the Python `schwab-py` sidecar.
Keep **`@sudowealth/schwab-api`** (a real full TS client) as a deliberate *future* option,
adopted cautiously (low maturity) — not now.

## Root cause of the 502

Schwab's API gateway returns `502 TooBigBody` ("Body buffer overflow") when the response
is too large. Requesting `$SPX&contractType=ALL` with no narrowing returns the entire SPX
chain (20k+ contracts) → overflow. Any client (TS or Python) that makes the unscoped call
gets the same 502. `schwab-py` avoids it only by always sending scoping params.

## The fix (option A — do now)

`packages/adapters/src/schwab/market/chain-adapter.ts` (~L165-167) — add bounding params:

```ts
url.searchParams.set("symbol", deps.symbol);   // "$SPX" (confirmed correct; SPX/$SPX.X → 400)
url.searchParams.set("contractType", "ALL");
url.searchParams.set("strikeCount", "50");     // bound strikes around ATM
url.searchParams.set("range", "NTM");          // near-the-money
url.searchParams.set("fromDate", todayIso);    // bound expirations (YYYY-MM-DD)
url.searchParams.set("toDate", todayPlusNIso);
```
Mirror however the CBOE adapter already bounds its pull; values should serve the journal's
tracked calendars. SPX nuance: `$SPX` returns AM+PM-settled; `SPXW` is weeklys — value choice.

## Options compared

| | A. Fix vendored TS | B. @sudowealth/schwab-api (TS) | C. schwab-py Python sidecar |
|---|---|---|---|
| Fixes 502 | ✅ (3-4 params) | ✅ | ✅ |
| Long-term robustness | ⚠️ own all edge cases | ✅ market + trader coverage | ✅ (for Python) |
| Integration cost | ✅ ~zero | 🟡 medium | ❌ high (2nd service+lang+IPC) |
| Fits TS hexagon | ✅ | ✅ (Bun-native, save/load callbacks) | ❌ breaks single-stack |
| Token security | ✅ pgcrypto stays sole owner | ✅ callbacks → broker_tokens adapter | ❌ dup pgcrypto in Python (violates D-03) or neuter lib |
| Maturity | n/a | ⚠️ 11★, 1 maintainer, <13mo | ✅ mature (Python only) |

## Why reject the Python sidecar (C)

- Can't ease the **weekly re-auth** — Schwab's 7-day refresh-token expiry is server-side and
  hard; no client beats it (confirmed).
- Doesn't fix the 502 better than 3 params do.
- Token-ownership conflict: either re-implement pgcrypto token crypto in Python (key now in
  two services — violates locked D-03) or strip schwab-py to a dumb HTTP wrapper behind a
  network hop. Worst fit for a deliberately single-stack swap-friendly hexagon. AUTH-01
  chose "vendored, not heavy SDK" — a Python SDK in its own service is the heaviest reading.

## @sudowealth/schwab-api (B) — the only worth-it "adopt"

Real full TS client: OAuth code flow + market data (option chains with scoping) + trader
(accounts/orders/transactions). Bun-compatible. `save(tokens)`/`load()` persistence callbacks
slot behind the existing encrypted `broker_tokens` adapter (D-01/02/03 preserved). MIT, clean
deps, no postinstall. **Caveat: 11 stars / single maintainer / <13 months — real vendor risk.**
Adopt only behind the ports, version-pinned, with a human-verify install gate.

## Revisit trigger

Evaluate adopting `@sudowealth/schwab-api` **when hand-maintaining the Schwab trader endpoints
becomes painful, or before scaling beyond one account.** Until then: vendored TS + the param fix.

## Sources

- schwab-py get_option_chain params: https://schwab-py.readthedocs.io/en/latest/client.html
- schwab-py auth / 7-day limit: https://schwab-py.readthedocs.io/en/latest/auth.html
- Schwab OAuth restart vs refresh (7-day hard): https://developer.schwab.com/user-guides/apis-and-apps/oauth-restart-vs-refresh-token
- Apigee 502 TooBigBody: https://docs.apigee.com/api-platform/troubleshoot/runtime/502-toobigbody
- @sudowealth/schwab-api: https://www.npmjs.com/package/@sudowealth/schwab-api · https://github.com/sudowealth/schwab-api
