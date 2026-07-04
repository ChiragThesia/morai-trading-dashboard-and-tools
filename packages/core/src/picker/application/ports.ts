// Picker bounded context — driven ports + row domain types.
// Hexagon law (architecture-boundaries §2): this file imports ONLY @morai/shared. No ORM, no
// node builtins, no contracts-package import, no other context's domain. StorageError/FetchError
// are re-declared locally (analytics/journal precedent — no cross-context import).

import type { Result } from "@morai/shared";

// ─── Domain errors (local; mirror the analytics/journal shapes) ────────────────

/** StorageError — driven-port failure for picker reads/writes. */
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

/** FetchError — driven-port failure for external fetches (e.g. economic-events HTTP). */
export type FetchError = {
  readonly kind: "fetch-error";
  readonly message: string;
};

// ─── Row / domain types ─────────────────────────────────────────────────────────

/**
 * EconomicEvent — one scheduled macro event (FOMC/CPI/NFP). `date` is a plain calendar day
 * (YYYY-MM-DD, America/New_York) — never a timestamptz instant (same bug class as the
 * CBOE-UTC lesson, inverted direction; economic-event dates are calendar days, not instants).
 */
export type EconomicEvent = {
  readonly date: string; // YYYY-MM-DD ET calendar day
  readonly name: "FOMC" | "CPI" | "NFP";
  readonly source: "fred" | "seed";
};

/**
 * ChainQuoteForPicker — one leg quote read for candidate selection.
 * `strike` follows the ×1000 integer convention (e.g. 7400000 = 7400 strike) — the domain
 * converts ONCE at the candidate-selection boundary; domain code never sees the ×1000 form.
 */
export type ChainQuoteForPicker = {
  readonly time: Date;
  readonly strike: number; // ×1000 int (e.g. 7400000)
  readonly expiration: string; // YYYY-MM-DD
  readonly contractType: "C" | "P";
  readonly underlyingPrice: number;
  readonly bsmIv: string | null;
  readonly source: "schwab" | "cboe";
};

/**
 * GexContextForPicker — the GEX snapshot the picker scores against (criterion 7).
 * Mirrors pickerGexContext's nullable-field convention plus computedAt for freshness tagging
 * (D-17 gexContextStatus).
 */
export type GexContextForPicker = {
  readonly flip: number | null;
  readonly callWall: number | null;
  readonly putWall: number | null;
  readonly netGammaAtSpot: number;
  readonly absGammaStrike: number | null;
  readonly computedAt: Date;
};

/** PickerCandidateDomain — readonly domain mirror of contracts' pickerCandidate. */
export type PickerCandidateDomain = {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly breakdown: ReadonlyArray<{
    readonly criterion: "slope" | "fwdEdge" | "gexFit" | "eventAdjustment" | "beVsEm";
    readonly weight: number;
    readonly rawValue: number;
    readonly contribution: number;
  }>;
  readonly debit: number;
  readonly theta: number;
  readonly vega: number;
  readonly delta: number;
  readonly fwdIv: number | null;
  readonly fwdIvGuard: "ok" | "inverted";
  readonly slope: number;
  readonly fwdEdge: number;
  readonly expectedMove: number;
  readonly frontEvents: ReadonlyArray<string>;
  readonly backEvents: ReadonlyArray<string>;
  readonly frontLeg: {
    readonly strike: number;
    readonly putCall: "C" | "P";
    readonly dte: number;
    readonly iv: number;
  };
  readonly backLeg: {
    readonly strike: number;
    readonly putCall: "C" | "P";
    readonly dte: number;
    readonly iv: number;
  };
  readonly exitPlan: {
    readonly profitTargetPct: number;
    readonly stopPct: number;
    readonly manageShortDte: number;
    readonly closeByExpiry: string; // YYYY-MM-DD
  };
};

/** PickerSnapshot — readonly domain mirror of contracts' pickerSnapshotResponse. */
export type PickerSnapshot = {
  readonly asOf: string; // YYYY-MM-DD reference date
  readonly spot: number;
  readonly source: "schwab" | "cboe";
  readonly gexContextStatus: "ok" | "stale" | "missing";
  readonly eventsContextStatus: "ok" | "stale" | "missing";
  readonly termStructure: ReadonlyArray<{ readonly dte: number; readonly iv: number }>;
  readonly gex: {
    readonly flip: number | null;
    readonly callWall: number | null;
    readonly putWall: number | null;
    readonly netGammaAtSpot: number;
    readonly absGammaStrike: number | null;
  };
  readonly events: ReadonlyArray<{ readonly date: string; readonly name: string }>;
  readonly candidates: ReadonlyArray<PickerCandidateDomain>;
};

/** PickerSnapshotRow — a persisted picker snapshot (append-only, D-06 keeps history). */
export type PickerSnapshotRow = {
  readonly observedAt: Date;
  readonly snapshot: PickerSnapshot;
};

// ─── Driven ports — ForVerbingNoun (architecture-boundaries §5) ────────────────

/**
 * ForReadingChainForPicker — read the latest full chain cohort for candidate selection.
 * Returns the full chain (all strikes, both calls and puts) at the most recent cycle time.
 */
export type ForReadingChainForPicker = () => Promise<
  Result<ReadonlyArray<ChainQuoteForPicker>, StorageError>
>;

/**
 * ForReadingGexContext — read the most recent GEX context for scoring (criterion 7).
 * Returns ok(null) when no GEX snapshot exists yet.
 */
export type ForReadingGexContext = () => Promise<Result<GexContextForPicker | null, StorageError>>;

/**
 * ForFetchingEconomicEvents — fetch scheduled economic events (FOMC/CPI/NFP) from the
 * external source (FRED release-dates + FOMC seed). No fabricated fallback (D-17) — a
 * failure returns err(FetchError).
 */
export type ForFetchingEconomicEvents = () => Promise<
  Result<ReadonlyArray<EconomicEvent>, FetchError>
>;

/**
 * ForReadingEconomicEvents — read persisted economic_events rows.
 * Returns empty array when none exist.
 */
export type ForReadingEconomicEvents = () => Promise<
  Result<ReadonlyArray<EconomicEvent>, StorageError>
>;

/**
 * ForPersistingEconomicEvents — bulk upsert economic_events rows.
 * Idempotent on the (date, name) composite key.
 */
export type ForPersistingEconomicEvents = (
  rows: ReadonlyArray<EconomicEvent>,
) => Promise<Result<void, StorageError>>;

/**
 * ForPersistingPickerSnapshot — append one PickerSnapshotRow (D-06 append-only history,
 * unlike GEX's upsert-by-cycleTime convention).
 */
export type ForPersistingPickerSnapshot = (
  row: PickerSnapshotRow,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingPickerSnapshot — read the most recently persisted PickerSnapshotRow.
 * Returns ok(null) when no snapshot exists yet.
 */
export type ForReadingPickerSnapshot = () => Promise<Result<PickerSnapshotRow | null, StorageError>>;

/**
 * ForRunningComputePicker — driver port for the compute-picker use-case factory.
 * Called by the pg-boss job handler; reads chain+GEX+events, scores candidates, persists
 * the snapshot. Never recomputed on read (precompute-then-read, mirrors GEX).
 */
export type ForRunningComputePicker = () => Promise<Result<void, StorageError>>;

/**
 * ForRunningGetPicker — driver port for the get-picker use-case factory.
 * Called by the HTTP route and MCP tool; returns the latest stored snapshot or null.
 */
export type ForRunningGetPicker = () => Promise<Result<PickerSnapshotRow | null, StorageError>>;
