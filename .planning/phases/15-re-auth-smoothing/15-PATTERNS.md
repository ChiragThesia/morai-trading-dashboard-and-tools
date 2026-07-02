# Phase 15: Re-Auth Smoothing - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 10 (extend) + 2 (new)
**Analogs found:** 10 / 10 (all touched files ARE their own best analog — this phase is
pure extension of existing code, not new-file creation from a foreign template)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/brokerage/domain/token-freshness.ts` | domain/utility | transform (pure fn) | itself (`isNearExpiry`, existing) | exact — extend in place |
| `packages/core/src/brokerage/application/ports.ts` | model (port types) | CRUD (type shape) | itself (`AppTokenStatus`) | exact — extend in place |
| `packages/contracts/src/status.ts` | contract/schema | request-response | itself (`appTokenStatus`) | exact — extend in place |
| `apps/server/src/adapters/status-dto.ts` | transform/mapper | request-response | itself (`serializeApp`) | exact — extend in place |
| `apps/server/src/adapters/http/status.routes.ts` | route/controller | request-response | itself (thin passthrough) | exact — pattern already minimal |
| `apps/server/src/adapters/mcp/tools.ts` (get_status) | route/controller (MCP) | request-response | `status.routes.ts` (shares `toStatusResponse`) | role-match |
| `apps/web/src/components/AuthExpiredBanner.tsx` | component | request-response (polled read) | itself (sibling amber state) | exact — extend/add sibling |
| `apps/web/src/hooks/useStatus.ts` | hook | request-response (polling) | itself (unchanged, consumed) | exact — no change expected |
| `apps/sidecar/seed_token.py` | CLI/script (driving adapter) | request-response (OAuth exchange) + file-I/O | itself (`step_login`, `_verify_and_finish`) | exact — commit pending diff + harden finish message |
| `packages/contracts/src/jobs.ts` | contract/config | CRUD (static list) | itself (`TRIGGERABLE_JOBS`) | exact — remove one entry |
| `apps/server/src/adapters/mcp/tools/trigger-job.ts` | route/controller (MCP) | request-response | itself (description string) | exact — edit description text |
| `apps/server/src/adapters/http/jobs.routes.test.ts` | test | request-response | itself (assertion at lines 134-142) | exact — update `.toContain`/`.toHaveLength` |
| `docs/operations/schwab-reauth-runbook.md` (NEW) | doc | — | none in `docs/operations/` (new topic dir) — style from `apps/sidecar/seed_token.py` module docstring | no direct analog; use docstring as source-of-truth content, Hemingway style per `docs.md` |
| `packages/core/src/brokerage/domain/token-freshness.test.ts` | test | transform | itself (`isNearExpiry` describe block) | exact — extend with `refreshExpiresIn` boundary cases |
| `apps/server/src/adapters/http/status.routes.test.ts` | test | request-response | itself | exact — extend |
| `apps/web/src/components/AuthExpiredBanner.test.tsx` | test | request-response | itself (`makeStatusData` helper) | exact — extend fixture + new describe block (or new sibling test file if amber becomes a separate component) |

## Pattern Assignments

### `packages/core/src/brokerage/domain/token-freshness.ts` (domain, pure transform)

**Analog:** itself — add `refreshExpiresInSeconds` alongside `isNearExpiry`.

**Existing threshold constants to reuse** (lines 14-24):
```typescript
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const WARN_THRESHOLD_MS = 1 * 24 * 60 * 60 * 1000; // 1 day

export function isNearExpiry(refreshIssuedAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - refreshIssuedAt.getTime();
  return ageMs >= SEVEN_DAYS_MS - WARN_THRESHOLD_MS;
}
```

**New function pattern** (research-recommended, mirror `isNearExpiry`'s pure-fn shape,
no I/O, `now` injected):
```typescript
// refreshExpiresInSeconds(refreshIssuedAt, now) => number | null
//   null when NOT isNearExpiry(...)  (SC1: "non-null inside T-24h")
//   otherwise Math.max(0, SEVEN_DAYS_MS - ageMs) / 1000, rounded (non-negative integer)
export function refreshExpiresInSeconds(refreshIssuedAt: Date, now: Date): number | null {
  if (!isNearExpiry(refreshIssuedAt, now)) return null;
  const ageMs = now.getTime() - refreshIssuedAt.getTime();
  return Math.max(0, Math.round((SEVEN_DAYS_MS - ageMs) / 1000));
}
```

**`toAppTokenStatus` extension point** (lines 69-101) — thread the new field through
all 4 branches (`none_yet`, `AUTH_EXPIRED`, `stale`, `fresh`); decide the value per
branch per the plan (research flags `AUTH_EXPIRED` should likely be `0`/non-null since
it is past expiry, `none_yet` stays `null`).

**Error handling:** N/A — pure function, no try/catch, no Result type (matches every
other function in this file).

---

### `packages/core/src/brokerage/application/ports.ts` (port/type)

**Analog:** itself — extend `AppTokenStatus` type (lines 44-49).

```typescript
export type AppTokenStatus = {
  readonly status: "fresh" | "stale" | "AUTH_EXPIRED" | "none_yet";
  readonly expiresAt: Date | null;
  readonly refreshIssuedAt: Date | null;
  readonly lastRefreshError: string | null;
  // ADD: readonly refreshExpiresIn: number | null;  (seconds; AUTH-05)
};
```
Readonly convention must be preserved (typescript.md rule: "Prefer readonly in domain
types").

---

### `packages/contracts/src/status.ts` (Zod contract, request-response)

**Analog:** itself — extend `appTokenStatus` schema (lines 18-25).

```typescript
export const appTokenStatus = z.object({
  status: z.enum(["fresh", "stale", "AUTH_EXPIRED", "none_yet"]),
  expiresAt: z.string().datetime().nullable(),
  refreshIssuedAt: z.string().datetime().nullable(),
  lastRefreshError: z.string().nullable(),
  // ADD: refreshExpiresIn: z.number().int().nonnegative().nullable(),
});
```
MCP-02 discipline (file header comment, lines 3-4): this is the ONE schema source for
both HTTP route and MCP tool — a one-sided change fails typecheck on both adapters, so
no separate MCP-side schema is needed.

---

### `apps/server/src/adapters/status-dto.ts` (mapper, Date→string serialization)

**Analog:** itself — extend `serializeApp` (lines 17-25).

```typescript
function serializeApp(app: AppTokenStatus) {
  return {
    status: app.status,
    expiresAt: app.expiresAt === null ? null : app.expiresAt.toISOString(),
    refreshIssuedAt:
      app.refreshIssuedAt === null ? null : app.refreshIssuedAt.toISOString(),
    lastRefreshError: app.lastRefreshError,
    // ADD: refreshExpiresIn: app.refreshExpiresIn,  (already a plain number, no Date mapping needed)
  };
}
```
Note from file docstring (lines 1-12): this is the SOLE mapper both `/status` route and
MCP `get_status` must go through — `statusResponse.parse` throws if Dates leak through
unconverted. `refreshExpiresIn` is already `number | null`, so it passes straight
through with no conversion, unlike `expiresAt`/`refreshIssuedAt`.

---

### `apps/server/src/adapters/http/status.routes.ts` + MCP `get_status` tool

**Analog:** `status.routes.ts` itself — no change needed to the route body; it already
calls `toStatusResponse(result.value)` (line 25), so extending the DTO mapper
propagates automatically (MCP-02 "by construction", per RESEARCH.md).

**Warning-log side effect placement** (Open Question 1, RESEARCH.md): per
`architecture-boundaries.md` rule 2 ("no node I/O in core"), `console.warn` must live in
the adapter layer, not `token-freshness.ts`. Closest existing precedent for adapter-side
logging: none currently in `status.routes.ts` (it has zero logging). Recommend adding a
single `console.warn` call inside `status.routes.ts` (and/or the MCP tool if not shared
via a composition-root wrapper) gated on `refreshExpiresIn !== null`, logging only
`appId` + the computed seconds value — never raw token/timestamp material beyond what's
already in `AppTokenStatus`.

**Error handling pattern** (lines 21-24, existing, unchanged):
```typescript
if (!result.ok) {
  return c.json({ error: "internal" }, 500);
}
```

---

### `apps/web/src/components/AuthExpiredBanner.tsx` (component, sibling amber state)

**Analog:** itself.

**Imports pattern** (line 1):
```typescript
import { useStatus } from "../hooks/useStatus.ts";
```

**Core boolean-gate pattern** (lines 27-34) — the amber sibling should follow this exact
shape, swapping the status check and reading `refreshExpiresIn`:
```typescript
const isExpired =
  data !== undefined &&
  data.tokenFreshness !== "none yet" &&
  data.tokenFreshness.trader.status === "AUTH_EXPIRED";

if (!isExpired) {
  return null;
}
```
For the amber state: check `data.tokenFreshness.trader.refreshExpiresIn !== null` (and
per Open Question 2 / Assumption A3, consider `market` too — research recommends the new
amber banner check BOTH apps even though the existing red banner is trader-only).

**Inline-style + a11y pattern** (lines 36-68) — `role="alert"`, fixed positioning,
JetBrains Mono font stack, color `#ef5350` (coral/red) for AUTH_EXPIRED. Amber variant
should reuse the same `role="alert"` + fixed-bottom layout with a different `backgroundColor`/`borderTop`/`color` (amber palette — exact hex is Claude's Discretion
per CONTEXT.md D-03 "Banner copy and styling — follow AuthExpiredBanner precedent").

**No dismiss button** — explicit design constraint carried over (docstring line 16,
test at lines 107-113 asserts `queryByRole("button")` is null).

---

### `apps/web/src/components/AuthExpiredBanner.test.tsx` (test)

**Analog:** itself.

**Mock setup pattern** (lines 9-24):
```typescript
vi.mock("../hooks/useStatus.ts", () => ({ useStatus: vi.fn() }));
import { useStatus } from "../hooks/useStatus.ts";
const mockUseStatus = vi.mocked(useStatus);
function setStatusData(data: StatusResponse | undefined) {
  mockUseStatus.mockReturnValue({ data } as ReturnType<typeof useStatus>);
}
```

**Fixture builder pattern** (lines 33-55, `makeStatusData`) — must be extended with a
`refreshExpiresIn` field (currently omitted; all fixtures set it implicitly via the
object literal, so this will need updating or the new contract field added with a
default `null`), and likely a `market`-app parameter if Assumption A3 (both apps
gate the amber banner) is adopted.

---

### `apps/sidecar/seed_token.py` (CLI/operator script, D-02 hardening)

**Analog:** itself — commit the pending 2-line diff, then edit `_verify_and_finish`.

**Pending uncommitted diff** (already in working tree, `step_login`, lines 206-207):
```python
interactive=False,  # auto-open browser, no input() prompt (runnable headlessly)
callback_timeout=float(os.environ.get("SEED_CALLBACK_TIMEOUT", "600")),
```
This must be committed as part of Phase 15 (RESEARCH.md Pattern 3) — do not leave as
working-tree drift.

**Finish-instruction pattern to correct** (`_verify_and_finish`, lines 218-235):
```python
def _verify_and_finish(db_url: str) -> None:
    ...
    print(
        "\nDone. Now re-init the sidecar clients so /sidecar/chain goes live:\n"
        "  railway up --service sidecar --detach"
    )
```
Change the last line to `railway redeploy --service sidecar -y` (RESEARCH.md Summary +
Pitfall 4 — `railway up` rebuilds, `railway redeploy` restarts the existing image
without rebuild; this is the AUTH-06 pickup-mechanism finding). Also update the module
docstring (line 33: `railway up --service sidecar`) to match.

**UPSERT pattern** (lines 67-84, unchanged, already correct — reference only):
```python
UPSERT_SQL = """
    INSERT INTO broker_tokens
        (app_id, token_json, access_token, refresh_token,
         issued_at, refresh_issued_at, expires_at, updated_at)
    VALUES (...)
    ON CONFLICT (app_id) DO UPDATE SET ...
"""
```

**Env-loading / fail-loud pattern** (lines 87-94, `require_env`) — reusable precedent
if the runbook or hardening adds any new required env var (none currently planned).

---

### `packages/contracts/src/jobs.ts` + `apps/server/src/adapters/mcp/tools/trigger-job.ts` (D-04 cleanup)

**Analog:** itself, both files.

**`TRIGGERABLE_JOBS` edit target** (jobs.ts, lines 12-17):
```typescript
export const TRIGGERABLE_JOBS = [
  "rebuild-journal",
  "sync-fills",
  "refresh-tokens",   // ← REMOVE this line
  "compute-bsm-greeks",
] as const;
```

**MCP tool description edit target** (trigger-job.ts, line 28):
```typescript
description:
  "Manually trigger a background job by name. Returns { jobId } on success; jobId is null when the job was already queued (dedup no-op). Supported jobs: rebuild-journal, sync-fills, refresh-tokens, compute-bsm-greeks.",
  // ← remove "refresh-tokens, " from the Supported jobs list
```

**Associated test-file assertions to update** (`jobs.routes.test.ts`, lines 134-142):
```typescript
it("TRIGGERABLE_JOBS is the canonical list from @morai/contracts (MCP-02 single schema source)", () => {
  expect(TRIGGERABLE_JOBS).toContain("rebuild-journal");
  expect(TRIGGERABLE_JOBS).toContain("sync-fills");
  expect(TRIGGERABLE_JOBS).toContain("refresh-tokens");   // ← REMOVE
  expect(TRIGGERABLE_JOBS).toContain("compute-bsm-greeks");
  expect(TRIGGERABLE_JOBS).toHaveLength(4);   // ← change to 3
});
```

---

### `docs/operations/schwab-reauth-runbook.md` (NEW file, no code analog)

**Style source:** `apps/sidecar/seed_token.py` module docstring (lines 1-37) — already
contains the two-step flow narrative, security notes, and exact commands; the runbook
should restructure this content for human/operator consumption per `docs.md` (Hemingway
style, one concept per file, kebab-case, topic subdirectory `docs/operations/` is new —
must be added to `docs/TOPIC-MAP.md` per the docs rule's "Maintaining the System"
section).

**Must include** (per RESEARCH.md Pitfall 1/4 and Security Domain):
- Explicit restart step: `railway redeploy --service sidecar -y` (not `railway up`)
- Post-restart verification: `/sidecar/health` reachable + not degraded
- Placeholder redirect URLs only (e.g. `<trader_redirect_url>`) — never a real captured
  OAuth redirect URL (contains a single-use secret `code` param)
- `railway run --service worker ...` invocation form (env-injection safety, avoids
  wrong-target DB writes)

## Shared Patterns

### Result<T,E> / no-throw at ports (TypeScript side)
**Source:** `packages/adapters/src/postgres/repos/broker-tokens.ts` (lines 61-105,
`readTokens`), consistent across all adapter functions in this file.
**Apply to:** No new adapter functions are added in this phase (only field extensions to
existing types/mappers), but any new logging wrapper added at the route/MCP layer must
still not throw — follow the existing `if (!result.ok) { ... }` guard style already in
`status.routes.ts`.
```typescript
try {
  ...
  return ok(value);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

### Parse-don't-cast at the wire boundary
**Source:** `apps/web/src/hooks/useStatus.ts` (line 41) and `status-dto.ts` (line 35,
`statusResponse.parse(...)`).
**Apply to:** The extended `statusResponse`/`appTokenStatus` schema — no `as` casts
anywhere; `refreshExpiresIn` flows through `.parse()` on both write (status-dto.ts) and
read (useStatus.ts) sides, per typescript.md rule.

### MCP-02 single schema source
**Source:** `packages/contracts/src/status.ts` (header comment) and
`packages/contracts/src/jobs.ts` (header comment), both explicit about this convention.
**Apply to:** All contract edits in this phase — `appTokenStatus` and `TRIGGERABLE_JOBS`
are each the sole source consumed by both the HTTP route and the MCP tool; a one-sided
edit fails typecheck on the other adapter.

### No token/secret values in logs
**Source:** `broker-tokens.ts` file docstring (lines 9-11: "No logging of
encryptionKey or token values — only appId and timestamps"); `seed_token.py` docstring
(line 35-36: "No token value is printed").
**Apply to:** The new T-24h warning-log line (AUTH-05) and the new runbook doc (AUTH-06)
— both must log/document only `appId` + numeric/ISO values, never token material.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `docs/operations/schwab-reauth-runbook.md` | doc | — | New topic subdirectory (`docs/operations/`) does not yet exist in `docs/`; use `seed_token.py`'s docstring as content source and `docs.md`/Hemingway style rule for structure, not a prior runbook file |

## Metadata

**Analog search scope:** `packages/core/src/brokerage/`, `packages/contracts/src/`,
`packages/adapters/src/postgres/repos/`, `apps/server/src/adapters/`,
`apps/web/src/components/`, `apps/web/src/hooks/`, `apps/sidecar/`, `docs/`
**Files scanned:** 13 read in full (all ≤ 260 lines, single-pass reads)
**Pattern extraction date:** 2026-07-02
