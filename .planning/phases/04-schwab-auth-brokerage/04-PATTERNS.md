# Phase 04: Schwab Auth & Brokerage - Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 22 new/modified files
**Analogs found:** 20 / 22

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/adapters/src/schwab/auth/oauth-client.ts` | driven adapter | request-response | `packages/adapters/src/http/cboe.ts` | role-match (HTTP adapter factory) |
| `packages/adapters/src/schwab/auth/oauth-client.test.ts` | test | request-response | `packages/adapters/src/http/cboe.test.ts` | exact (msw-backed unit test) |
| `packages/adapters/src/schwab/market/chain-adapter.ts` | driven adapter | request-response | `packages/adapters/src/http/cboe.ts` | exact (ForFetchingChain implementor) |
| `packages/adapters/src/schwab/market/chain-adapter.test.ts` | test | request-response | `packages/adapters/src/http/cboe.test.ts` | exact (msw unit test) |
| `packages/adapters/src/schwab/market/chain-adapter.contract.test.ts` | contract test | request-response | `packages/adapters/src/http/cboe.contract.test.ts` | exact |
| `packages/adapters/src/schwab/trader/positions-adapter.ts` | driven adapter | request-response | `packages/adapters/src/http/cboe.ts` | role-match (HTTP adapter factory) |
| `packages/adapters/src/schwab/trader/transactions-adapter.ts` | driven adapter | request-response | `packages/adapters/src/http/cboe.ts` | role-match |
| `packages/adapters/src/schwab/trader/trader-adapter.test.ts` | test | request-response | `packages/adapters/src/http/cboe.test.ts` | role-match |
| `packages/adapters/src/postgres/repos/broker-tokens.ts` | driven adapter | CRUD | `packages/adapters/src/postgres/repos/leg-observations.ts` | role-match (Postgres repo factory) |
| `packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts` | contract test | CRUD | `packages/adapters/src/postgres/repos/leg-observations.contract.test.ts` | role-match |
| `packages/adapters/src/memory/broker-tokens.ts` | driven adapter (twin) | CRUD | `packages/adapters/src/memory/chain.ts` | exact (in-memory twin factory) |
| `packages/adapters/src/postgres/schema.ts` | config/schema | — | `packages/adapters/src/postgres/schema.ts` (modify) | exact (add brokerTokens table) |
| `packages/adapters/src/postgres/migrations/NNNN_broker_tokens.sql` | migration | — | `packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql` | exact |
| `packages/core/src/brokerage/application/ports.ts` | port interface | — | `packages/core/src/journal/application/ports.ts` | exact (port type definitions) |
| `packages/core/src/brokerage/application/refreshToken.ts` | use-case | request-response | `packages/core/src/journal/application/getStatus.ts` | role-match (use-case factory) |
| `packages/core/src/brokerage/application/getPositions.ts` | use-case | request-response | `packages/core/src/journal/application/getStatus.ts` | role-match |
| `packages/core/src/brokerage/domain/token-freshness.ts` | domain | — | `packages/core/src/journal/domain/rth-window.ts` | role-match (pure domain logic) |
| `packages/contracts/src/status.ts` | Zod contract | — | `packages/contracts/src/status.ts` (modify) | exact |
| `packages/core/src/journal/application/getStatus.ts` | use-case | — | `packages/core/src/journal/application/getStatus.ts` (modify) | exact |
| `apps/server/src/adapters/http/status.routes.ts` | HTTP route | request-response | `apps/server/src/adapters/http/status.routes.ts` (modify) | exact |
| `apps/server/src/adapters/mcp/tools.ts` | MCP tool | request-response | `apps/server/src/adapters/mcp/tools.ts` (modify) | exact |
| `apps/auth/src/main.ts` | CLI entrypoint | request-response | `apps/server/src/config.ts` + `apps/server/src/main.ts` | partial (no direct CLI analog) |

---

## Pattern Assignments

### `packages/adapters/src/schwab/auth/oauth-client.ts` (driven adapter, request-response)

**Analog:** `packages/adapters/src/http/cboe.ts`

**Imports pattern** (cboe.ts lines 1-4):
```typescript
import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
// Import port types from @morai/core — never import Drizzle or process.env here
```

**Factory pattern** (cboe.ts lines 150-153) — copy this shape exactly:
```typescript
export function makeSchwabOAuthClient(config: {
  readonly appKey: string;
  readonly appSecret: string;
  readonly callbackUrl: string;
  readonly fetch: typeof globalThis.fetch;  // injected, never globalThis direct
}): SchwabOAuthClient {
```

**Zod parse at boundary** (cboe.ts lines 176-182) — every Schwab response goes through safeParse before core sees it:
```typescript
const parsed = SchwabTokenResponseSchema.safeParse(rawBody);
if (parsed.success !== true) {
  return err({
    kind: 'oauth-error',
    message: `Schwab token parse error: ${parsed.error.message}`,
  });
}
```

**HTTP fetch + error handling** (cboe.ts lines 158-173):
```typescript
let rawBody: unknown;
try {
  const response = await deps.fetch(url, { headers: { ... } });
  if (!response.ok) {
    return err({ kind: 'oauth-error', message: `Schwab returned HTTP ${response.status}` });
  }
  rawBody = await response.json();
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err({ kind: 'oauth-error', message });
}
```

**What to change:** The token endpoint uses `POST` with `application/x-www-form-urlencoded` body and `Authorization: Basic base64(appKey:appSecret)` header. `exchangeCode` and `refreshTokens` are two methods (not a single `fetchChain`). The `SchwabOAuthClient` type is an object with three functions (`buildAuthUrl`, `exchangeCode`, `refreshTokens`) rather than a single-function port. Error kind is `'oauth-error'` with code discriminator (`'invalid_grant' | 'invalid_client' | 'network' | 'parse'`). Never log the Basic auth header value.

---

### `packages/adapters/src/schwab/market/chain-adapter.ts` (driven adapter, request-response)

**Analog:** `packages/adapters/src/http/cboe.ts` — direct mirror

**Adapter type export** (cboe.ts lines 136-138):
```typescript
export type SchwabChainAdapter = {
  readonly fetchChain: ForFetchingChain;
};
```

**Factory with injected deps** (cboe.ts lines 150-153):
```typescript
export function makeSchwabChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<Result<string, AuthExpiredError>>;
  userAgent: string;
}): SchwabChainAdapter {
```

**fetchChain implementation skeleton** (mirrors cboe.ts lines 154-238):
```typescript
const fetchChain: ForFetchingChain = async (
  root: "SPX" | "SPXW",
): Promise<Result<RawChain, FetchError>> => {
  // 1. Check access token freshness first
  const tokenResult = await deps.getAccessToken();
  if (!tokenResult.ok) {
    return err({ kind: "fetch-error", message: "AUTH_EXPIRED" });
  }
  // 2. Fetch from Schwab API with Authorization: Bearer header
  // 3. Zod-parse via SchwabChainResponseSchema.safeParse (never throw)
  // 4. Flatten callExpDateMap / putExpDateMap → RawQuote[]
  // 5. Return ok(chain)
};
return { fetchChain };
```

**Spot price** (cboe.ts lines 187-197 analog): Use `response.underlyingPrice` (top-level field) instead of `data.current_price ?? data.close ?? data.prev_day_close`.

**Symbol conversion:** Schwab symbol `"SPX  250620P07100000"` → parse root/date/type/strike → call `formatOccSymbol` from `@morai/shared` (same as `osiToOcc` in cboe.ts lines 55-87, but input is Schwab padded format not CBOE OSI compact).

**Source tag:** Tag `ObservationRow.source` as `'schwab_chain'` (not `'cboe'`). Requires widening `ObservationRow.source` in `ports.ts` from `"cboe"` to `"cboe" | "schwab_chain"`.

---

### `packages/adapters/src/schwab/market/chain-adapter.test.ts` (test, request-response)

**Analog:** `packages/adapters/src/http/cboe.test.ts` — direct mirror

**msw setup** (cboe.test.ts lines 1-24):
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { makeSchwabChainAdapter } from "./chain-adapter.ts";
import schwabChainFixture from "../../test/fixtures/schwab-chain.fixture.json";

const SCHWAB_CHAIN_URL = "https://api.schwabapi.com/marketdata/v1/chains";

const server = setupServer(
  http.get(SCHWAB_CHAIN_URL, () => HttpResponse.json(schwabChainFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**Error path tests** (cboe.test.ts lines 91-155 pattern): Add Schwab-specific error cases: AUTH_EXPIRED (mock 401 → `err({kind:'fetch-error', message:'AUTH_EXPIRED'})`), `invalid_grant` on 400, failed Zod parse → `Result.err` not thrown exception.

---

### `packages/adapters/src/schwab/market/chain-adapter.contract.test.ts` (contract test)

**Analog:** `packages/adapters/src/http/cboe.contract.test.ts` — copy exactly, swap adapter:

```typescript
import { describe, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { runChainContractTests } from "../../__contract__/chain.contract.ts";
import { makeSchwabChainAdapter } from "./chain-adapter.ts";
import schwabChainFixture from "../../test/fixtures/schwab-chain.fixture.json";

const server = setupServer(
  http.get("https://api.schwabapi.com/marketdata/v1/chains", () =>
    HttpResponse.json(schwabChainFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("schwab chain adapter (msw-backed)", () => {
  runChainContractTests(() => {
    const adapter = makeSchwabChainAdapter({
      fetch: globalThis.fetch,
      getAccessToken: async () => ok("test-access-token"),
      userAgent: "Morai-Test/1.0",
    });
    return { fetchChain: adapter.fetchChain };
  });
});
```

---

### `packages/adapters/src/schwab/trader/positions-adapter.ts` and `transactions-adapter.ts` (driven adapters)

**Analog:** `packages/adapters/src/http/cboe.ts` — same factory pattern, different ports

**Factory shape** (mirrors cboe.ts lines 150-153):
```typescript
export function makeSchwabPositionsAdapter(deps: {
  fetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<Result<string, AuthExpiredError>>;
  userAgent: string;
}): { fetchPositions: ForFetchingPositions } {
```

**Error type:** New `AuthExpiredError = { readonly kind: 'auth-expired' }` returned alongside `FetchError` when Schwab returns 401/400 invalid_grant. Define in `packages/core/src/brokerage/application/ports.ts`.

**Account hash:** Must call `/trader/v1/accounts/accountNumbers` first to get `hashValue`. Inject `accountHash` as a dep or accept as a function parameter (not hardcoded).

---

### `packages/adapters/src/postgres/repos/broker-tokens.ts` (driven adapter, CRUD)

**Analog:** `packages/adapters/src/postgres/repos/leg-observations.ts`

**Repo type + factory** (leg-observations.ts lines 37-47):
```typescript
export type PostgresBrokerTokensRepo = {
  readonly readTokens: ForReadingTokens;
  readonly writeTokens: ForWritingTokens;
  readonly readTokenFreshness: ForReadingTokenFreshness;
};

export function makePostgresBrokerTokensRepo(
  db: Db,
  encryptionKey: string,   // TOKEN_ENCRYPTION_KEY — injected, never read from process.env here
): PostgresBrokerTokensRepo {
```

**Drizzle sql template for pgcrypto** — key as bound parameter, never sql.raw():
```typescript
import { sql, eq } from "drizzle-orm";
import { brokerTokens } from "../schema.ts";

// WRITE
await db.insert(brokerTokens).values({
  appId: appId,
  accessToken: sql`pgp_sym_encrypt(${accessToken}, ${encryptionKey})`,
  refreshToken: sql`pgp_sym_encrypt(${refreshToken}, ${encryptionKey})`,
  issuedAt: new Date(),
  refreshIssuedAt: new Date(),
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  updatedAt: new Date(),
}).onConflictDoUpdate({ target: brokerTokens.appId, set: { ... } });

// READ
const rows = await db
  .select({
    accessToken: sql<string>`pgp_sym_decrypt(${brokerTokens.accessToken}, ${encryptionKey})`,
    refreshToken: sql<string>`pgp_sym_decrypt(${brokerTokens.refreshToken}, ${encryptionKey})`,
    issuedAt: brokerTokens.issuedAt,
    refreshIssuedAt: brokerTokens.refreshIssuedAt,
    expiresAt: brokerTokens.expiresAt,
  })
  .from(brokerTokens)
  .where(eq(brokerTokens.appId, appId));
```

**Error handling** (leg-observations.ts lines 78-81):
```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

**CRITICAL — never log:** Never call `console.warn` or `console.error` with the `encryptionKey` or any token values. Log only `appId` and timestamps.

---

### `packages/adapters/src/memory/broker-tokens.ts` (in-memory twin, CRUD)

**Analog:** `packages/adapters/src/memory/chain.ts` — copy structure exactly

**In-memory twin pattern** (chain.ts lines 1-41):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingTokens, ForWritingTokens, ForReadingTokenFreshness, ... } from "@morai/core";

export type MemoryBrokerTokensRepo = {
  readonly readTokens: ForReadingTokens;
  readonly writeTokens: ForWritingTokens;
  readonly readTokenFreshness: ForReadingTokenFreshness;
  readonly seed: (appId: 'trader' | 'market', tokens: SchwabTokenRow) => Promise<void>;
};

export function makeMemoryBrokerTokensRepo(): MemoryBrokerTokensRepo {
  const store = new Map<string, SchwabTokenRow>();

  const readTokens: ForReadingTokens = async (appId) => {
    const row = store.get(appId);
    if (row === undefined) return ok(null);
    return ok(row);
  };

  const seed = async (appId: 'trader' | 'market', tokens: SchwabTokenRow): Promise<void> => {
    store.set(appId, tokens);
  };

  return { readTokens, writeTokens, readTokenFreshness, seed };
}
```

---

### `packages/adapters/src/postgres/schema.ts` (modify — add brokerTokens table)

**Analog:** `packages/adapters/src/postgres/schema.ts` (existing file, surgical add)

**Pattern for new table** (schema.ts lines 1-13 for imports, lines 36-52 for table shape):
```typescript
import { bytea } from "drizzle-orm/pg-core";  // or customType for bytea

export const brokerTokens = pgTable("broker_tokens", {
  appId: text("app_id").primaryKey(),           // 'trader' | 'market'
  accessToken: customType<{ data: string; driverData: Buffer }>({...})("access_token").notNull(),
  refreshToken: customType<{ data: string; driverData: Buffer }>({...})("refresh_token").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  refreshIssuedAt: timestamp("refresh_issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
```

The `bytea` column type for pgcrypto output — use `customType` from `drizzle-orm/pg-core` (open question A6 from RESEARCH.md — verify in Wave 0 testcontainers test).

---

### `packages/adapters/src/postgres/migrations/NNNN_broker_tokens.sql` (migration)

**Analog:** `packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql` + `0000_careless_azazel.sql`

**Migration pattern** (generated by `drizzle-kit generate` then hand-checked):
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "broker_tokens" (
  "app_id"            text PRIMARY KEY,
  "access_token"      bytea NOT NULL,
  "refresh_token"     bytea NOT NULL,
  "issued_at"         timestamptz NOT NULL,
  "refresh_issued_at" timestamptz NOT NULL,
  "expires_at"        timestamptz NOT NULL,
  "updated_at"        timestamptz NOT NULL
);
```

**Note:** The `CREATE EXTENSION IF NOT EXISTS pgcrypto` MUST be the first statement. Drizzle-kit generate will not add this automatically — it must be hand-prepended.

---

### `packages/core/src/brokerage/application/ports.ts` (port interface)

**Analog:** `packages/core/src/journal/application/ports.ts` — copy structure

**Port type naming convention** (ports.ts lines 93-154):
```typescript
// ForVerbingNoun convention — fine-grained function types

export type AuthExpiredError = {
  readonly kind: 'auth-expired';
  readonly appId: 'trader' | 'market';
};

export type ForReadingTokens = (
  appId: 'trader' | 'market',
) => Promise<Result<SchwabTokenRow | null, StorageError>>;

export type ForWritingTokens = (
  appId: 'trader' | 'market',
  tokens: SchwabTokenRow,
) => Promise<Result<void, StorageError>>;

export type ForReadingTokenFreshness = () => Promise<
  Result<TokenFreshnessMap | 'none yet', StorageError>
>;

export type ForFetchingPositions = (
  accountHash: string,
) => Promise<Result<ReadonlyArray<BrokerPosition>, FetchError | AuthExpiredError>>;

export type ForFetchingTransactions = (
  accountHash: string,
  from: string,  // YYYY-MM-DD
  to: string,
) => Promise<Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>>;
```

**Domain types** (ports.ts lines 19-91 for Calendar, RawQuote etc. as pattern for BrokerPosition, BrokerTransaction — readonly fields, no Zod in core):
```typescript
export type BrokerPosition = {
  readonly occSymbol: OccSymbol;
  readonly putCall: 'C' | 'P';
  readonly longQty: number;
  readonly shortQty: number;
  readonly averagePrice: number | null;
  readonly marketValue: number | null;
  readonly underlyingSymbol: string;
};
```

**What to change:** No Drizzle, no `process.env`, no Hono in this file — `core` imports `shared` only. The `StorageError` and `FetchError` types are already defined in `journal/application/ports.ts` — re-export or duplicate (cross-context import of domain types is allowed through the port — NOT through `domain/` sub-path).

---

### `packages/core/src/brokerage/application/refreshToken.ts` (use-case)

**Analog:** `packages/core/src/journal/application/getStatus.ts` — direct mirror

**Use-case factory pattern** (getStatus.ts lines 25-71):
```typescript
// Factory — makeXxx(deps) → driver port
export function makeRefreshTokenUseCase(deps: {
  readonly readTokens: ForReadingTokens;
  readonly writeTokens: ForWritingTokens;
  readonly refreshTokens: (refreshToken: string) => Promise<Result<SchwabTokens, OAuthError>>;
}): ForRefreshingToken {
  return async (appId: 'trader' | 'market') => {
    // 1. Read current tokens from DB
    // 2. Call OAuth refreshTokens
    // 3. On invalid_grant → return err({ kind: 'auth-expired', appId })
    // 4. On success → write new tokens via writeTokens → return ok(newTokens)
  };
}
```

**Absorb errors like getStatus** (getStatus.ts lines 33-57): Do not throw across the port. Map all error shapes to typed `Result` variants.

---

### `packages/core/src/brokerage/domain/token-freshness.ts` (domain, pure)

**Analog:** `packages/core/src/journal/domain/rth-window.ts` — pure functions, no imports from adapters

**Domain purity pattern** (rth-window.ts pattern):
```typescript
// packages/core/src/brokerage/domain/token-freshness.ts
// Pure functions only — no imports except @morai/shared

export function isTokenExpired(refreshIssuedAt: Date, now: Date): boolean {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return now.getTime() - refreshIssuedAt.getTime() > sevenDaysMs;
}

export function isTokenStale(expiresAt: Date, now: Date): boolean {
  const bufferMs = 60 * 1000; // 60-second clock-skew buffer
  return now.getTime() > expiresAt.getTime() - bufferMs;
}

export function toAppTokenStatus(
  row: SchwabTokenRow | null,
  now: Date,
): AppTokenStatus {
  if (row === null) return { status: 'none_yet', expiresAt: null, refreshIssuedAt: null };
  if (isTokenExpired(row.refreshIssuedAt, now)) return { status: 'AUTH_EXPIRED', ... };
  if (isTokenStale(row.expiresAt, now)) return { status: 'stale', ... };
  return { status: 'fresh', ... };
}
```

---

### `packages/contracts/src/status.ts` (modify — breaking change)

**Analog:** `packages/contracts/src/status.ts` (existing, surgical edit)

**Current shape to replace** (status.ts lines 16-28):
```typescript
// BEFORE (line 18):
tokenFreshness: z.literal("none yet"),
```

**New shape** (RESEARCH.md §AUTH_EXPIRED Degradation Wiring):
```typescript
export const appTokenStatus = z.object({
  status: z.enum(['fresh', 'stale', 'AUTH_EXPIRED', 'none_yet']),
  expiresAt: z.string().datetime().nullable(),
  refreshIssuedAt: z.string().datetime().nullable(),
});

export const tokenFreshnessMap = z.object({
  trader: appTokenStatus,
  market: appTokenStatus,
});

// AFTER tokenFreshness line:
tokenFreshness: z.union([z.literal('none yet'), tokenFreshnessMap]),
```

**Shared schema rule** (status.ts line 3 comment): MCP-02 — ONE schema source for both HTTP route and MCP tool. Both adapters import this; a one-sided change fails typecheck. Update `status.test.ts` in the same commit.

---

### `packages/core/src/journal/application/getStatus.ts` (modify — add tokenFreshness port)

**Analog:** `packages/core/src/journal/application/getStatus.ts` (existing file)

**Deps to add** (getStatus.ts lines 25-30):
```typescript
export function makeGetStatusUseCase(deps: {
  readonly pingDb: ForPingingDb;
  readonly readJobRuns: ForReadingJobRuns;
  readonly readTokenFreshness: ForReadingTokenFreshness;  // ADD THIS
  readonly version: string;
  readonly startedAt: Date;
}): ForGettingStatus {
```

**StatusPayload to update** (getStatus.ts lines 8-16):
```typescript
export type StatusPayload = {
  readonly db: "ok" | "down";
  // CHANGE: was "none yet"; now union
  readonly tokenFreshness: "none yet" | TokenFreshnessMap;
  readonly lastJobRuns: "none yet" | JobRunMap;
  readonly version: string;
  readonly uptime: number;
};
```

**Error absorption pattern to copy** (getStatus.ts lines 33-57 for pingDb / readJobRuns):
```typescript
let tokenFreshness: "none yet" | TokenFreshnessMap;
try {
  const freshnessResult = await deps.readTokenFreshness();
  tokenFreshness = freshnessResult.ok ? freshnessResult.value : "none yet";
} catch {
  tokenFreshness = "none yet";
}
```

---

### `apps/server/src/adapters/http/status.routes.ts` (modify)

**Analog:** `apps/server/src/adapters/http/status.routes.ts` (existing, ~30 lines)

**No logic change needed** (status.routes.ts lines 17-27): The route already calls `getStatus()` and pipes result through `statusResponse.parse(result.value)`. The contract schema update propagates automatically. Update only if the use-case signature changes require a new injection.

---

### `apps/server/src/adapters/mcp/tools.ts` (modify — registerGetStatusTool)

**Analog:** `apps/server/src/adapters/mcp/tools.ts` lines 26-58

**No change to the tool itself** — `statusResponse.parse(result.value)` in `registerStatusTool` auto-picks up the contract change. If new brokerage tools are added (get_positions, get_transactions), copy `registerGetJournalTool` pattern (tools.ts lines 106-159) — same `safeParse` guard on input, call use-case, `schema.parse(result.value)`, return `{content:[{type:'text',text:JSON.stringify(payload)}]}`.

---

### `apps/server/src/main.ts` (modify — wire new repos + use-cases)

**Analog:** `apps/server/src/main.ts` (existing composition root)

**Wiring pattern** (main.ts lines 8-55):
```typescript
// 1. Import new repos from @morai/adapters
import { makePostgresBrokerTokensRepo } from "@morai/adapters";

// 2. Build broker-tokens repo with injected encryption key from config
const brokerTokensRepo = makePostgresBrokerTokensRepo(db, config.TOKEN_ENCRYPTION_KEY);

// 3. Wire getStatus with new readTokenFreshness dep
const getStatus = makeGetStatusUseCase({
  pingDb: calendarsRepo.pingDb,
  readJobRuns: jobRunsRepo.readJobRuns,
  readTokenFreshness: brokerTokensRepo.readTokenFreshness,  // NEW
  version,
  startedAt,
});
```

**Config pattern** (config.ts lines 3-14): Add `TOKEN_ENCRYPTION_KEY` to `configSchema`:
```typescript
TOKEN_ENCRYPTION_KEY: z.string().min(32, "TOKEN_ENCRYPTION_KEY must be at least 32 chars"),
SCHWAB_TRADER_APP_KEY: z.string().min(1),
SCHWAB_TRADER_APP_SECRET: z.string().min(1),
SCHWAB_TRADER_CALLBACK_URL: z.string().url(),
SCHWAB_MARKET_APP_KEY: z.string().min(1),
SCHWAB_MARKET_APP_SECRET: z.string().min(1),
SCHWAB_MARKET_CALLBACK_URL: z.string().url(),
```

---

### `apps/auth/src/main.ts` + subcommand files (CLI entrypoint)

**No direct CLI analog exists in the codebase.** Use RESEARCH.md patterns + the composition root pattern.

**Closest analog — composition root** (apps/server/src/main.ts lines 1-102 for wiring pattern, config.ts lines 3-56 for config parsing):

**CLI dispatch pattern** (no existing analog — hand-roll using Bun `process.argv`):
```typescript
// apps/auth/src/main.ts
import { parseConfig, bootConfig } from "./config.ts";

const [,, subcommand, ...rest] = process.argv;

const config = bootConfig();  // same pattern as server config.ts

switch (subcommand) {
  case "setup":   await runSetup(config, rest); break;
  case "refresh": await runRefresh(config, rest); break;
  case "status":  await runStatus(config); break;
  case "doctor":  await runDoctor(config); break;
  default:
    console.error(`Unknown subcommand: ${subcommand ?? "(none)"}`);
    process.exit(1);
}
```

**Loopback listener:** Use `Bun.serve()` with `tls:` option (RESEARCH.md §Loopback OAuth Capture Pattern). Derive the port from `config.SCHWAB_*_CALLBACK_URL` — parse with `new URL(callbackUrl).port`. No hardcoded port.

---

## Shared Patterns

### Result type (applied to ALL new files)

**Source:** `packages/shared/src/result.ts`
**Apply to:** Every function returning `Promise<Result<T,E>>` in adapters and core

```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";

// ok path:
return ok(value);
// err path:
return err({ kind: "fetch-error", message });
// never throw across port boundary
```

### Factory function (not class) — applied to ALL adapters and use-cases

**Source:** `packages/adapters/src/http/cboe.ts` lines 150-153, `packages/core/src/journal/application/getStatus.ts` lines 25-31

```typescript
// Named export: makeXxx(deps) — never `new Xxx()`
export function makeXxxAdapter(deps: { ... }): XxxAdapter {
  // closure over deps — no this, no class
}
```

### Zod parse at boundary — applied to all new HTTP adapters

**Source:** `packages/adapters/src/http/cboe.ts` lines 176-182
**Apply to:** `oauth-client.ts`, `chain-adapter.ts`, `positions-adapter.ts`, `transactions-adapter.ts`

```typescript
const parsed = SomeSchema.safeParse(rawBody);
if (parsed.success !== true) {
  return err({ kind: "fetch-error", message: `parse error: ${parsed.error.message}` });
}
// Use parsed.data — never rawBody directly
```

Schema design: `.passthrough()` on objects to avoid breaking on new Schwab fields. All fields `optional()` since Schwab API shapes are assumed/MEDIUM confidence.

### No console.log — warn/error only

**Source:** `packages/adapters/src/postgres/repos/leg-observations.ts` line 198
**Apply to:** All new files

```typescript
// ONLY these two are allowed:
console.warn("message");
console.error("message");
// NEVER: console.log(...)
// NEVER: console.warn(encryptionKey) or console.warn(accessToken)
```

### msw test server lifecycle — applied to all new HTTP adapter tests

**Source:** `packages/adapters/src/http/cboe.test.ts` lines 10-16

```typescript
const server = setupServer(...);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Use `{ onUnhandledRequest: "error" }` in unit tests (catches missed routes), `"warn"` in contract tests.

### MCP-02 — HTTP route + MCP tool in same PR

**Source:** `apps/server/src/adapters/http/status.routes.ts` + `apps/server/src/adapters/mcp/tools.ts`
**Apply to:** Every new use-case (getPositions, getTransactions, getTokenFreshness)

Pattern: both adapters import the SAME Zod schema from `@morai/contracts`. Route: `c.json(schema.parse(result.value))`. MCP tool: `JSON.stringify(schema.parse(result.value))` in content text.

---

## Files with No Analog

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/auth/src/main.ts` + subcommands | CLI entrypoint | request-response | No CLI app exists in the project yet — nearest reference is server/main.ts composition root + Bun docs for `process.argv` + `Bun.serve(tls:...)` |
| `packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts` | contract test (testcontainers) | CRUD | Existing contract tests use Postgres repos but none exercise pgcrypto — must hand-build using testcontainers pattern from `testing-tdd.md` |

---

## Key Constraint Reminders (for planner)

1. **ObservationRow.source widening** — `ports.ts` line 78 has `source: "cboe"` hardcoded. Must change to `"cboe" | "schwab_chain"` before the Schwab market adapter can compile. This is a cross-cutting change: `ports.ts` → `SnapshotRow.source` (line 205) → adapter tests → any typed consumer.

2. **statusResponse breaking change** — `packages/contracts/src/status.ts` line 18 `tokenFreshness: z.literal("none yet")` must change before `getStatus.ts` can return per-app freshness. Update contracts + core + both adapters + all status tests in one wave.

3. **encryptionKey injection** — `TOKEN_ENCRYPTION_KEY` flows: `process.env` → `parseConfig()` in `apps/*/src/config.ts` → composition root → `makePostgresBrokerTokensRepo(db, config.TOKEN_ENCRYPTION_KEY)`. Never appears in any other file.

4. **Package legitimacy gate** — `oauth-callback` and `open` are `[ASSUMED]`. Planner MUST run legitimacy check before emitting install tasks. Fallback: hand-roll `Bun.serve({ tls: { cert, key } })` loopback listener (~40 lines).

5. **Architecture boundary** — `packages/core/src/brokerage/` MUST NOT import from `packages/adapters/`, `drizzle-orm`, `hono`, `process.env`, or any Schwab-specific type. Core imports `@morai/shared` only.

---

## Metadata

**Analog search scope:** `packages/adapters/src/`, `packages/core/src/`, `packages/contracts/src/`, `apps/server/src/`, `apps/worker/src/`
**Files scanned:** 22 source files read in full
**Pattern extraction date:** 2026-06-19
