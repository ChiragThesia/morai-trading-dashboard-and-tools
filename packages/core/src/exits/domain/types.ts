/**
 * Exits domain types (Phase 26, Plan 01) — declarations only; the pure evaluator that produces
 * `ExitVerdict` from `HeldPosition` + `MarketContext` + `PreviousVerdict` lands in 26-02.
 *
 * Mirrors contracts/src/exits.ts field-for-field (readonly domain mirror, same convention as
 * picker/domain/types.ts vs contracts/src/picker.ts).
 *
 * Hexagon law (architecture-boundaries §2): pure structural types, no imports needed.
 */

/** HeldPosition — the open-calendar inputs the evaluator reads (journal-owned, read-only). */
export type HeldPosition = {
  readonly calendarId: string;
  readonly name: string;
  /** Strike in points (already converted from any ×1000 chain convention at the read boundary). */
  readonly strike: number;
  readonly qty: number;
  readonly openNetDebit: number;
  readonly frontExpiry: string; // YYYY-MM-DD
  readonly backExpiry: string; // YYYY-MM-DD
};

/** Tier-1 macro event (FOMC/CPI/NFP) — the EVT trigger's input (picker's economic_events, reused read-only). */
export type Tier1EventName = "FOMC" | "CPI" | "NFP";

export type Tier1Event = {
  readonly date: string; // YYYY-MM-DD
  readonly name: Tier1EventName;
};

/** One candidate replacement-front quote for ROLL pricing (+14-21 DTE window). */
export type RollCandidateQuote = {
  readonly expiration: string; // YYYY-MM-DD
  readonly bid: number;
  readonly ask: number;
};

/** RollChainContext — the candidate replacement fronts ROLL pricing selects from (haircutFill-priced). */
export type RollChainContext = {
  readonly candidates: ReadonlyArray<RollCandidateQuote>;
};

/**
 * MarketContext — the latest-snapshot + events + roll-chain inputs the evaluator reads for one
 * held calendar. `marketSession`/staleness gate whether a verdict is `indicative` (Pitfall 4).
 */
export type MarketContext = {
  readonly netMark: number;
  readonly pnlOpen: number;
  readonly spot: number;
  readonly frontIv: number;
  readonly backIv: number;
  readonly dteFront: number;
  readonly dteBack: number;
  readonly snapshotTime: Date;
  readonly cohortNow: Date;
  readonly marketSession: "rth" | "after-hours";
  readonly tier1Events: ReadonlyArray<Tier1Event>;
  readonly rollChain: RollChainContext;
};

/** ExitMetric — the raw metric behind a verdict (EXIT-04: never a bare verdict). */
export type ExitMetric = {
  readonly name: string;
  readonly value: number;
  readonly threshold: number;
};

/** ExitVerdictKind — closed enum, mirrors contracts' exitVerdictEnum. */
export type ExitVerdictKind = "HOLD" | "TAKE" | "STOP" | "ROLL" | "EXIT_PRE_EVENT";

/** ExitRollSuggestion — present only when verdict === "ROLL". */
export type ExitRollSuggestion = {
  readonly suggestedFrontExpiry: string;
  readonly estDebit: number;
};

/** ExitVerdict — the evaluator's output for one held calendar, one cycle. */
export type ExitVerdict = {
  readonly verdict: ExitVerdictKind;
  /** Named rung (e.g. "+10%", "-25%"), null for rules with no rung (EVT, ROLL, HOLD). */
  readonly rung: string | null;
  readonly ruleId: string;
  readonly metric: ExitMetric;
  /** True on AH/stale/gap marks — never render as an actionable STOP/TAKE badge (Pitfall 4). */
  readonly indicative: boolean;
  /** True for STOP/EXIT_PRE_EVENT — escalated visual treatment in the UI (EXIT-09). */
  readonly escalate: boolean;
  readonly roll: ExitRollSuggestion | null;
};

/**
 * PreviousVerdict — the prior cycle's verdict for a calendar, read from the exits context's own
 * `exit_verdicts` table (self-read). Threaded into the evaluator as its third argument so
 * hysteresis (EXIT-05) has state to compare against (RESEARCH Pitfall 3).
 */
export type PreviousVerdict = {
  readonly verdict: ExitVerdictKind;
  readonly rung: string | null;
  readonly ruleId: string;
  readonly armedAt: Date;
} | null;
