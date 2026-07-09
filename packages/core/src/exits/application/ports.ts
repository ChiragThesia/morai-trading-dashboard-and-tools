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
 */
export type ExitVerdictRow = {
  readonly observedAt: Date;
  readonly calendarId: string;
  readonly verdict: ExitVerdict;
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
