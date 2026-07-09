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

// ─── Exit rule registry (Phase 26, Plan 02) ────────────────────────────────
export type { ExitRuleId, ExitRuleKind, ExitRuleMetadata, ExitRung } from "./domain/exit-rules.ts";
export {
  EXIT_RULE_METADATA,
  EXIT_PRECEDENCE,
  TAKE_RUNGS,
  STOP_RUNGS,
  TERM_INVERSION_MIN,
  TERM_INVERSION_DISARM,
  GAMMA_OFF_STRIKE,
  GAMMA_OFF_STRIKE_DISARM,
  GAMMA_FRONT_DTE_MAX,
  EVT_BLACKOUT_DAYS,
  ROLL_FRONT_DTE_MAX,
  ROLL_SPOT_BAND,
  ROLL_PROFIT_MAX,
  ROLL_REPLACEMENT_DTE_MIN,
  ROLL_REPLACEMENT_DTE_MAX,
} from "./domain/exit-rules.ts";
