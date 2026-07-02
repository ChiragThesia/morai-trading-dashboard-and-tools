---
phase: 14
slug: fred-expansion
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-02
---

# Phase 14 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| user query → macroQuery | `days`/`series` are user-controlled; Zod-validated before any use-case | query params (untrusted) |
| FRED/CBOE HTTP → core | Untrusted upstream JSON; Zod `safeParse` at adapter boundary | market data (untrusted) |
| worker env → adapters | `FRED_API_KEY` read once at composition root (Zod-parsed config) | secret |
| repo → DB | Parameterized SQL only; composite-key upsert governs idempotency | macro rows |
| browser/client → GET /api/analytics/macro | Supabase JWT gate inherited via apiRouter/authReadGroup placement | authenticated reads |
| Claude Code → MCP get_macro | Bearer-gated `/mcp/*`; args validated by shared macroQuery | authenticated reads |
| API response → UI | `macroResponse.parse` before render — no `as` cast | typed payload |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-14-01 | Tampering | macroQuery `series`/`days` input | medium | mitigate | `z.enum(MACRO_SERIES_IDS)` + coerced int `max(1825)` at boundary; invalid → 400/MCP reject (contracts/macro.ts) | closed |
| T-14-02 | Tampering | macroQuery `days` window | low | mitigate | `z.coerce.number().int().positive().max(1825)` caps scan (D-11) | closed |
| T-14-03 | Information Disclosure | route/MCP contract drift | low | mitigate | ONE macroResponse schema both adapters; parity test + typecheck (MCP-02) | closed |
| T-14-04 | Tampering | duplicate (date, series_id) rows | high | mitigate | Composite PK + `onConflictDoUpdate` — PROVEN in prod 2026-07-02: second run, 8 rows, 0 dupes (14-UAT.md) | closed |
| T-14-05 | Denial of Service | destructive migration on live table | high | mitigate | 0013 SQL hand-reviewed (orchestrator + executor): clean CREATE TABLE, no DROP/ALTER on rate_observations; applied + idempotent in prod | closed |
| T-14-06 | Information Disclosure | FRED api_key in logs/errors | high | mitigate | Static warn text, key never interpolated (fred.ts T-02-11/12 discipline); tests assert static text; code review verified no leak paths | closed |
| T-14-07 | Tampering | malformed FRED/CBOE payload | medium | mitigate | Zod `safeParse` at both adapter boundaries before core | closed |
| T-14-08 | Tampering | SQL injection via series/value | medium | mitigate | Drizzle parameterized `.values()` — no string interpolation | closed |
| T-14-09 | Denial of Service | silent data holes on partial fetch failure | medium | mitigate | Fail-loud finish (D-07): failed series → Result err → pg-boss failed + /api/status lastErr; successes persist | closed |
| T-14-10 | Information Disclosure | StorageError propagation | low | mitigate | Typed StorageError stays in core; route maps to flat `{error:"internal"}` | closed |
| T-14-11 | Tampering | hexagon purity | low | mitigate | Use-cases import only ./ports.ts + @morai/shared; ESLint boundaries enforce; verifier confirmed | closed |
| T-14-12 | Information Disclosure | FRED_API_KEY worker handling | high | mitigate | Key Zod-parsed once at main.ts, flows typed, never logged, never committed (D-13 — set on Railway 2026-07-02, not in repo) | closed |
| T-14-13 | Tampering | BSM rate path regression | high | mitigate | fetchRate call byte-for-byte intact (D-02); regression test; zero-deletion diff verified | closed |
| T-14-14 | Information Disclosure | DB error leaking via route/tool | medium | mitigate | Flat `{error:"internal"}` 500 / flat MCP error — raw messages never leave core | closed |
| T-14-15 | Spoofing | unauthenticated macro access | low | mitigate | Route inside apiRouter/authReadGroup JWT chain (verifier confirmed mounted placement); MCP behind bearer gate | closed |
| T-14-16 | Spoofing | useMacro on expired session | low | mitigate | 401 → UnauthorizedError, non-retryable (useCot precedent) — no retry storm | closed |
| T-14-17 | Tampering | untyped API body reaching UI | low | mitigate | `macroResponse.parse` at hook boundary — throws before render | closed |
| T-14-18 | Denial of Service | missing empty-state breaks card | low | mitigate | Explicit "run the job to populate" empty state; user-verified in UAT (local empty-state + prod populated) | closed |
| T-14-SC | Tampering | npm/bun supply chain | low | accept | Phase adds ZERO new dependencies — no package-legitimacy gate required | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-14-01 | T-14-SC | Zero new dependencies introduced in Phase 14 (zod/drizzle/msw/testcontainers/TanStack all pre-existing); supply-chain surface unchanged | plan-time disposition (all 7 plans) | 2026-07-02 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-02 | 19 | 19 | 0 | secure-phase orchestrator (L1 grep + verifier 10/10 + code review 43 files + prod UAT evidence) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-02
