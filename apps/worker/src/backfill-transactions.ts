/**
 * backfill-transactions.ts — historical trade-history backfill CLI + orchestrator (BRK-04).
 *
 * Runs the existing sync-transactions use-case over an operator-supplied [from, to] range,
 * chunked into windows within Schwab's transactions lookback cap, writing fills idempotently.
 * Backfilled trades flow into `fills` and from there into calendar events via the existing
 * sync-fills / rebuild-journal path. See docs/architecture/jobs.md (Historical backfill).
 *
 * Two parts:
 *   - runBackfill(deps): PURE orchestrator — chunk math lives in core (chunkDateRange); this
 *     loops the chunks and runs the use-case per window. Zero business logic. Tested offline
 *     (faked fetch + in-memory fills twin) in backfill-transactions.test.ts.
 *   - the CLI entrypoint (bottom): thin composition root mirroring apps/auth/src/main.ts +
 *     the sync-transactions wiring in apps/worker/src/main.ts. TDD-exempt wiring (tdd.md Scope).
 *
 * Idempotency: deterministic fill ids (activityId+legIndex) + writeFills onConflictDoNothing →
 * a second run over the same range adds 0 rows.
 * Over-cap: a total span > SCHWAB_TX_LOOKBACK_MAX_DAYS returns a clear error and writes NOTHING
 * (no silent truncation — SPEC constraint).
 *
 * No any/as/! (typescript.md). No secret/token in output (workflow.md Data Discipline).
 */

import { createHash } from "node:crypto";
import { err } from "@morai/shared";
import type { Result } from "@morai/shared";
import {
  chunkDateRange,
  hashFillIds,
  makeSyncTransactionsUseCase,
} from "@morai/core";
import type {
  ForFetchingTransactions,
  ForWritingFills,
  StorageError,
} from "@morai/core";

// ─── Documented Schwab lookback cap ──────────────────────────────────────────────
// Schwab caps transactions lookback at ~1 year. Documented in docs/architecture/jobs.md.
// A requested total range exceeding this is rejected (no silent truncation).
export const SCHWAB_TX_LOOKBACK_MAX_DAYS = 365;

const DAY_MS = 86_400_000;

// ─── Errors ──────────────────────────────────────────────────────────────────────

/**
 * BackfillError — typed error for a rejected or failed backfill. Returned via err(), never
 * thrown. `kind: "backfill-error"` distinguishes over-cap / invalid-range / storage failure.
 */
export type BackfillError = {
  readonly kind: "backfill-error";
  readonly message: string;
};

/** Summary of a successful backfill — counts/range only (no secret, no token). */
export type BackfillSummary = {
  readonly windows: number;
  readonly from: string;
  readonly to: string;
};

// ─── Orchestrator deps ─────────────────────────────────────────────────────────────

export type RunBackfillDeps = {
  readonly fetchTransactions: ForFetchingTransactions;
  readonly writeFills: ForWritingFills;
  readonly hashFillIds: (ids: ReadonlyArray<string>) => string;
  readonly accountHash: string;
  readonly now: () => Date;
  readonly from: string; // YYYY-MM-DD inclusive
  readonly to: string; // YYYY-MM-DD inclusive
  readonly maxDays: number; // window cap (≤ SCHWAB_TX_LOOKBACK_MAX_DAYS)
};

// Inclusive day count between two YYYY-MM-DD dates (>= 1 for a valid range).
function inclusiveDays(from: string, to: string): number {
  const fromMs = new Date(from + "T00:00:00Z").getTime();
  const toMs = new Date(to + "T00:00:00Z").getTime();
  return Math.floor((toMs - fromMs) / DAY_MS) + 1;
}

/**
 * runBackfill — chunk [from, to] and run sync-transactions per window.
 *
 * Order of checks (write nothing on rejection):
 *   1. chunkDateRange validates from ≤ to and maxDays > 0 (typed err on either).
 *   2. The TOTAL requested span must be ≤ SCHWAB_TX_LOOKBACK_MAX_DAYS, else reject up front
 *      (over-cap → clear error, no partial write — SPEC constraint, T-07-04/T-07-07).
 *   3. For each chunk, run the use-case; abort on the first storage failure.
 */
export async function runBackfill(
  deps: RunBackfillDeps,
): Promise<Result<BackfillSummary, BackfillError>> {
  const chunks = chunkDateRange(deps.from, deps.to, deps.maxDays);
  if (!chunks.ok) {
    return err<BackfillError>({
      kind: "backfill-error",
      message: `invalid range: ${chunks.error.message}`,
    });
  }

  // Over-cap guard: reject a total span beyond the documented Schwab cap BEFORE any write.
  const totalDays = inclusiveDays(deps.from, deps.to);
  if (totalDays > SCHWAB_TX_LOOKBACK_MAX_DAYS) {
    return err<BackfillError>({
      kind: "backfill-error",
      message: `requested range spans ${totalDays} days, exceeding the Schwab lookback cap of ${SCHWAB_TX_LOOKBACK_MAX_DAYS} days; narrow the range and re-run`,
    });
  }

  for (const window of chunks.value) {
    const runChunk = makeSyncTransactionsUseCase({
      fetchTransactions: deps.fetchTransactions,
      writeFills: deps.writeFills,
      hashFillIds: deps.hashFillIds,
      accountHash: deps.accountHash,
      from: window.from,
      to: window.to,
      now: deps.now,
    });
    const result = await runChunk();
    if (!result.ok) {
      return err<BackfillError>({
        kind: "backfill-error",
        message: `chunk ${window.from}..${window.to} failed: ${result.error.message}`,
      });
    }
  }

  return {
    ok: true,
    value: { windows: chunks.value.length, from: deps.from, to: deps.to },
  };
}

// ─── CLI entrypoint (thin composition root — TDD-exempt wiring) ──────────────────────
// Guarded by import.meta.main so importing this module in tests does not boot the CLI.
if (import.meta.main) {
  const { bootWorkerConfig } = await import("./config.ts");
  const {
    makeDb,
    makePostgresFillsRepo,
    makeAccountHashResolver,
    makeSchwabTransactionsAdapter,
  } = await import("@morai/adapters");

  const [, , rawFrom, rawTo] = process.argv;
  const from = rawFrom ?? "";
  const to = rawTo ?? "";
  if (from === "" || to === "") {
    console.error(
      "backfill-transactions requires <from> <to> (YYYY-MM-DD). Example: bun run backfill-transactions 2026-01-01 2026-03-31",
    );
    process.exit(1);
  }

  const config = bootWorkerConfig();
  const db = makeDb(config.DATABASE_URL);
  const fillsRepo = makePostgresFillsRepo(db);

  const USER_AGENT = "morai-worker/0.0.1";

  // Trader on-demand token + account-hash resolver, mirroring apps/worker/src/main.ts.
  const { makePostgresBrokerTokensRepo } = await import("@morai/adapters");
  const brokerTokensRepo = makePostgresBrokerTokensRepo(
    db,
    config.TOKEN_ENCRYPTION_KEY,
  );
  const traderGetAccessToken = async () => {
    const result = await brokerTokensRepo.readTokens("trader");
    if (!result.ok || result.value === null) {
      return {
        ok: false as const,
        error: { kind: "auth-expired" as const, appId: "trader" as const },
      };
    }
    return { ok: true as const, value: result.value.accessToken };
  };
  const traderDeps = {
    fetch: globalThis.fetch,
    getAccessToken: traderGetAccessToken,
    userAgent: USER_AGENT,
  };
  const accountHashResolver = makeAccountHashResolver(traderDeps);
  const transactionsAdapter = makeSchwabTransactionsAdapter(traderDeps);

  // Resolve the real account hash per call (the resolver is authoritative — Pitfall 5).
  const fetchTransactionsResolved = async (
    _accountHash: string,
    windowFrom: string,
    windowTo: string,
  ) => {
    const hashResult = await accountHashResolver.resolveAccountHash();
    if (!hashResult.ok) return hashResult;
    return transactionsAdapter.fetchTransactions(
      hashResult.value,
      windowFrom,
      windowTo,
    );
  };

  const sha256Hex = (input: string): string =>
    createHash("sha256").update(input).digest("hex");

  const result = await runBackfill({
    fetchTransactions: fetchTransactionsResolved,
    writeFills: fillsRepo.writeFills,
    hashFillIds: (ids) => hashFillIds(ids, sha256Hex),
    accountHash: "resolved-at-call-time",
    now: () => new Date(),
    from,
    to,
    maxDays: SCHWAB_TX_LOOKBACK_MAX_DAYS,
  });

  if (!result.ok) {
    console.error(`backfill failed: ${result.error.message}`);
    process.exit(1);
  }

  // Summary: counts/range only — never a token or secret (workflow.md Data Discipline).
  console.warn(
    `backfill complete: ${result.value.windows} window(s) over ${result.value.from}..${result.value.to}`,
  );
  process.exit(0);
}
