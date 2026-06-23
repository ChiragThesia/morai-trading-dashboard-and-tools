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
import { z } from "zod";
import { err } from "@morai/shared";
import type { Result } from "@morai/shared";
import {
  chunkDateRange,
  hashFillIds,
  inclusiveDays,
  makeSyncTransactionsUseCase,
  SCHWAB_TX_LOOKBACK_MAX_DAYS,
  SCHWAB_TX_MAX_RANGE_DAYS,
} from "@morai/core";
import type {
  ForFetchingTransactions,
  ForWritingFills,
  StorageError,
} from "@morai/core";

// Schwab transaction caps (SCHWAB_TX_LOOKBACK_MAX_DAYS = total span guard;
// SCHWAB_TX_MAX_RANGE_DAYS = per-call window passed to chunkDateRange) are domain constants
// in @morai/core alongside chunkDateRange. Re-exported here so existing importers (tests, docs
// references) keep their import path. Documented in docs/architecture/jobs.md.
export { SCHWAB_TX_LOOKBACK_MAX_DAYS, SCHWAB_TX_MAX_RANGE_DAYS };

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
  readonly maxDays: number; // per-call window cap (≤ SCHWAB_TX_LOOKBACK_MAX_DAYS)
};

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

  // WR-01: parse, don't cast. process.argv is external input — validate the YYYY-MM-DD
  // shape AND that each is a real calendar date (rejecting JS Date rollovers like
  // 2026-13-40) at the composition root before anything touches the range.
  const [, , rawFrom, rawTo] = process.argv;
  const ymd = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .refine((s) => {
      const ms = new Date(`${s}T00:00:00Z`).getTime();
      // Round-trip guard: a real date re-serialises to the same YYYY-MM-DD; a rolled-over
      // value (e.g. 2026-13-40 → 2027-02-09) does not.
      return (
        !Number.isNaN(ms) &&
        new Date(ms).toISOString().slice(0, 10) === s
      );
    }, "not a real calendar date");
  const argSchema = z.object({ from: ymd, to: ymd });
  const parsed = argSchema.safeParse({ from: rawFrom ?? "", to: rawTo ?? "" });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path[0] === "to" ? "to" : "from";
    console.error(
      `backfill-transactions: <${where}> ${issue?.message ?? "invalid"}. ` +
        "Usage: bun run backfill-transactions <from> <to> (YYYY-MM-DD). " +
        "Example: bun run backfill-transactions 2026-01-01 2026-03-31",
    );
    process.exit(1);
  }
  const { from, to } = parsed.data;

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
    // IN-02: accountHash is NOT authoritative on the CLI path. fetchTransactionsResolved
    // ignores this value and re-resolves the real hash per call (Pitfall 5). It is threaded
    // only because RunBackfillDeps/makeSyncTransactionsUseCase require the field; the sentinel
    // string makes that intent explicit to a reader.
    accountHash: "resolved-per-call-see-fetchTransactionsResolved",
    now: () => new Date(),
    from,
    to,
    // WR-04: per-call window cap drives chunking; the TOTAL span is still guarded against
    // SCHWAB_TX_LOOKBACK_MAX_DAYS inside runBackfill. Since SCHWAB_TX_MAX_RANGE_DAYS <
    // SCHWAB_TX_LOOKBACK_MAX_DAYS, the chunk loop actually splits in production.
    maxDays: SCHWAB_TX_MAX_RANGE_DAYS,
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
