/**
 * backtest.ts — PICK-04 backtest harness operator CLI (BT-01..BT-05).
 *
 * Runs `makeRunBacktestUseCase` (packages/core/src/backtest/application/runBacktest.ts) over
 * an operator-supplied [--from, --to] range, connecting to Postgres via DATABASE_URL only —
 * deliberately NOT bootWorkerConfig() (apps/worker/src/config.ts), which requires
 * TOKEN_ENCRYPTION_KEY/SCHWAB_TRADER_APP_KEY/SCHWAB_TRADER_APP_SECRET/SIDECAR_URL. The
 * backtest performs ZERO brokerage I/O — it only reads Postgres and appends one
 * `backtest_runs` row — so forcing four irrelevant secrets onto a local analysis tool would
 * be unnecessary friction (27-RESEARCH.md "CLI env bootstrap" finding).
 *
 * Usage: bun run apps/worker/src/backtest.ts --from 2026-06-12 --to 2026-07-09
 *          [--calendar <uuid>] [--report-only]
 *
 * --from/--to: YYYY-MM-DD, round-trip-validated (mirrors backfill-transactions.ts's date
 *   guard). --from earlier than BACKTEST_MIN_FROM is rejected loud (self-inflicted-DoS guard,
 *   T-27-15) — that date is the documented start of the replayable leg_observations corpus
 *   (27-CONTEXT.md Phase Boundary).
 * --calendar: optional UUID-shaped id, narrows the BT-03 13-trade replay to one calendar.
 * --report-only: composes a no-op persist sink instead of the real backtest_runs repo — the
 *   report still prints, but nothing is written (BT-05's only write path stays opt-in even
 *   for a dry run).
 *
 * No pg-boss, no sidecar, no Schwab adapters — this is a bulk, no-cadence analysis tool
 * (locked decision: NOT a job, the 900s handler cap fights bulk scans).
 *
 * Two parts, mirroring backfill-transactions.ts: parseBacktestArgs (pure, unit-tested below)
 * and the CLI entrypoint (bottom, composition-root glue — TDD-exempt wiring, tdd.md Scope).
 *
 * No any/as/! (typescript.md). No secret/token in output (workflow.md Data Discipline).
 */

import { z } from "zod";
import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makeRunBacktestUseCase } from "@morai/core";
import type { BacktestReport, StorageError } from "@morai/core";

// Documented start of the replayable leg_observations corpus (27-CONTEXT.md Phase Boundary).
export const BACKTEST_MIN_FROM = "2026-06-12";

// ─── Argv parsing (pure, unit-tested) ──────────────────────────────────────────────

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => {
    const ms = new Date(`${s}T00:00:00Z`).getTime();
    // Round-trip guard: a real date re-serialises to the same YYYY-MM-DD; a rolled-over
    // value (e.g. 2026-13-40) does not (backfill-transactions.ts precedent).
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
  }, "not a real calendar date");

const uuidShaped = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "expected a UUID-shaped id");

const argSchema = z
  .object({
    from: ymd,
    to: ymd,
    calendar: uuidShaped.optional(),
    reportOnly: z.boolean(),
  })
  .refine((v) => v.from >= BACKTEST_MIN_FROM, {
    message: `--from must be on or after ${BACKTEST_MIN_FROM} (the start of the replayable leg_observations corpus)`,
    path: ["from"],
  });

export type BacktestArgs = z.infer<typeof argSchema>;

/** Scan a flag-style argv (`--name value` / `--name`) — no positional args, no CLI-arg
 * dependency (zero new deps, 27-CONTEXT.md lock). */
function getFlag(argv: ReadonlyArray<string>, name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : argv[idx + 1];
}
function hasFlag(argv: ReadonlyArray<string>, name: string): boolean {
  return argv.includes(`--${name}`);
}

/** Parse, don't cast (typescript.md) — every CLI arg crosses a Zod boundary before use. */
export function parseBacktestArgs(argv: ReadonlyArray<string>) {
  return argSchema.safeParse({
    from: getFlag(argv, "from") ?? "",
    to: getFlag(argv, "to") ?? "",
    calendar: getFlag(argv, "calendar"),
    reportOnly: hasFlag(argv, "report-only"),
  });
}

// ─── Console summary (n=, date range, coverage %, oracle reproduced/mismatched,
// attribution signs, ablation deltas — Task 2's own required content) ──────────────

function summarizeBacktestReport(report: BacktestReport): void {
  console.warn(`backtest: n=${report.n} cohort(s), ${report.fromDate}..${report.toDate}`);

  const overall = report.coverage.find((c) => c.date === "overall");
  if (overall !== undefined) {
    console.warn(
      `backtest: coverage ${overall.coveragePct.toFixed(1)}% (${overall.observedCohorts}/${overall.expectedCohorts} cohort(s), gap rows excluded)`,
    );
  }

  const registryDriftCount = report.mismatches.filter((m) => m.kind === "registry-drift").length;
  const otherMismatchCount = report.mismatches.length - registryDriftCount;
  const cohortsWithMismatch = new Set(report.mismatches.map((m) => m.observedAt)).size;
  console.warn(
    `backtest: leakage oracle -- ${report.n - cohortsWithMismatch}/${report.n} cohort(s) reproduced exactly, ` +
      `${otherMismatchCount} mismatch(es), ${registryDriftCount} registry-drift flag(s)`,
  );

  const tradeMatches = report.tradeReproductions.filter((t) => t.directionMatch).length;
  console.warn(`backtest: 13-trade oracle -- ${tradeMatches}/${report.tradeReproductions.length} direction match(es)`);

  for (const row of report.attribution) {
    console.warn(`backtest: attribution ${row.ruleId} = ${row.sign} (n=${row.n})`);
  }
  for (const row of report.ablation) {
    console.warn(
      `backtest: ablation ${row.ruleId} rankDelta=${row.rankDelta.toFixed(2)} outcomeDelta=${row.outcomeDelta.toFixed(2)} (n=${row.n})`,
    );
  }
  for (const row of report.ci) {
    console.warn(`backtest: CI ${row.metric} = [${row.low.toFixed(2)}, ${row.high.toFixed(2)}] (n=${row.n})`);
  }
  for (const caveat of report.caveats) {
    console.warn(`backtest: CAVEAT -- ${caveat}`);
  }
}

// ─── CLI entrypoint (thin composition root — TDD-exempt wiring) ──────────────────────
// Guarded by import.meta.main so importing this module in tests does not boot the CLI.
if (import.meta.main) {
  const parsedArgs = parseBacktestArgs(process.argv.slice(2));
  if (!parsedArgs.success) {
    const issue = parsedArgs.error.issues[0];
    console.error(
      `backtest: ${issue?.path.join(".") ?? "args"} ${issue?.message ?? "invalid"}. ` +
        "Usage: bun run apps/worker/src/backtest.ts --from <YYYY-MM-DD> --to <YYYY-MM-DD> " +
        "[--calendar <uuid>] [--report-only]",
    );
    process.exit(1);
  }
  const args = parsedArgs.data;

  // DATABASE_URL-only env — NOT bootWorkerConfig() (see file header). BSM_RATE_FALLBACK/
  // BSM_DIVIDEND_YIELD default to the SAME values apps/worker/src/config.ts uses live, so an
  // operator who sets nothing beyond DATABASE_URL still gets the live picker's own r/q.
  const backtestConfigSchema = z.object({
    DATABASE_URL: z.string().url(),
    BSM_RATE_FALLBACK: z.coerce.number().nonnegative().default(0.045),
    BSM_DIVIDEND_YIELD: z.coerce.number().nonnegative().default(0.013),
  });
  const configResult = backtestConfigSchema.safeParse(process.env);
  if (!configResult.success) {
    console.error(`backtest: invalid environment -- ${configResult.error.issues[0]?.message ?? "DATABASE_URL required"}`);
    process.exit(1);
  }
  const config = configResult.data;

  const {
    makeDb,
    makePostgresBacktestChainRepo,
    makePostgresBacktestHistoryRepo,
    makePostgresBacktestRunsRepo,
    makePostgresCalendarSnapshotsRepo,
    makePostgresCalendarEventsRepo,
    makePostgresCalendarsRepo,
    makePostgresEconomicEventsRepo,
  } = await import("@morai/adapters");

  const db = makeDb(config.DATABASE_URL);
  const chainRepo = makePostgresBacktestChainRepo(db);
  const historyRepo = makePostgresBacktestHistoryRepo(db);
  const runsRepo = makePostgresBacktestRunsRepo(db);
  const calendarSnapshotsRepo = makePostgresCalendarSnapshotsRepo(db);
  const calendarEventsRepo = makePostgresCalendarEventsRepo(db);
  const calendarsRepo = makePostgresCalendarsRepo(db);
  const economicEventsRepo = makePostgresEconomicEventsRepo(db);

  // --report-only: compose a no-op sink instead of the real repo. Still "persists" in the
  // sense runBacktest's own contract requires (exactly one call), just to nowhere.
  const persistBacktestRun = args.reportOnly
    ? async (): Promise<Result<void, StorageError>> => ok(undefined)
    : runsRepo.insertBacktestRun;

  const runBacktest = makeRunBacktestUseCase({
    readPickerSnapshotsInRange: historyRepo.readPickerSnapshotsInRange,
    readChainAsOf: chainRepo.readChainAsOf,
    readDailySpotClosesAsOf: historyRepo.readDailySpotClosesAsOf,
    readFullSnapshotHistoryForCalendar: calendarSnapshotsRepo.readFullSnapshotHistoryForCalendar,
    readCalendarEvents: calendarEventsRepo.readCalendarEvents,
    readEconomicEvents: economicEventsRepo.readEconomicEvents,
    listCalendars: calendarsRepo.listCalendars,
    persistBacktestRun,
    rate: config.BSM_RATE_FALLBACK,
    dividendYield: config.BSM_DIVIDEND_YIELD,
    now: () => new Date(),
  });

  console.warn(`backtest: replaying ${args.from}..${args.to}${args.reportOnly ? " (--report-only, no write)" : ""}...`);
  const result = await runBacktest({
    from: new Date(`${args.from}T00:00:00.000Z`),
    // Inclusive of the WHOLE --to day, matching an operator's "through this date" intent.
    to: new Date(`${args.to}T23:59:59.999Z`),
    ...(args.calendar !== undefined ? { calendarId: args.calendar } : {}),
  });

  if (!result.ok) {
    console.error(`backtest: FAILED -- ${result.error.message}`);
    process.exit(1);
  }

  summarizeBacktestReport(result.value);
  console.warn("backtest: done.");
  process.exit(0);
}
