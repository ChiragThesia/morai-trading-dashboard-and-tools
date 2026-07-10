/**
 * previewExitRuleOverrides.ts — the exits branch of the staged-change dry-run preview
 * (Phase 32, Plan 03, B2).
 *
 * A read-only fork of computeExitAdvice.ts (26-04): the SAME read order minus persist and
 * minus chain-for-roll (a TAKE/STOP rung change never affects a ROLL suggestion, and
 * omitting the chain read keeps the preview bounded + read-only, RESEARCH Pitfall 5). Every
 * open position with a snapshot this cohort gets evaluated TWICE via the SAME pure
 * `evaluateExit` computeExitAdvice.ts uses — once under the current effective exit config,
 * once under the staged override — and the diff is returned. Never persists: `ExitPreviewDeps`
 * structurally excludes `persistExitVerdict` (T-32-02) — a copy-pasted persist call from
 * computeExitAdvice.ts would fail to typecheck, not merely a runtime guard.
 *
 * `isExitRuleOverrides` + its field-guard helpers below are a verbatim COPY of
 * computeExitAdvice.ts's own narrowing (not an import — that file isn't in this plan's
 * files_modified list, and exits/ has no shared "narrow-overrides" module of its own).
 * Intentionally NOT consolidated with `apps/server/src/adapters/rule-overrides-bridge.ts`
 * (WR-01, 32-REVIEW.md): the hexagon law (architecture-boundaries §2) forbids `packages/core`
 * from importing `apps/server` adapter code at all, in either direction — this narrowing is
 * also structurally different (it type-guards actual field names against an untyped *stored*
 * JSON blob, not a plain-record shape-guard on an already-Zod-validated request body), so it
 * would be a weak consolidation candidate even if the import direction were legal.
 *
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared, this context's own
 * domain/application siblings, and the settings context's own application port (rule 7 —
 * cross-context reads go through application ports, never a foreign domain/ import).
 */

import { ok, isWithinRth, isNyseHoliday } from "@morai/shared";
import type { Result } from "@morai/shared";
import { evaluateExit } from "../domain/evaluate-exit.ts";
import { resolveExitRuleConfig } from "../domain/rule-config.ts";
import type { ExitRuleOverrides } from "../domain/rule-config.ts";
import type { MarketContext, PreviousVerdict } from "../domain/types.ts";
import type {
  ExitPreviewDeps,
  ExitPreviewEntry,
  ExitPreviewResult,
  ExitVerdictRow,
  ForPreviewingExitRuleOverrides,
  StorageError,
} from "./ports.ts";

// ─── Rule-overrides narrowing (verbatim copy of computeExitAdvice.ts, 29-11 RUNTIME-*) ─────

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

const TAKE_OVERRIDE_FIELDS = ["plus15Arm", "plus15Disarm", "plus10Arm", "plus10Disarm", "plus5Arm", "plus5Disarm"] as const;
const STOP_OVERRIDE_FIELDS = ["minus50Arm", "minus50Disarm", "minus25Arm", "minus25Disarm"] as const;

function isTakeOverrides(value: unknown): boolean {
  return value === undefined || (isPlainRecord(value) && TAKE_OVERRIDE_FIELDS.every((field) => isOptionalNumber(value[field])));
}

function isStopOverrides(value: unknown): boolean {
  return value === undefined || (isPlainRecord(value) && STOP_OVERRIDE_FIELDS.every((field) => isOptionalNumber(value[field])));
}

function isExitRuleOverrides(value: unknown): value is ExitRuleOverrides {
  if (!isPlainRecord(value)) return false;
  return isTakeOverrides(value["take"]) && isStopOverrides(value["stop"]);
}

export function makePreviewExitRuleOverridesUseCase(deps: ExitPreviewDeps): ForPreviewingExitRuleOverrides {
  return async (staged?: ExitRuleOverrides): Promise<Result<ExitPreviewResult, StorageError>> => {
    // ── Runtime exit-rung config: current (stored, narrowed) vs staged (falls back to stored
    // when absent -- an ABSENT staged group is what makes staged === current, byte-parity). ──
    const overridesResult = await deps.readRuleOverrides();
    const exitOverridesRaw = overridesResult.ok ? overridesResult.value["exits"] : undefined;
    const storedExits = isExitRuleOverrides(exitOverridesRaw) ? exitOverridesRaw : undefined;
    const currentExitConfig = resolveExitRuleConfig(storedExits);
    const stagedExitConfig = resolveExitRuleConfig(staged ?? storedExits);

    const positionsResult = await deps.readHeldPositions();
    if (!positionsResult.ok) return positionsResult;

    const snapshotsResult = await deps.readLatestSnapshotPerOpenCalendar();
    if (!snapshotsResult.ok) return snapshotsResult;

    const verdictsResult = await deps.readLatestVerdictsPerCalendar();
    if (!verdictsResult.ok) return verdictsResult;

    const eventsResult = await deps.readEconomicEvents();
    if (!eventsResult.ok) return eventsResult;

    const snapshotByCalendar = new Map(snapshotsResult.value.map((s) => [s.calendarId, s]));
    const previousRowByCalendar = new Map<string, ExitVerdictRow>(
      verdictsResult.value.map((v) => [v.calendarId, v]),
    );
    const cohortNow = deps.now();

    const entries: ExitPreviewEntry[] = [];

    for (const position of positionsResult.value) {
      const snapshot = snapshotByCalendar.get(position.calendarId);
      // No snapshot yet for this calendar this cohort -- nothing to preview against (same
      // safe-skip as computeExitAdvice.ts, not an error).
      if (snapshot === undefined) continue;

      const marketSession: "rth" | "after-hours" =
        isWithinRth(snapshot.time) && !isNyseHoliday(snapshot.time) ? "rth" : "after-hours";

      const context: MarketContext = {
        netMark: snapshot.netMark,
        pnlOpen: snapshot.pnlOpen,
        spot: snapshot.spot,
        frontIv: snapshot.frontIv,
        backIv: snapshot.backIv,
        dteFront: snapshot.dteFront,
        dteBack: snapshot.dteBack,
        snapshotTime: snapshot.time,
        cohortNow,
        marketSession,
        tier1Events: eventsResult.value,
        // A TAKE/STOP rung change never drives a ROLL suggestion -- omitting the chain read
        // keeps this preview bounded + read-only (RESEARCH Pitfall 5, T-32-02).
        rollChain: { candidates: [] },
      };

      const previousRow = previousRowByCalendar.get(position.calendarId) ?? null;
      const previousVerdict: PreviousVerdict =
        previousRow === null
          ? null
          : {
              verdict: previousRow.verdict.verdict,
              rung: previousRow.verdict.rung,
              ruleId: previousRow.verdict.ruleId,
            };

      const current = evaluateExit(position, context, previousVerdict, currentExitConfig);
      const stagedVerdict = evaluateExit(position, context, previousVerdict, stagedExitConfig);

      entries.push({
        calendarId: position.calendarId,
        current: { verdict: current.verdict, rung: current.rung, ruleId: current.ruleId },
        staged: {
          verdict: stagedVerdict.verdict,
          rung: stagedVerdict.rung,
          ruleId: stagedVerdict.ruleId,
          metric: stagedVerdict.metric,
        },
      });
    }

    return ok(entries);
  };
}
