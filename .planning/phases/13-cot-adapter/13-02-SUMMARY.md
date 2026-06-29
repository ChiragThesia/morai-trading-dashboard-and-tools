---
phase: 13-cot-adapter
plan: "02"
subsystem: adapters/http, adapters/memory, adapters/__contract__
tags: [cot, cftc, socrata, tff, adapter, memory-twin, contract-test, msw, tdd]
status: complete

dependency_graph:
  requires:
    - 13-01 — CotReport/ForFetchingCotReport ports + domain types in @morai/core
  provides:
    - makeCftcCotAdapter — ForFetchingCotReport over CFTC Socrata gpe5-46if.json
    - makeMemoryCotReportAdapter — in-memory twin with seed(), err on unseeded
    - runCotReportContractTests — shared contract suite run by both adapters
    - cot-tff-emini.json — captured TFF fixture (string numbers, real field names)
  affects:
    - packages/adapters/src/index.ts (makeCftcCotAdapter + makeMemoryCotReportAdapter exports)

tech_stack:
  added: []
  patterns:
    - z.coerce.number() for Socrata string-numbers (landmine 1 guard)
    - Exact contract code '$where=cftc_contract_market_code=...' (landmine 2 — no name LIKE)
    - asOf from report_date_as_yyyy_mm_dd.slice(0,10) — never date-math (landmine 3)
    - No fabricated fallback on any error path — err(FetchError) always (landmine 4)
    - No X-App-Token header — anonymous access sufficient (landmine 7)
    - Shared runCotReportContractTests proving twin ≡ real adapter (architecture §8)

key_files:
  created:
    - packages/adapters/src/http/cftc.ts
    - packages/adapters/src/http/cftc.test.ts
    - packages/adapters/src/http/cftc.contract.test.ts
    - packages/adapters/src/http/__fixtures__/cot-tff-emini.json
    - packages/adapters/src/memory/cot.ts
    - packages/adapters/src/memory/cot.contract.test.ts
    - packages/adapters/src/__contract__/cot.contract.ts
  modified:
    - packages/adapters/src/index.ts

decisions:
  - No fabricated fallback in either adapter (landmine 4): makeMemoryRateAdapter has a 4.5% default; makeMemoryCotReportAdapter has no default — unseeded returns err(FetchError). This parity with the real adapter ensures tests can assert the error path.
  - CotReport.contractCode is taken from the Socrata row's cftc_contract_market_code field (not the caller's contractCode arg), matching round-trip fidelity for contract tests.
  - knownCotReport exported from the contract module so both msw-seeded and in-memory call sites use identical fixture values.

metrics:
  duration_minutes: 8
  completed: "2026-06-29"
  tasks_completed: 2
  files_created: 7
  files_modified: 1
---

# Phase 13 Plan 02: CFTC Socrata HTTP Adapter + Memory Twin Summary

CFTC TFF adapter: Socrata string-number coercion, exact 13874A $where, asOf from report date, err-on-any-failure (no fallback), proven equivalent to in-memory twin via shared contract.

## Tasks Completed

| # | Task | Commit | Type | Result |
|---|------|--------|------|--------|
| 1 | makeCftcCotAdapter + fixture + msw tests | 7a52ae3 | TDD red→green | 11/11 tests pass |
| 2 | makeMemoryCotReportAdapter + shared contract | ede1710 | TDD red→green | 14/14 tests pass |

## Acceptance Criteria Verification

- [x] `bun run test -- packages/adapters/src/http/cftc.test.ts` — 11 passed (string→number coercion, 13874A $where, asOf from report date, non-2xx→err, network→err, empty→err, malformed→err)
- [x] `bun run test -- packages/adapters/src/memory/cot.contract.test.ts packages/adapters/src/http/cftc.contract.test.ts` — 14 passed (7 each; twin ≡ real adapter on shared contract surface)
- [x] Unseeded memory twin returns err(fetch-error) — confirmed by contract test `in-memory adapter unseeded: returns err`
- [x] `rg -n "makeMemoryCotReportAdapter|makeCftcCotAdapter" packages/adapters/src/index.ts` — 2 matches (lines 88 + 104)
- [x] `bun run typecheck` — clean (no errors)
- [x] `bun run lint` — clean (pre-existing boundary selector warnings only)
- [x] No `any`, no `as`, no `!` anywhere in new code
- [x] Adapter never throws — every branch returns Result

## Contracts Delivered

### makeCftcCotAdapter (packages/adapters/src/http/cftc.ts)
`ForFetchingCotReport` over `https://publicreporting.cftc.gov/resource/gpe5-46if.json`.
- Query: `$where=cftc_contract_market_code='<contractCode>'&$order=report_date_as_yyyy_mm_dd DESC&$limit=1`
- Coerces Socrata string-numbers with `z.coerce.number()` (landmine 1)
- `asOf` = `report_date_as_yyyy_mm_dd.slice(0, 10)` — never date-math (landmine 3)
- Non-2xx / network / empty / malformed → `err({kind:"fetch-error",...})` (landmine 4)
- No `X-App-Token` header (landmine 7)

### makeMemoryCotReportAdapter (packages/adapters/src/memory/cot.ts)
In-memory twin with `seed(report: CotReport)`. Unseeded → `err({kind:"fetch-error",...})` — no default fabrication (unlike `makeMemoryRateAdapter`'s 4.5% fallback). Mirrors the real adapter's no-fallback policy exactly.

### runCotReportContractTests (packages/adapters/src/__contract__/cot.contract.ts)
Shared suite (7 cases): contractCode, asOf format, openInterest value, leveraged-funds legs, all-legs finite, seed override, unseeded→err. Run by both `memory/cot.contract.test.ts` and `http/cftc.contract.test.ts`.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all fields mapped from fixture; no placeholder data flows to UI.

## Threat Flags

No new trust boundaries introduced beyond those in the plan's threat model (T-13-02/T-13-03/T-13-04 all mitigated).

## Self-Check: PASSED

- All 7 created files confirmed present on disk
- Both task commits verified in git log (7a52ae3, ede1710)
- 25/25 tests pass across all three test files
