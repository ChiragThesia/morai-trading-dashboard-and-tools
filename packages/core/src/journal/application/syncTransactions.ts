/**
 * syncTransactions.ts — A4 fills SOURCE use-case (JRNL-01).
 *
 * Populates the `fills` table from Schwab BrokerTransaction[] so sync-fills has real input
 * to pair. Fetches the window's transactions, flattens each tx's legs into RawFill rows, and
 * writes them via ForWritingFills (idempotent on the fill id PK).
 *
 * Determinism / idempotency (T-05-12-01):
 *   The fill id MUST be stable across re-runs so re-syncing the same window adds no duplicate
 *   rows (writeFills is onConflictDoNothing on id). The id is derived deterministically from
 *   (activityId + legIndex) by hashing that key with the injected sha256 hasher (HashFillIds,
 *   already wired in the composition root) and formatting the hex digest into a canonical
 *   UUID string (the fills.id column is uuid). Same window → same key → same id → no dup.
 *
 * Degradation (mirrors Phase-4 token-failure handling):
 *   AUTH_EXPIRED from fetchTransactions → ok(undefined): the worker degrades, it does not
 *   abort. A transient FetchError → err(StorageError) so pg-boss retries the job.
 *
 * Architecture (architecture-boundaries.md):
 *   - Pure core: no I/O, no framework, no node:crypto. The sha256 is injected (HashFillIds).
 *   - side comes directly from the broker transaction leg's OWN reported direction
 *     (BrokerTransaction.legs[].side, sourced from Schwab's signed transferItem amount) — NOT
 *     inferred from positionEffect (journal-pnl-opennetdebit-units #2: OPENING does not imply
 *     buy, nor CLOSING sell — a leg can be sold-to-open or bought-to-close). UNKNOWN
 *     positionEffect legs are still dropped here (no calendar-leg context to classify
 *     OPEN/CLOSE); sync-fills' orphan parking covers genuine misses.
 *   - positionEffect ALSO carries straight onto the RawFill (journal-pnl-opennetdebit-units
 *     round 4) — it used to be read here only as a drop-filter and then discarded; sync-fills
 *     re-derived classification later from the calendar's current status column instead,
 *     which folded historical CLOSE fills into OPEN events (or vice versa) whenever status
 *     hadn't kept pace with reality. The broker's own per-fill positionEffect is now the
 *     single source of truth for classification, all the way through.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
// Cross-context (brokerage) application port + payload type — the A4 source reads broker
// transactions. Imported through the brokerage application boundary (architecture §7).
import type {
  BrokerTransaction,
  ForFetchingTransactions,
} from "../../brokerage/application/ports.ts";
import type {
  ForStoringBrokerTransactions,
  ForWritingFills,
  HashFillIds,
  RawFill,
  StorageError,
  StoredBrokerTransaction,
} from "./ports.ts";

// ─── Deps ──────────────────────────────────────────────────────────────────────

export type SyncTransactionsDeps = {
  readonly fetchTransactions: ForFetchingTransactions;
  readonly writeFills: ForWritingFills;
  // Trade Ledger: verbatim broker_transactions store — written BEFORE fills so the raw
  // audit record never lags the derived rows. A store failure fails the run (retryable).
  readonly storeBrokerTransactions: ForStoringBrokerTransactions;
  // Injected sha256-hex hasher (C1) — used to derive deterministic UUID fill ids.
  readonly hashFillIds: HashFillIds;
  readonly accountHash: string;
  /**
   * The [from, to] date window (YYYY-MM-DD) to pull, evaluated on EVERY run — never
   * static strings captured at composition time. The worker once wired boot-time
   * constants here, so a long-running process re-synced the same frozen window forever
   * and fills after boot day were never ingested (stale-open calendars / unlinked
   * verdicts, fixed 2026-07-10). Re-pulling an overlapping window is idempotent
   * (deterministic fill ids + onConflictDoNothing).
   */
  readonly window: () => { readonly from: string; readonly to: string };
  readonly now: () => Date;
};

// Driver port type for the sync-transactions use-case.
export type ForRunningSyncTransactions = () => Promise<
  Result<void, StorageError>
>;

// ─── Deterministic id helper ────────────────────────────────────────────────────

// Format a 64-char sha256 hex digest into a canonical UUID string (8-4-4-4-12).
// WR-A3: every nibble of the 32-char prefix contributes — none is dropped. The fills.id
// column is a plain Postgres `uuid` (not validated as RFC-4122 v5), so no version/variant
// nibble is synthesized; the prior version-5 rewrite skipped input nibble 12 and let two
// distinct (activityId, legIndex) keys collide on the id PK (the second real fill was then
// silently dropped by onConflictDoNothing). The mapping is now contiguous and total:
// same digest → same UUID, so the same key always yields the same fill id (idempotent).
export function hexToUuid(hex: string): string {
  const h = hex.slice(0, 32);
  const timeLow = h.slice(0, 8);
  const timeMid = h.slice(8, 12);
  const timeHi = h.slice(12, 16);
  const clockSeq = h.slice(16, 20);
  const node = h.slice(20, 32);
  return `${timeLow}-${timeMid}-${timeHi}-${clockSeq}-${node}`;
}

// ─── Use-case factory ────────────────────────────────────────────────────────────

/**
 * makeSyncTransactionsUseCase — fetch the window's broker transactions and write their legs
 * to the fills table as deterministic, idempotent RawFill rows.
 */
export function makeSyncTransactionsUseCase(
  deps: SyncTransactionsDeps,
): ForRunningSyncTransactions {
  return async (): Promise<Result<void, StorageError>> => {
    const { from, to } = deps.window();
    const txResult = await deps.fetchTransactions(deps.accountHash, from, to);

    if (!txResult.ok) {
      // AUTH_EXPIRED → degrade (worker does not abort); transient FetchError → retryable err.
      if (txResult.error.kind === "auth-expired") {
        return ok(undefined);
      }
      return err<StorageError>({
        kind: "storage-error",
        message: `fetchTransactions failed: ${txResult.error.message}`,
      });
    }

    // Trade Ledger: persist the verbatim batch FIRST — raw must never lag derived fills.
    // Store failure → err (pg-boss retries); fills are not written this run.
    const storeResult = await deps.storeBrokerTransactions(
      txResult.value.map(toStoredBrokerTransaction),
    );
    if (!storeResult.ok) return err(storeResult.error);

    const fills: RawFill[] = [];
    for (const tx of txResult.value) {
      flattenTransaction(tx, deps.hashFillIds, fills);
    }

    if (fills.length === 0) return ok(undefined);

    const writeResult = await deps.writeFills(fills);
    if (!writeResult.ok) return err(writeResult.error);
    return ok(undefined);
  };
}

// Map a BrokerTransaction to its persisted shape. execTime is Schwab's verbatim string —
// parsed to Date here at the persistence boundary; an unparseable value maps to null,
// never an Invalid Date row.
function toStoredBrokerTransaction(tx: BrokerTransaction): StoredBrokerTransaction {
  const execTimeMs = tx.execTime !== undefined ? Date.parse(tx.execTime) : NaN;
  return {
    activityId: tx.activityId,
    orderId: tx.orderId,
    activityType: tx.activityType ?? null,
    execTime: Number.isNaN(execTimeMs) ? null : new Date(execTimeMs),
    tradeDate: tx.tradeDate,
    settlementDate: tx.settlementDate ?? null,
    netAmount: tx.netAmount,
    fees: tx.fees ?? null,
    legs: tx.legs,
    // ponytail: {} only for legacy fixtures without raw — the live adapter always supplies it
    raw: tx.raw ?? {},
  };
}

// Flatten one BrokerTransaction's legs into RawFill rows. UNKNOWN positionEffect legs are
// dropped (no authoritative side); only OPENING/CLOSING legs become fills.
function flattenTransaction(
  tx: BrokerTransaction,
  hashFillIds: HashFillIds,
  out: RawFill[],
): void {
  const orderId = String(tx.orderId ?? tx.activityId);
  const filledAt = new Date(tx.tradeDate + "T00:00:00Z");

  tx.legs.forEach((leg, legIndex) => {
    if (leg.positionEffect === "UNKNOWN") return;
    // journal-pnl-opennetdebit-units #2: side is the leg's OWN reported direction, not
    // inferred from positionEffect (see module docstring).
    const side = leg.side;
    // Deterministic id from (activityId, legIndex) → stable across re-runs.
    // hashFillIds SORTS its input (set-hash for unordered fill-id sets), so the key MUST be a
    // single pre-combined element — passing [activityId, legIndex] as two elements would let
    // (4,5) and (5,4) sort to the same input and collide on the fills.id PK (WR-A3b).
    const idHex = hashFillIds([`${tx.activityId}:${legIndex}`]);
    out.push({
      id: hexToUuid(idHex),
      orderId,
      occSymbol: leg.occSymbol,
      side,
      qty: leg.qty,
      price: leg.price,
      filledAt,
      commission: null,
      fees: null,
      // journal-pnl-opennetdebit-units (round 4): the leg's OWN broker-reported role, carried
      // through instead of discarded (see module docstring).
      positionEffect: leg.positionEffect,
    });
  });
}
