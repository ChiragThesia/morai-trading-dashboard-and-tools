# Deferred Items — Phase 02 Market Data BSM Engine

## Pre-existing Lint Errors (out of scope for Plan 05)

Files from Plan 04 with `@typescript-eslint/consistent-type-assertions` errors:

- `packages/adapters/src/postgres/repos/leg-observations.ts` lines 50, 71, 72
- `packages/adapters/src/postgres/repos/leg-observations.contract.test.ts` lines 44, 57

These `as` casts are in source-vs-Drizzle mapping code (source: "cboe", contractType, exerciseStyle)
and in raw SQL result narrowing. They were committed in plan 02-04 and are not modified by plan 02-05.

**Recommended fix:** Use type-safe mapping instead of `as` casts. Drizzle enum type should match
the string literal — use the explicit enum values from the schema instead of cast.

Deferred to a future fix commit in the series.
