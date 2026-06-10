# Hexagonal Architecture + DDD

Adapted from [Implementing DDD — Hexagonal](https://eventsandstuff.substack.com/p/implementing-domain-driven-design-hexagonal)
(Go original → TypeScript here).

## The Two Laws

1. **Dependency inversion** — Domain and Application define the interfaces (ports);
   Infrastructure implements them (adapters). Imports always point inward:
   `apps → adapters → core`, never the reverse.
2. **Separation of concerns** — the hexagon (domain + application) contains zero
   infrastructure: no Hono, no Drizzle, no fetch, no pg-boss, no `process.env`.
   Pure TypeScript functions and types.

```
        driving (inbound)                     driven (outbound)
  ┌──────────────────────┐              ┌──────────────────────────┐
  │ http (Hono routes)   │              │ postgres (Drizzle repos) │
  │ mcp (MCP tools)      │   ports      │ schwab (API client)      │
  │ jobs (pg-boss        │──────┐ ┌────▶│ cboe / fred (clients)    │
  │   handlers)          │      ▼ │     │ jobqueue (pg-boss)       │
  └──────────────────────┘  ┌──────────┐│ clock / logger           │
                            │ HEXAGON  │└──────────────────────────┘
                            │ ┌──────┐ │
                            │ │domain│ │   application wraps domain;
                            │ └──────┘ │   defines ALL ports
                            │application│
                            └──────────┘
```

## Vocabulary Mapping

The user-facing vocabulary "API / services / DAO" maps onto hexagonal terms exactly:

| Familiar term | Hexagonal term | Lives in |
|---|---|---|
| API layer (routes/controllers) | Inbound (driving) adapter | `apps/server/src/adapters/http/` |
| Service layer | Application use-cases | `packages/core/src/<context>/application/` |
| DAO layer | Outbound (driven) adapter implementing a repository port | `packages/adapters/postgres/` |
| DTO / API types | Contracts (Zod schemas) | `packages/contracts/` |

## Layers

### Domain (`packages/core/src/<context>/domain/`)
- Entities, value objects, domain services. Pure functions preferred over classes.
- Examples: `Calendar` (legs, strikes, expirations), `OccSymbol`, BSM greeks math,
  IV inversion, skew computation, P&L attribution.
- **May import**: `packages/shared` (Result, assertDefined, time utils). Nothing else.

### Application (`packages/core/src/<context>/application/`)
- Use-cases: one file per command/query handler. Orchestrates domain logic + ports.
- **Defines all ports** (both driving and driven) — see naming below.
- Examples: `snapshotCalendar.ts`, `getJournal.ts`, `rebuildJournalFromFills.ts`.
- **May import**: own domain, own ports, `packages/shared`.

### Infrastructure (adapters)
- **Driven (outbound)** — `packages/adapters/<tech>/`: postgres, schwab, cboe, fred, jobqueue.
  Implement ports. Grouped **by technology** (one Schwab client implements many fine-grained
  ports — grouping by port would shatter it).
- **Driving (inbound)** — live inside the apps that host them: `apps/server/src/adapters/http/`,
  `apps/server/src/adapters/mcp/`, `apps/worker/src/handlers/`. They parse input (Zod), call
  use-cases, format output. **Zero business logic.**

### Composition root (`apps/*/src/main.ts`)
- The ONLY place where core and adapters meet. Construct adapters, inject into use-cases
  (plain function injection — no DI framework), mount inbound adapters.
- Config: `process.env` is read and Zod-parsed HERE, once. A typed config object flows inward.

## Ports: Fine-Grained Function Types

Following the article: ports are **fine-grained function-type interfaces**, not coarse
`IRepository` interfaces. In TypeScript this means a named function type per capability.

```ts
// packages/core/src/journal/application/ports.ts

// Driven ports (what the use-case needs from the world)
export type ForFetchingOptionChain = (
  underlying: string,
  expirations: ReadonlyArray<IsoDate>,
) => Promise<Result<OptionChain, FetchError>>;

export type ForStoringCalendarSnapshot = (
  snapshot: CalendarSnapshot,
) => Promise<Result<void, StorageError>>;

export type ForGettingOpenCalendars = () => Promise<Result<ReadonlyArray<Calendar>, StorageError>>;
```

```ts
// packages/core/src/journal/application/snapshotCalendar.ts

// Driver port (the use-case itself, named for what it does)
export type ForSnapshottingCalendars = (now: Date) => Promise<Result<SnapshotReport, SnapshotError>>;

export function makeSnapshotCalendars(deps: {
  getOpenCalendars: ForGettingOpenCalendars;
  fetchChain: ForFetchingOptionChain;
  storeSnapshot: ForStoringCalendarSnapshot;
}): ForSnapshottingCalendars {
  return async (now) => {
    // orchestrate domain logic; no SQL, no HTTP, no vendor SDK
  };
}
```

**Why function types**: test doubles are plain functions — no mocking framework, no class
hierarchies. A test passes `async () => ok([fixtureCalendar])` and is done.

**Naming convention** (strict):
- Driver ports: `ForDoingSomething` — `ForSnapshottingCalendars`, `ForGettingJournal`.
- Driven ports: `ForVerbingNoun` — `ForFetchingOptionChain`, `ForStoringCalendarSnapshot`.
- Factories: `makeXxx(deps) → port` — explicit dependency injection via a `deps` object.

## Bounded Contexts

Start with four, all inside `packages/core/` (split into separate packages only when a context
needs independent deployment or the package gets unwieldy):

| Context | Owns | Examples |
|---|---|---|
| `market-data` | Quotes, chains, vol surfaces, raw observations | chain fetch/normalize, IV inversion inputs |
| `journal` | Calendars, snapshots, fills, P&L attribution | 30-min snapshot, journal rebuild from fills |
| `analytics` | Derived metrics over stored data | skew, term structure, GEX, regime metrics |
| `brokerage` | Schwab auth/token lifecycle, order/position sync | token refresh, fill ingestion |

Contexts communicate through application-level ports, never by reaching into each other's
domain. Shared primitives (OccSymbol, Money, IsoDate, Result) live in `packages/shared`.

## Per-Context Directory Shape

```
packages/core/src/journal/
├── domain/
│   ├── calendar.ts            # entity + invariants
│   ├── snapshot.ts            # value object
│   └── attribution.ts         # pure P&L decomposition
├── application/
│   ├── ports.ts               # all driven ports for this context
│   ├── snapshotCalendar.ts    # use-case (defines its driver port)
│   ├── getJournal.ts
│   └── rebuildJournal.ts
└── index.ts                   # public surface of the context
```

Acceptance tests live at context level (`packages/core/src/journal/journal.acceptance.test.ts`),
wiring use-cases with in-memory adapters — per the article's test-placement guidance.

## Enforcement (mechanical, not honor-system)

- ESLint boundaries config forbids:
  - `packages/core` importing from `packages/adapters`, `apps`, or any framework/vendor package
    (hono, drizzle-orm, pg-boss, @modelcontextprotocol, node:fs, …).
  - `packages/contracts` importing anything but zod + shared.
  - Cross-context domain imports (`core/src/journal/domain` ← `core/src/analytics/**` forbidden).
- `tsconfig` project references mirror the same graph.
- CI fails on violation. No exceptions, no `eslint-disable` for boundary rules.
