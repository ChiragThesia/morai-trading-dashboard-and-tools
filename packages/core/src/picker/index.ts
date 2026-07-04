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
  ChainQuoteForPicker,
  ForReadingChainForPicker,
  PickerSnapshot,
  PickerSnapshotRow,
  ForPersistingPickerSnapshot,
  ForReadingPickerSnapshot,
  ForRunningGetPicker,
} from "./application/ports.ts";

// PICK-02 (19-07): get-picker read use-case — shared by GET /api/picker/candidates +
// get_picker_candidates MCP tool over the ONE pickerSnapshotResponse contract (MCP-02).
export { makeGetPickerUseCase } from "./application/getPicker.ts";
