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
 *   - side derives from positionEffect: OPENING → buy, CLOSING → sell. UNKNOWN legs are
 *     dropped here (no authoritative side); sync-fills' orphan parking covers genuine misses.
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
  ForWritingFills,
  HashFillIds,
  RawFill,
  StorageError,
} from "./ports.ts";

// ─── Deps ──────────────────────────────────────────────────────────────────────

export type SyncTransactionsDeps = {
  readonly fetchTransactions: ForFetchingTransactions;
  readonly writeFills: ForWritingFills;
  // Injected sha256-hex hasher (C1) — used to derive deterministic UUID fill ids.
  readonly hashFillIds: HashFillIds;
  readonly accountHash: string;
  readonly from: string; // YYYY-MM-DD
  readonly to: string; // YYYY-MM-DD
  readonly now: () => Date;
};

// Driver port type for the sync-transactions use-case.
export type ForRunningSyncTransactions = () => Promise<
  Result<void, StorageError>
>;

// ─── Deterministic id helper ────────────────────────────────────────────────────

// Format a 64-char sha256 hex digest into a canonical UUID string (8-4-4-4-12) with the
// version nibble set to 5 (name-based) and the variant nibble set to RFC-4122. Same digest
// → same UUID, so the same (activityId, legIndex) key always yields the same fill id.
function hexToUuid(hex: string): string {
  const h = hex.slice(0, 32);
  const timeLow = h.slice(0, 8);
  const timeMid = h.slice(8, 12);
  const timeHiVersion = "5" + h.slice(13, 16); // version 5
  // variant: high bits 10xx → take a hex digit in [8,9,a,b]
  const variantNibbles = "89ab";
  const vIndex = parseInt(h.slice(16, 17), 16) % 4;
  const variantDigit = variantNibbles[vIndex] ?? "8";
  const clockSeq = variantDigit + h.slice(17, 20);
  const node = h.slice(20, 32);
  return `${timeLow}-${timeMid}-${timeHiVersion}-${clockSeq}-${node}`;
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
    const txResult = await deps.fetchTransactions(
      deps.accountHash,
      deps.from,
      deps.to,
    );

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
    const side: "buy" | "sell" = leg.positionEffect === "OPENING" ? "buy" : "sell";
    // Deterministic id from (activityId, legIndex) → stable across re-runs.
    const idHex = hashFillIds([`${tx.activityId}`, `${legIndex}`]);
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
    });
  });
}
