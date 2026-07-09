import { z } from "zod";

/**
 * backtestReportSchema — the write-boundary validator for a `backtest_runs.report` JSONB
 * blob (Phase 27, Plan 01, BT-05). Shared by BOTH the Postgres adapter and the memory twin
 * (mirrors smile-moneyness.ts's "shared by both adapters" convention) so a malformed report
 * is rejected identically on either backend, before insert — never silently stored.
 *
 * Structurally mirrors packages/core/src/backtest/domain/types.ts's BacktestReport. Row
 * arrays use a loose record shape (not a full per-field schema) — their exact fields are
 * still evolving across plans 03-06; this schema's job is to catch a malformed/truncated
 * blob, not to re-validate every kernel-computed number.
 */
export const backtestReportSchema = z.object({
  generatedAt: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  n: z.number(),
  mismatches: z.array(z.looseObject({})),
  tradeReproductions: z.array(z.looseObject({})),
  attribution: z.array(z.looseObject({})),
  ablation: z.array(z.looseObject({})),
  coverage: z.array(z.looseObject({})),
  caveats: z.array(z.string()),
});
