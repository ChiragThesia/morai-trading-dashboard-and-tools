---
phase: 13-cot-adapter
reviewed: 2026-06-29T00:00:00Z
depth: standard
files_reviewed: 37
files_reviewed_list:
  - apps/server/src/adapters/http/analytics.routes.test.ts
  - apps/server/src/adapters/http/analytics.routes.ts
  - apps/server/src/adapters/mcp/mcp.test.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/main.ts
  - apps/worker/src/handlers/fetch-cot.test.ts
  - apps/worker/src/handlers/fetch-cot.ts
  - apps/worker/src/main.ts
  - apps/worker/src/schedule.test.ts
  - apps/worker/src/schedule.ts
  - packages/adapters/src/__contract__/cot-observations.contract.ts
  - packages/adapters/src/__contract__/cot.contract.ts
  - packages/adapters/src/http/__fixtures__/cot-tff-emini.json
  - packages/adapters/src/http/cftc.contract.test.ts
  - packages/adapters/src/http/cftc.test.ts
  - packages/adapters/src/http/cftc.ts
  - packages/adapters/src/index.ts
  - packages/adapters/src/memory/cot-observations.contract.test.ts
  - packages/adapters/src/memory/cot-observations.ts
  - packages/adapters/src/memory/cot.contract.test.ts
  - packages/adapters/src/memory/cot.ts
  - packages/adapters/src/postgres/migrations/0012_cot_observations.sql
  - packages/adapters/src/postgres/repos/cot-observations.contract.test.ts
  - packages/adapters/src/postgres/repos/cot-observations.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/contracts/src/cot.test.ts
  - packages/contracts/src/cot.ts
  - packages/contracts/src/index.ts
  - packages/core/src/index.ts
  - packages/core/src/journal/application/cotNet.test.ts
  - packages/core/src/journal/application/cotNet.ts
  - packages/core/src/journal/application/fetchCot.test.ts
  - packages/core/src/journal/application/fetchCot.ts
  - packages/core/src/journal/application/getCot.test.ts
  - packages/core/src/journal/application/getCot.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/index.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-06-29
**Depth:** standard
**Files Reviewed:** 37
**Status:** issues_found

## Summary

The COT adapter implementation is structurally sound and follows the hexagonal architecture
rules throughout. All of the specific landmines called out in the research doc are
correctly handled: Socrata numeric strings are coerced with `z.coerce.number()`, `as_of`
comes from `report_date_as_yyyy_mm_dd.slice(0,10)` (not date-math), the contract code is
the exact `13874A` (not a name-LIKE), no app token is sent, no fabricated fallback row is
returned on fetch failure, `published_at` is stamped from the injected clock (D-07) while
`as_of` comes from the report (D-08), net fields are derived in core and not stored,
idempotency uses `onConflictDoNothing` on the composite key, and the single use-case
instance is shared between the HTTP route and the MCP tool.

No architecture-boundary violations, no `any`/`as`/`!` violations, and no floating
promises were found. The Drizzle schema definition (`date("as_of")` → YYYY-MM-DD string,
`timestamp` → JS Date) correctly matches the `CotObservationRow` type.

Four warnings were found: one latent design issue in the CFTC adapter around the SoQL
`$where` construction, one missing date-format validation in the Zod schema at the
Socrata boundary, one inconsistent error-handling pattern in the analytics route, and one
port contract violation in the memory twin.

---

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: `contractCode` interpolated into Socrata SoQL `$where` without sanitization

**File:** `packages/adapters/src/http/cftc.ts:88-90`

**Issue:** The `$where` filter is built by string-interpolating the `contractCode` argument
directly into a SoQL expression:

```ts
url.searchParams.set(
  "$where",
  `cftc_contract_market_code='${contractCode}'`,
);
```

The `ForFetchingCotReport` port accepts any `string`. A caller passing a value containing
a single quote or SoQL operators (e.g., `13874A' OR '1'='1`) would alter the Socrata
query and could return rows for unintended contracts.

In the current wiring this is not exploitable — the value is hardcoded to `"13874A"` at
the composition root and there is no user-controlled code path to the port. But the
design is fragile: the port interface documents no constraint, and a future change making
`contractCode` configurable from env or an API call would introduce injection risk without
any visible signal.

**Fix:** Validate that `contractCode` contains only alphanumeric characters before use,
or use a whitelist check at the call site:

```ts
// In makeCftcCotAdapter, before building the URL:
if (!/^[A-Z0-9]{3,8}$/i.test(contractCode)) {
  console.warn(`CFTC: invalid contractCode format: ${contractCode}`);
  return fetchError("invalid contractCode");
}
```

Alternatively, document the constraint in the port type and validate in `makeFetchCot`
before forwarding to the adapter.

---

### WR-02: `report_date_as_yyyy_mm_dd` not validated as a date string in `CftcRowSchema`

**File:** `packages/adapters/src/http/cftc.ts:21`

**Issue:** The Zod schema for the Socrata row accepts `report_date_as_yyyy_mm_dd` as any
string (`z.string()`), not a date-shaped string:

```ts
const CftcRowSchema = z.object({
  report_date_as_yyyy_mm_dd: z.string(),  // accepts any string
  // ...
});
```

`asOf` is then derived by slicing 10 characters off this field:
```ts
asOf: row.report_date_as_yyyy_mm_dd.slice(0, 10),
```

If Socrata changes the field format (e.g., adds a timezone offset like
`"2026-06-23T00:00:00.000-05:00"` — still a valid string, still slices to `"2026-06-23"`,
fine) OR returns a non-ISO string (e.g., `"June 23, 2026"`), the adapter would:
1. Pass Zod validation at the boundary (the field is `z.string()`)
2. Produce a garbage `asOf` value (e.g., `"June 23, "`)
3. Store it via `persistCotObservation` without error
4. Cause an unhandled throw later when `cotResponse.parse()` validates
   `asOf: z.string().date()` at the route layer

The current Socrata API format (`"2026-06-23T00:00:00.000"`) is stable, so this is not
a present bug. But "parse, don't cast" at trust boundaries means the format should be
validated where it enters the system.

**Fix:** Tighten the schema to validate the date prefix before slicing:

```ts
const CftcRowSchema = z.object({
  // Validate that the field starts with a YYYY-MM-DD prefix before slicing
  report_date_as_yyyy_mm_dd: z.string().regex(
    /^\d{4}-\d{2}-\d{2}/,
    "expected ISO date prefix YYYY-MM-DD",
  ),
  // ...
});
```

---

### WR-03: `cotResponse.parse()` can throw unhandled in the analytics route

**File:** `apps/server/src/adapters/http/analytics.routes.ts:103`

**Issue:** The COT route (and the pre-existing term-structure and skew routes at lines 45
and 76) use `.parse()` — which throws on validation failure — directly in the response
path:

```ts
return c.json(cotResponse.parse(result.value));
```

If the use-case's `CotEntry[]` fails `cotResponse.parse()` for any reason (e.g., the
DB `date` column returns an unexpected value, or future schema drift), the thrown
`ZodError` bypasses the explicit `if (!result.ok) return c.json({ error: "internal" }, 500)`
error pattern. The exception propagates to Hono's default error handler, which returns a
generic 500, but without the controlled `{ error: "internal" }` body the tests assert on.

The term-structure and skew routes have the same issue and predate Phase 13. For COT,
the risk is low in practice (integer DB columns cannot silently become floats with Drizzle,
and the `date` column returns `YYYY-MM-DD` strings by default), but the inconsistency is
worth fixing for correctness.

**Fix:** Use `.safeParse()` and handle failure consistently:

```ts
router.get("/analytics/cot", async (c) => {
  const result = await getCot();
  if (!result.ok) {
    return c.json({ error: "internal" }, 500);
  }

  const parsed = cotResponse.safeParse(result.value);
  if (!parsed.success) {
    console.warn("COT: response schema validation failed", parsed.error.issues);
    return c.json({ error: "internal" }, 500);
  }

  return c.json(parsed.data);
});
```

Apply the same fix to the term-structure (line 44) and skew (line 75) routes for
consistency.

---

### WR-04: `makeMemoryCotReportAdapter.fetchReport` ignores the `contractCode` argument

**File:** `packages/adapters/src/memory/cot.ts:27-35`

**Issue:** The in-memory twin's `fetchReport` implementation ignores the `contractCode`
parameter entirely:

```ts
const fetchReport: ForFetchingCotReport = async (
  _contractCode: string,  // ignored
): Promise<Result<CotReport, FetchError>> => {
  if (stored === null) {
    return err({ kind: "fetch-error", message: "... not seeded ..." });
  }
  return ok(stored);  // returns the seeded report for ANY contractCode
};
```

The `ForFetchingCotReport` port contract is `(contractCode: string) => Promise<...>`. A
correct implementation should either return the report only if it matches the requested
code, or return `err` when the code is different from what was seeded. The current
implementation would return the seeded E-mini S&P 500 report if a caller passed `"WRONG"`
as the contractCode, silently masking a mismatch.

In current usage, the twin is only seeded with `"13874A"` and only called with `"13874A"`,
so this is not a present bug. But the contract test at `cot.contract.ts:49-56` tests
`fetchReport(KNOWN_CONTRACT_CODE)` — and the ONLY reason it passes is that the twin
ignores the code entirely. A future test that calls `fetchReport("DIFFERENT_CODE")` after
seeding with `"13874A"` would incorrectly return `ok` instead of `err`.

**Fix:** Filter by contractCode in the in-memory store:

```ts
export function makeMemoryCotReportAdapter(): MemoryCotReportAdapter {
  const store = new Map<string, CotReport>();  // keyed by contractCode

  const fetchReport: ForFetchingCotReport = async (
    contractCode: string,
  ): Promise<Result<CotReport, FetchError>> => {
    const report = store.get(contractCode);
    if (report === undefined) {
      return err({
        kind: "fetch-error",
        message: `MemoryCotReportAdapter: no report seeded for contractCode ${contractCode}`,
      });
    }
    return ok(report);
  };

  const seed = (report: CotReport): void => {
    store.set(report.contractCode, report);
  };

  return { fetchReport, seed };
}
```

---

## Info

### IN-01: `buildSkewApp` and `buildCotApp` reference `empty` before its file-order definition

**File:** `apps/server/src/adapters/http/analytics.routes.test.ts:35,41`

**Issue:** The function declarations `buildSkewApp` (line 33) and `buildCotApp` (line 39)
reference `empty`, a `const` defined at line 56. Function declarations are hoisted, but
`const` bindings are in the temporal dead zone until initialization. In practice, these
functions are only ever called inside `it()` callbacks, which run after the entire module
has been evaluated, so `empty` is always initialized by then. The code is safe at runtime
but confusing: a reader scanning the file sees `buildSkewApp` use `empty` before it
appears, and any future code that calls `buildSkewApp` at module-evaluation time would
throw a ReferenceError.

**Fix:** Move the `empty`, `skewEmpty`, and `cotEmpty` const declarations to the top of
the file (before the helper functions that reference them), or define them inline where
they are first used.

---

### IN-02: `result.error.message ?? fallback` is dead code in the fetch-cot handler

**File:** `apps/worker/src/handlers/fetch-cot.ts:32`

**Issue:** The error message extraction uses a nullish coalescing fallback:

```ts
const message = result.error.message ?? "fetchCot use-case failed";
```

`result.error` is typed as `FetchError | StorageError`. Both types define `message: string`
(non-optional, non-nullable), so the `?? "fetchCot use-case failed"` fallback is
unreachable. The TypeScript compiler with `strictNullChecks` would flag this as `string ??
string` — a `string` can never be null or undefined, so the right-hand side is dead.

**Fix:** Remove the fallback:

```ts
const message = result.error.message;
throw new Error(message);
```

---

_Reviewed: 2026-06-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
