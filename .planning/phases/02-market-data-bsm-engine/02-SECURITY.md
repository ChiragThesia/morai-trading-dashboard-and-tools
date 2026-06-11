---
phase: 02
slug: market-data-bsm-engine
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-11
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| CBOE CDN → chain adapter | Unauthenticated public delayed-quotes JSON over HTTPS | Option chain payload (public market data) |
| FRED API → rate adapter | API-keyed HTTPS fetch of DGS3MO series | Rate JSON (public); FRED_API_KEY (secret, request-only) |
| npm registry → workspace | Third-party package installs (pg-boss, msw) | Executable dependency code |
| pg-boss `pgboss` schema → job-runs repo | Read-only introspection of job state | Job names, timestamps, error messages |
| Worker job queue → handlers | pg-boss job payloads into handler functions | Job objects (internally produced) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-02-SC | Tampering | pg-boss + msw installs | mitigate | Blocking human-verify checkpoint before install; registry metadata verified (repo org, MIT, version, postinstall disclosed); pg-boss@^12.18.3 `apps/worker/package.json:10`, msw@^2.14.6 `packages/adapters/package.json:20` | closed |
| T-02-01 | Tampering | Recorded CBOE fixture | accept | Static committed test data, no secrets | closed |
| T-02-02 | Information Disclosure | Fixture README / capture | accept | CBOE delayed quotes are public no-auth data | closed |
| T-02-03 | Tampering | BSM numerical correctness | mitigate | Calibration fixtures + fast-check invariants in `bsm.test.ts` | closed |
| T-02-04 | Denial of Service | BSM unbounded compute | accept | O(1) closed-form functions, no external loops | closed |
| T-02-05 | Tampering | IV solver correctness / non-convergence | mitigate | Bisection fallback `iv-inversion.ts:147-189`; European no-arb bound `iv-inversion.ts:84-91`; residual check `iv-inversion.ts:203-205` | closed |
| T-02-06 | Denial of Service | invertIv infinite loop | mitigate | MAX_ITER=50 `iv-inversion.ts:28`; BISECT_STEPS=200 `iv-inversion.ts:32` | closed |
| T-02-07 | Tampering | Malformed CBOE payload | mitigate | `CboeResponseSchema.safeParse` `cboe.ts:238-244`; err on failure | closed |
| T-02-08 | Denial of Service | Unbounded chain write | mitigate | `isInFilter` `fetchChain.ts:53-70` before persist; DTE + strike-band gates | closed |
| T-02-09 | Tampering | SQL injection via contract symbols | mitigate | Drizzle parameterized insert `leg-observations.ts:61,86`; no raw interpolation | closed |
| T-02-10 | Information Disclosure | Raw error/stack in CBOE failures | mitigate | Errors return `{kind, message}` only `cboe.ts:227-235` | closed |
| T-02-11 | Information Disclosure | FRED_API_KEY in logs | mitigate | Key in URL param only `fred.ts:61`; fallback warns use static text `fred.ts:72,79,87` | closed |
| T-02-12 | Denial of Service | FRED unreachable blocks compute | mitigate | 4.5% fallback on non-2xx `fred.ts:70-75` and network error `fred.ts:77-81` | closed |
| T-02-13 | Tampering | Malformed FRED payload | mitigate | `FredResponseSchema.safeParse` `fred.ts:84-88`; '.' filter `fred.ts:92-98` | closed |
| T-02-14 | Tampering | SQL injection via rate date | mitigate | Drizzle parameterized upsert `rate-observations.ts:31-35`; lte query `:51` | closed |
| T-02-15 | Denial of Service | Infinite re-scan on unsolvable rows | mitigate | `isNull(bsmIv)` gate `leg-observations.ts:110`; NaN-stamped rows leave scan | closed |
| T-02-16 | Tampering | JS NaN wrong in numeric column | mitigate | `NAN_STAMP = "NaN"` `computeBsmGreeks.ts:36`; all five bsm_* use it `:124-129` | closed |
| T-02-17 | Tampering | Unintended vendor column overwrite | mitigate | `writeBsmResults` `.set()` `leg-observations.ts:193-199` touches only bsm_* columns | closed |
| T-02-18 | Tampering | Malformed pg-boss job payload | mitigate | `if (job === undefined) return` guard in all three handlers | closed |
| T-02-19 | Elevation of Privilege | pgboss.job schema access | mitigate | SELECT DISTINCT ON only `job-runs.ts:71-81`; no writes to pgboss schema | closed |
| T-02-20 | Information Disclosure | Raw error/stack in status output | mitigate | `extractLastError` `job-runs.ts:45-61` extracts only message field | closed |
| T-02-21 | Information Disclosure | Secrets in worker logs | mitigate | `bootWorkerConfig` `config.ts:53-61` logs field names only on ZodError | closed |
| T-02-22 | Tampering | Fabricated IV via endpoint-clamp | mitigate | Post-solve residual check `iv-inversion.ts:203-205` | closed |
| T-02-23 | Information Disclosure | Valid rows NaN-stamped (silent data loss) | mitigate | European no-arb bound `iv-inversion.ts:84-91`; per-row obs.time T `computeBsmGreeks.ts:114` | closed |
| T-02-24 | Denial of Service | Worker restart-loop on fresh DB | mitigate | `boss.createQueue` ×3 `main.ts:108-110` after start, before schedule | closed |
| T-02-25 | Denial of Service | Unhandled rejection from failed enqueue | mitigate | `.catch((e: unknown) => console.warn(...))` `fetch-cboe-chain.ts:57-60` | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-01 | Recorded CBOE fixture is static committed test data containing no secrets | plan 02-01 threat model (user-approved plans) | 2026-06-11 |
| AR-02-02 | T-02-02 | CBOE delayed quotes are public, unauthenticated data; capture docs disclose nothing sensitive | plan 02-01 threat model (user-approved plans) | 2026-06-11 |
| AR-02-03 | T-02-04 | BSM pricing is O(1) closed-form math; no externally controllable loop bounds | plan 02-02 threat model (user-approved plans) | 2026-06-11 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-11 | 25 | 25 | 0 | gsd-security-auditor (sonnet) |

Audit notes: register authored at plan time across all 9 plans (verify-mitigations mode, no retroactive STRIDE needed). All three SUMMARY.md `## Threat Flags` sections (02-02, 02-03, 02-09) state "None" — no unregistered attack surface appeared during implementation.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-11
