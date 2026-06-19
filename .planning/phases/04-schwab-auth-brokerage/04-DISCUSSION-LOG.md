# Phase 04: Schwab Auth & Brokerage - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 04-schwab-auth-brokerage
**Areas discussed:** Token encryption & key mgmt, auth setup OAuth capture, Schwab vs CBOE chain priority, AUTH_EXPIRED degradation

---

## Token encryption & key management (AUTH-02)

| Option | Description | Selected |
|--------|-------------|----------|
| App-level AES-256-GCM, key in env | Encrypt blob in adapter; key from env, rotateable; DB-agnostic | |
| Postgres pgcrypto (DB-side) | Encrypt/decrypt via pgcrypto; key supplied at query time | ✓ |
| Supabase Vault | Managed secret store; vendor lock-in | |

**User's choice:** Postgres pgcrypto (DB-side)
**Notes:** User first asked why tokens are stored at rest at all. Clarified: they are credentials to call *Schwab's* API (not Morai's own auth); background jobs run unattended so the refresh token must persist; encrypt at rest because a leaked DB = brokerage account takeover. Constraint added (D-03): the symmetric key must NOT live in the DB — app passes it at query time from a secret, kept out of query logs.

---

## auth setup OAuth capture (AUTH-01/03)

| Option | Description | Selected |
|--------|-------------|----------|
| Loopback listener auto-captures | Temp localhost server catches redirect + code | ✓ |
| Manual paste redirect URL | User pastes full redirect URL; CLI extracts code | |

**User's choice:** Loopback listener auto-captures
**Notes:** Both Schwab dev apps already configured (client IDs/secrets/callback URLs exist) — no app registration. Setup targets the existing callbacks.

---

## Schwab vs CBOE chain priority (BRK-01)

| Option | Description | Selected |
|--------|-------------|----------|
| CBOE primary, Schwab supplements | Journal stays on CBOE; Schwab supplemental | |
| Schwab primary; CBOE = history + outage fallback | New snapshots from Schwab; CBOE keeps history + auto-fills only on AUTH_EXPIRED | ✓ |

**User's choice:** Schwab primary; CBOE = history + outage fallback
**Notes:** User's framing — Schwab for new data, CBOE for older/history. Clarified the nuance: CBOE also acts as automatic fallback for NEW snapshots only during a Schwab outage, so the journal never goes stale. Consistent with the per-app degradation choice below.

---

## AUTH_EXPIRED degradation (AUTH-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Per-app pause, CBOE keeps running | Independent trader/market states; market expiry → CBOE fallback; per-app status | ✓ |
| Global pause on any Schwab expiry | Any expiry pauses all Schwab jobs together | |

**User's choice:** Per-app pause, CBOE keeps running
**Notes:** Refresh-token scheduling confirmed OUT of Phase 4 (deferred to Phase 5 / JOB-02). Phase 4 ships `auth refresh` CLI + on-demand refresh only.

## Claude's Discretion

- Exact pgcrypto invocation pattern (within the key-never-in-DB / not-in-logs constraint)
- `broker_tokens` column layout, vendored OAuth client implementation, retry/backoff
- Adapter file naming, loopback listener port/lifecycle

## Deferred Ideas

- Scheduled `refresh-tokens` job (04:00 ET) → Phase 5 (JOB-02)
- Order placement / execution → future (read-only this phase)
- Web UI for auth status / setup → v2 (D19)
