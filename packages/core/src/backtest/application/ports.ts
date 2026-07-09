// Backtest bounded context — driven port TYPE declarations (Phase 27, Plan 01). No
// implementations here — 03 implements the read ports, 05 implements the replay
// use-cases, 06 wires the CLI. Hexagon law (architecture-boundaries §2/§7): this file
// imports ONLY @morai/shared + this context's own ./domain/types.ts — never a foreign
// context's domain/ (every read shape below is a backtest-owned re-declaration, not an
// import of picker's/exits'/journal's domain types).
//
// BT-05 guard: this file MUST NOT declare anything resembling `ForWriting*Rules` or
// `ForPersistingRuleWeights` — the harness's only write is `ForPersistingBacktestRun`.
// Keep it that way here.

import type { Result } from "@morai/shared";
import type { BacktestReport } from "../domain/types.ts";

/** StorageError — driven-port failure for backtest reads/writes (structurally mirrors journal's/exits'). */
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

/**
 * BacktestRunRow — one persisted `backtest_runs` row (append-only, generated `id` +
 * `createdAt`, D-06 convention). `params` is the CLI's own request shape (from/to/
 * calendar filter); `report` is the whole BacktestReport as one JSONB blob.
 */
export type BacktestRunRow = {
  readonly params: Record<string, unknown>;
  readonly report: BacktestReport;
};

/** ForPersistingBacktestRun — append one BacktestRunRow. No update/delete counterpart exists (BT-05). */
export type ForPersistingBacktestRun = (
  row: BacktestRunRow,
) => Promise<Result<void, StorageError>>;

// ─── Read ports (03 implements) ────────────────────────────────────────────────

/**
 * ChainLegQuoteAsOf — one leg's quote+greeks as of a bounded read time. Carries both the
 * candidate-generation fields (bid/ask/OI/bsmIv) and the exit-context fields (mark/
 * bsmDelta/bsmGamma/bsmTheta/bsmVega) so one read serves both replay paths (27-RESEARCH.md
 * "As-of-T chain query pattern").
 */
export type ChainLegQuoteAsOf = {
  readonly occSymbol: string;
  readonly strike: number;
  readonly expiration: string; // YYYY-MM-DD
  readonly contractType: "C" | "P";
  readonly bid: number;
  readonly ask: number;
  readonly mark: number;
  readonly bsmIv: number | null;
  readonly bsmDelta: number | null;
  readonly bsmGamma: number | null;
  readonly bsmTheta: number | null;
  readonly bsmVega: number | null;
  readonly openInterest: number;
  readonly underlyingPrice: number;
  readonly source: string;
  readonly time: Date;
};

/** ForReadingChainAsOf — the chain slice visible at or before `asOfT` (no lookahead, BT-01). */
export type ForReadingChainAsOf = (
  asOfT: Date,
) => Promise<Result<ReadonlyArray<ChainLegQuoteAsOf>, StorageError>>;

/** ForReadingDailySpotClosesAsOf — the last `nDays` daily closes at or before `asOfT` (RV20 input). */
export type ForReadingDailySpotClosesAsOf = (
  nDays: number,
  asOfT: Date,
) => Promise<Result<ReadonlyArray<number>, StorageError>>;

/** StoredPickerSnapshotRow — one `picker_snapshot` row read back for cohort replay (BT-02). */
export type StoredPickerSnapshotRow = {
  readonly observedAt: Date;
  readonly snapshot: Record<string, unknown>;
};

/** ForReadingPickerSnapshotsInRange — every stored cohort in `[from, to]`, for the leakage oracle. */
export type ForReadingPickerSnapshotsInRange = (
  from: Date,
  to: Date,
) => Promise<Result<ReadonlyArray<StoredPickerSnapshotRow>, StorageError>>;

/**
 * FullHistorySnapshotRow — one `calendar_snapshots` row, source-inclusive (BT-03). Avoids
 * `readJournal`'s silent `schwab_chain` row drop (27-RESEARCH.md Pattern 4).
 */
export type FullHistorySnapshotRow = {
  readonly calendarId: string;
  readonly time: Date;
  readonly netMark: number;
  readonly frontIv: number;
  readonly backIv: number;
  readonly dteFront: number;
  readonly dteBack: number;
  readonly spot: number;
  readonly source: string;
};

/** ForReadingFullSnapshotHistoryForCalendar — every snapshot row for one calendar, ASC, any source/status. */
export type ForReadingFullSnapshotHistoryForCalendar = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<FullHistorySnapshotRow>, StorageError>>;
