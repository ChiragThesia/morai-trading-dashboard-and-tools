// Exits bounded context barrel (Phase 26, Plan 01) — re-exports domain types + driven ports for
// consumption by ./index.ts (the top-level @morai/core barrel). StorageError is NOT re-exported
// here — structurally identical to (and already exported under the same name by) the journal
// context; re-exporting a second type under an existing name would collide (analytics/picker
// index.ts precedent, see their own header comments re: StorageError).

export type {
  HeldPosition,
  Tier1EventName,
  Tier1Event,
  RollCandidateQuote,
  RollChainContext,
  MarketContext,
  ExitMetric,
  ExitVerdictKind,
  ExitRollSuggestion,
  ExitVerdict,
  PreviousVerdict,
} from "./domain/types.ts";

export type {
  ExitVerdictRow,
  LatestSnapshotForCalendar,
  ChainQuoteForRoll,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingEconomicEvents,
  ForReadingChainForRoll,
  ForReadingLatestVerdictsPerCalendar,
  ForPersistingExitVerdict,
} from "./application/ports.ts";
