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
  GexContextForPicker,
  ForReadingGexContext,
  PickerGate,
  PickerGateBrakes,
  PickerSnapshot,
  PickerSnapshotRow,
  ForPersistingPickerSnapshot,
  ForReadingPickerSnapshot,
  ForReadingDailySpotCloses,
  ForReadingPickerSlopeHistory,
  ForRunningComputePicker,
  ForRunningGetPicker,
} from "./application/ports.ts";

// PICK-02 (19-07): get-picker read use-case — shared by GET /api/picker/candidates +
// get_picker_candidates MCP tool over the ONE pickerSnapshotResponse contract (MCP-02).
export { makeGetPickerUseCase } from "./application/getPicker.ts";

// PICK-01/PICK-03 (19-08): compute-picker use-case — chain-triggered by compute-gex-snapshot
// (D-04); reads chain+GEX+events, scores candidates, persists exactly one snapshot row.
export { makeComputePickerSnapshotUseCase } from "./application/computePickerSnapshot.ts";
// PICK-04 (27-02): additive reuse exports — the backtest harness must reuse (never
// reimplement) these pure picker domain functions/types. Zero live-behavior change; every
// live call site is unaffected by this barrel wiring.
export { selectCandidates, haircutFill } from "./domain/candidate-selection.ts";
export type {
  SelectCandidatesParams,
  SelectCandidatesResult,
  GateDrops,
} from "./domain/candidate-selection.ts";
export { scoreCalendarCandidates } from "./domain/scoring.ts";
export type { ScoringParams } from "./domain/scoring.ts";
export { RULE_SET_METADATA } from "./domain/rules.ts";
export type { RuleMetadata } from "./domain/rules.ts";
export type {
  RawCandidate,
  ScoredCandidate,
  BreakdownEntry,
  BreakdownCriterion,
  ContextEntry,
  ExitPlan,
} from "./domain/types.ts";
export { realizedVol } from "./domain/realized-vol.ts";
export { rankAndCapCandidates, PICKER_TOP_N } from "./application/computePickerSnapshot.ts";
