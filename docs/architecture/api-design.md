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
| `GET /api/analytics/term-structure` | current + historical term slope |
| `GET /api/analytics/skew` | skew observations |
| `POST /api/jobs/:name/trigger` | manual job trigger (rebuild-journal etc.) — enqueues, returns job id |

Mutations are rare by design — data flows in via jobs, not user POSTs. The journal is rebuilt
from broker fills, not edited.

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
