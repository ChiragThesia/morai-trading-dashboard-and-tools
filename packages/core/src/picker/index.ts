// Picker bounded context barrel — re-exports driven ports + row domain types from
// application/ports.ts for consumption by ./index.ts (the top-level @morai/core barrel).
// StorageError and FetchError are NOT re-exported here — both are structurally identical to
// (and already exported under the same names by) the journal context; re-exporting a second
// type under an existing name would collide (analytics/index.ts precedent, see its own header
// comment re: StorageError).
export type {
  EconomicEvent,
  ForFetchingEconomicEvents,
  ForReadingEconomicEvents,
  ForPersistingEconomicEvents,
} from "./application/ports.ts";
