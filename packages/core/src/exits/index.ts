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
  ForRunningComputeExitAdvice,
  HeldPositionVerdict,
  ExitRuleSetEntry,
  ExitAdviceSnapshot,
  ForRunningGetExitAdvice,
  ExitPreviewEntry,
  ExitPreviewResult,
  ExitPreviewDeps,
  ForPreviewingExitRuleOverrides,
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

// ─── Pure evaluator (Phase 26, Plan 02) ────────────────────────────────────
export { evaluateExit } from "./domain/evaluate-exit.ts";

// ─── Use-cases (Phase 26, Plan 04) ─────────────────────────────────────────
export { makeComputeExitAdviceUseCase } from "./application/computeExitAdvice.ts";
export type { ComputeExitAdviceDeps } from "./application/computeExitAdvice.ts";
export { makeGetExitAdviceUseCase } from "./application/getExitAdvice.ts";
export type { GetExitAdviceDeps } from "./application/getExitAdvice.ts";

// ─── Exit preview use-case (Phase 32, Plan 03, B2) ─────────────────────────
// Top-level @morai/core barrel (packages/core/src/index.ts) is OWNED by Plan 04 (avoids a
// Wave-1 barrel-edit conflict with Plan 02) — do not re-export there from this plan.
export { makePreviewExitRuleOverridesUseCase } from "./application/previewExitRuleOverrides.ts";

// 29-05 (Runtime Rule Settings): the exits merge fn — 29-13's server composition root
// destructures this to build the settings surface's injected `defaults`.
export { resolveExitRuleConfig } from "./domain/rule-config.ts";
export type { ExitRuleConfig, ExitRuleOverrides } from "./domain/rule-config.ts";
