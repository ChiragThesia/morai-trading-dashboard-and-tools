// Exits bounded context — driven port TYPE declarations (Phase 26, Plan 01). No implementations
// here — 26-03 implements the repo/journal ports, 26-04 wires the use-case. Hexagon law
// (architecture-boundaries §2): this file imports ONLY @morai/shared + this context's own
// ./domain/types.ts. Never a foreign context's domain import (architecture-boundaries §7) —
// every read shape below is an exits-owned re-declaration, not an import of journal's or
// picker's domain types (RESEARCH: "own application ports, never a foreign domain/ import").
//
// EXIT-10 guard: this file MUST NOT import or declare anything resembling `ForPlacingOrder` —
// the advisor only advises, it never executes (STRM-04). No order-placement port exists
// anywhere in this repo; keep it that way here.

import type { Result } from "@morai/shared";
import type { ExitVerdict, HeldPosition, Tier1Event } from "../domain/types.ts";

/** StorageError — driven-port failure for exits reads/writes (structurally mirrors journal's). */
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

/**
 * ExitVerdictRow — one persisted `exit_verdicts` row (append-only, keyed
 * `(observed_at, calendar_id)`, `onConflictDoNothing` — 26-03's idempotency convention).
 * `verdict.changed` is the write-time change-detection flag computeExitAdvice.ts attaches via
 * hasChanged() before persisting (EXIT-09 gap closure, 26-VERIFICATION.md) — optional because
 * a row persisted before this fix has no `changed` key; readers treat an absent value as
 * `false` (matches the contract schema's `.default(false)`, getExitAdvice.ts).
 */
export type ExitVerdictRow = {
  readonly observedAt: Date;
  readonly calendarId: string;
  readonly verdict: ExitVerdict & { readonly changed?: boolean };
};

/**
 * LatestSnapshotForCalendar — the per-open-calendar latest snapshot read the evaluator needs.
 * An exits-owned re-declaration of the journal `calendar_snapshots` row shape — implemented via
 * a fresh `DISTINCT ON (calendar_id)` query, NEVER `readJournal`/`mapSnapshotRow` (RESEARCH
 * Pitfall 1: that function silently drops `schwab_chain`-sourced rows).
 */
export type LatestSnapshotForCalendar = {
  readonly calendarId: string;
  readonly time: Date;
  readonly netMark: number;
  readonly pnlOpen: number;
  readonly spot: number;
  readonly frontIv: number;
  readonly backIv: number;
  readonly dteFront: number;
  readonly dteBack: number;
};

/**
 * ChainQuoteForRoll — one leg quote read for ROLL replacement-front pricing. An exits-owned
 * re-declaration of the chain-read shape (never a picker/domain import).
 */
export type ChainQuoteForRoll = {
  readonly strike: number; // points
  readonly expiration: string; // YYYY-MM-DD
  readonly contractType: "C" | "P";
  readonly bid: number;
  readonly ask: number;
};

// ─── Driven ports — ForVerbingNoun (architecture-boundaries §5) ────────────────

/** ForReadingHeldPositions — read every currently-open calendar (journal-owned, read-only). */
export type ForReadingHeldPositions = () => Promise<Result<ReadonlyArray<HeldPosition>, StorageError>>;

/**
 * ForReadingLatestSnapshotPerOpenCalendar — read the most recent snapshot for every open
 * calendar, one row per calendar. See `LatestSnapshotForCalendar` doc comment (Pitfall 1).
 */
export type ForReadingLatestSnapshotPerOpenCalendar = () => Promise<
  Result<ReadonlyArray<LatestSnapshotForCalendar>, StorageError>
>;

/** ForReadingEconomicEvents — read persisted tier-1 economic events (picker-owned, reused read-only). */
export type ForReadingEconomicEvents = () => Promise<Result<ReadonlyArray<Tier1Event>, StorageError>>;

/** ForReadingChainForRoll — read leg quotes at a given strike for ROLL replacement-front pricing. */
export type ForReadingChainForRoll = (
  strike: number,
) => Promise<Result<ReadonlyArray<ChainQuoteForRoll>, StorageError>>;

/**
 * ForReadingLatestVerdictsPerCalendar — self-read on the exits context's own `exit_verdicts`
 * table: the most recent verdict for every calendar, feeding hysteresis (Pitfall 3).
 */
export type ForReadingLatestVerdictsPerCalendar = () => Promise<
  Result<ReadonlyArray<ExitVerdictRow>, StorageError>
>;

/** ForPersistingExitVerdict — append one ExitVerdictRow (idempotent on the composite PK). */
export type ForPersistingExitVerdict = (row: ExitVerdictRow) => Promise<Result<void, StorageError>>;

// ─── Driver ports (Phase 26, Plan 04) ──────────────────────────────────────────

/** ForRunningComputeExitAdvice — the per-cycle compute-exit-advice job's driver port. */
export type ForRunningComputeExitAdvice = () => Promise<Result<void, StorageError>>;

/**
 * HeldPositionVerdict — one open calendar's verdict for this cycle, shaped for the API/MCP
 * read surface (mirrors contracts/src/exits.ts `heldPositionVerdict` field-for-field).
 * `pnlPct`/`basis`/`name` are re-derived at READ time from the calendar + latest snapshot
 * (getExitAdvice.ts) — they are NOT part of the persisted `ExitVerdict` blob. `changed` IS
 * part of the persisted blob (EXIT-09 gap closure, 26-VERIFICATION.md): computeExitAdvice.ts
 * computes it at WRITE time via hasChanged() — the same value it already used for its own
 * escalation console.warn — and attaches it to the row before persisting; getExitAdvice.ts
 * reads it straight through (`row.verdict.changed ?? false`), no read-time diff needed.
 */
export type HeldPositionVerdict = {
  readonly calendarId: string;
  readonly name: string;
  /** Strike in points + option type — the Overview verdict-in-row join key (deterministic
   * `${strike}${optionType}` match against the positions table's row label). Read-time derived
   * from the held calendar, never persisted separately (see contracts/src/exits.ts). */
  readonly strike: number;
  readonly optionType: "C" | "P";
  readonly verdict: ExitVerdict;
  readonly changed: boolean;
  /** Null when the P&L basis is non-finite (openNetDebit <= 0, CR-01) — never ±Infinity. */
  readonly pnlPct: number | null;
  readonly basis: {
    readonly openNetDebit: number;
    readonly netMark: number;
  };
};

/** ExitRuleSetEntry — one rule-registry row shipped to the read surface (EXIT-07). */
export type ExitRuleSetEntry = {
  readonly id: string;
  readonly kind: string;
  readonly rationale: string;
};

/** ExitAdviceSnapshot — the getExitAdvice.ts read use-case's output shape. */
export type ExitAdviceSnapshot = {
  readonly asOf: string; // YYYY-MM-DD
  readonly observedAt: Date;
  readonly marketSession: "rth" | "after-hours";
  readonly positions: ReadonlyArray<HeldPositionVerdict>;
  readonly ruleSet: ReadonlyArray<ExitRuleSetEntry>;
};

/** ForRunningGetExitAdvice — the read use-case's driver port. ok(null) at cold start. */
export type ForRunningGetExitAdvice = () => Promise<Result<ExitAdviceSnapshot | null, StorageError>>;
