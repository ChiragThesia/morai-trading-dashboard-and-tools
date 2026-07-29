# API Design — Hono + Contracts

## Shape

- Hono app in `apps/server/src/adapters/http/`, mounted under `/api`.
- Every route: **Zod-validate → call use-case → map Result → respond**. Nothing else.
- Hono RPC: the server exports its route types; `apps/web` consumes them via `hc<ApiType>()`
  for end-to-end type-safety without codegen.
- Request/response schemas live in `packages/contracts` — single source shared by server
  validation and web types.

```ts
// apps/server/src/adapters/http/journal.routes.ts
export const journalRoutes = new Hono<Env>()
  .get('/journal/:calendarId',
    zValidator('param', contracts.journal.getParams),
    async (c) => {
      const { calendarId } = c.req.valid('param');
      const result = await c.var.deps.getJournal(calendarId);   // use-case via injected deps
      if (isErr(result)) return c.json(toApiError(result.error), statusOf(result.error));
      return c.json(contracts.journal.getResponse.parse(result.value));
    });
```

## Route Surface (initial)

| Route | Use-case |
|---|---|
| `GET /api/status` | health + token freshness + last job runs |
| `GET /api/calendars` | open/closed calendars list |
| `GET /api/journal/:calendarId` | snapshot series for one calendar (the journal view) |
| `GET /api/greeks` | live net greeks for open positions |
| `GET /api/analytics/term-structure` | current + historical term slope (queryable by `calendarId`) |
| `GET /api/analytics/skew` | risk-reversal series + rank (queryable by `underlying`/`expiration`) |
| `GET /api/chain` | raw option-chain rows — the Analyzer chain table's only source |
| `POST /api/jobs/:name/trigger` | manual job trigger (rebuild-journal etc.) — enqueues, returns job id |

Mutations are rare by design — data flows in via jobs, not user POSTs. The journal is rebuilt
from broker fills, not edited.

### Analytics read shape (Phase 6, ANLY-03 / MCP-02)

Both analytics routes return a JSON array of time-stamped entries, current and historical:

- `GET /api/analytics/skew` → array of `{ time, underlying, expiration, risk_reversal, rr_rank }`
  (`risk_reversal` and `rr_rank` are nullable — null when ±25Δ cannot be bracketed), queryable
  by `underlying` and `expiration`.
- `GET /api/analytics/term-structure` → array of `{ time, calendarId, value }` where
  `value = back_iv − front_iv`, queryable by `calendarId`.

When no data matches, each route returns a contract-valid **EMPTY array, not an error** —
"no data yet" is a normal state, not a failure.

**MCP-02:** the MCP `get_skew` / `get_term_structure` tools return the identical series,
validated against the SAME Zod schema in `packages/contracts/src/analytics.ts`. There is no
second or inline analytics schema; a one-sided change fails `bun run typecheck`.

### Chain read shape (the Analyzer chain surfaces)

`GET /api/chain` serves the raw chain the Analyzer renders. No score, no rank, no verdict —
the numbers only (D29 in [stack-decisions.md](stack-decisions.md)). One entry per contract:

`strike` (the ×1000 int convention, never points), `expiration`, `contractType` (`C` | `P`),
`root` (`SPX` | `SPXW`), `dte`, `bsmIv` (**nullable** — null until the BSM job fills it, never
fabricated), `bid`, `ask`, `openInterest`, `underlyingPrice`, `source`, `observedAt`.

**`root` is part of the row's identity, not decoration.** SPX is AM-settled (third-Friday
monthlies), SPXW is PM-settled (weeklies); both quote the same strikes and their expirations
overlap, so `(strike, expiration, contractType)` is **not unique**. Any consumer building a row
key, grouping a cohort, or joining legs MUST include it. Omitting it shipped once: 242 rows
collided onto one React key, most derived columns dashed because the map kept whichever twin
arrived last, and one row measured an SPXW back leg against an SPX front (back IV 68.89% vs
front 24.69%). That class of defect has every input present and finite, so nothing dashes — the
cell just reads wrong. Server-side the cohort key is `(root, expiration)` throughout the calendar
engine; web-side the one surviving derivation, `riskReversalForExpiry`, takes `root` as a required
parameter rather than trusting the caller to pre-filter.

Rows are the stored per-contract quotes joined to contract metadata — `leg_observations` and
`contracts` in [data-model.md](data-model.md). Nothing is computed at request time.

Like the analytics routes this is an array read: no match returns a contract-valid **empty
array with 200, never a 404**. An empty chain is a normal state, not a failure.

The `get_chain` MCP tool returns the identical array against the same Zod schema in
`packages/contracts` (MCP-02) — one schema, two adapters, a one-sided change fails typecheck.

## Error Model

- Use-cases return `Result<T, DomainError>` — discriminated unions, no exceptions for
  control flow (`packages/shared/result.ts`).
- HTTP adapter owns the mapping: `DomainError.kind → status code + ApiError body`
  (`{ code, message, details? }`, Zod-schema'd in contracts).
- Unexpected throws → 500 + logged with correlation id; never leak internals.

## Services & DAO (vocabulary anchor)

- "Service layer" = application use-cases in `packages/core` — framework-free, injected ports.
- "DAO layer" = repository implementations in `packages/adapters/postgres/repos/` — the only
  code that touches Drizzle. One repo file per aggregate (calendars, snapshots, observations).
- Routes NEVER touch Drizzle or fetch. Repos NEVER format HTTP responses.

## Versioning & Compatibility

- Single client (our web + MCP) → no public versioning yet; breaking contract changes land
  atomically (server + web in one PR — contracts package forces this at compile time).
- If external consumers appear: version under `/api/v2`, keep contracts per version.
