/**
 * getExitAdvice.ts tests (Phase 26, Plan 04) — the read-side use-case joining latest verdicts
 * against held positions + latest snapshots, per tdd.md.
 *
 * Covers:
 *   - Cold start: zero verdict rows -> ok(null).
 *   - Shape: pnlPct/basis/name are re-derived from the calendar + snapshot (never fabricated),
 *     ruleSet echoes the registry, marketSession is evaluated at read time.
 *   - A verdict whose calendar or snapshot has since gone missing is omitted, not fabricated.
 *   - observedAt/asOf reflect the MAX observedAt across included verdicts.
 *   - EXIT-09 gap closure (26-VERIFICATION.md): `changed` passes through the persisted row's
 *     write-time flag instead of a hardcoded `false`; a legacy row with no `changed` key still
 *     defaults to `false`.
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makeGetExitAdviceUseCase } from "./getExitAdvice.ts";
import type { HeldPosition } from "../domain/types.ts";
import type {
  ExitVerdictRow,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingLatestVerdictsPerCalendar,
  LatestSnapshotForCalendar,
  StorageError,
} from "./ports.ts";

function makePosition(overrides: Partial<HeldPosition> = {}): HeldPosition {
  return {
    calendarId: "cal-1",
    name: "7000P calendar",
    strike: 7000,
    qty: 1,
    openNetDebit: 4000,
    frontExpiry: "2026-09-18",
    backExpiry: "2026-10-16",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<LatestSnapshotForCalendar> = {}): LatestSnapshotForCalendar {
  return {
    calendarId: "cal-1",
    time: new Date("2026-07-09T15:00:00.000Z"),
    netMark: 4400,
    pnlOpen: 400,
    spot: 7000,
    frontIv: 0.2,
    backIv: 0.25,
    dteFront: 30,
    dteBack: 58,
    ...overrides,
  };
}

function makeVerdictRow(overrides: Partial<ExitVerdictRow> = {}): ExitVerdictRow {
  return {
    observedAt: new Date("2026-07-09T15:00:00.000Z"),
    calendarId: "cal-1",
    verdict: {
      verdict: "TAKE",
      rung: "+10%",
      ruleId: "take",
      metric: { name: "pnlPct", value: 0.1, threshold: 0.1 },
      indicative: false,
      escalate: false,
      roll: null,
    },
    ...overrides,
  };
}

function fakeReadHeldPositions(positions: ReadonlyArray<HeldPosition>): ForReadingHeldPositions {
  return async (): Promise<Result<ReadonlyArray<HeldPosition>, StorageError>> => ok(positions);
}

function fakeReadSnapshots(
  snapshots: ReadonlyArray<LatestSnapshotForCalendar>,
): ForReadingLatestSnapshotPerOpenCalendar {
  return async (): Promise<Result<ReadonlyArray<LatestSnapshotForCalendar>, StorageError>> => ok(snapshots);
}

function fakeReadVerdicts(rows: ReadonlyArray<ExitVerdictRow>): ForReadingLatestVerdictsPerCalendar {
  return async (): Promise<Result<ReadonlyArray<ExitVerdictRow>, StorageError>> => ok(rows);
}

describe("getExitAdvice — cold start", () => {
  it("returns ok(null) when nothing has been computed yet", async () => {
    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition()]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot()]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      now: () => new Date("2026-07-09T16:00:00.000Z"),
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBeNull();
  });
});

describe("getExitAdvice — shape", () => {
  it("re-derives pnlPct/basis/name from the calendar + snapshot, and echoes the rule registry", async () => {
    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4400 })]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([makeVerdictRow()]),
      now: () => new Date("2026-07-09T16:00:00.000Z"), // Thursday RTH
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error("expected a snapshot");

    expect(result.value.positions).toHaveLength(1);
    const position = result.value.positions[0];
    expect(position?.calendarId).toBe("cal-1");
    expect(position?.name).toBe("7000P calendar");
    expect(position?.pnlPct).toBeCloseTo(0.1, 10);
    expect(position?.basis).toEqual({ openNetDebit: 4000, netMark: 4400 });
    expect(position?.verdict.verdict).toBe("TAKE");
    expect(position?.changed).toBe(false);
    expect(result.value.ruleSet.length).toBeGreaterThan(0);
    expect(result.value.ruleSet.map((r) => r.id)).toContain("stop");
  });

  it("marketSession is evaluated at read time (RTH weekday) not tied to the verdict's own observedAt", async () => {
    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition()]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot()]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([makeVerdictRow()]),
      now: () => new Date("2026-07-09T16:00:00.000Z"), // Thursday, RTH
    });

    const result = await useCase();
    if (!result.ok || result.value === null) throw new Error("expected a snapshot");
    expect(result.value.marketSession).toBe("rth");
  });

  it("omits a verdict whose calendar has since closed (no matching held position)", async () => {
    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([]), // cal-1 no longer open
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot()]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([makeVerdictRow()]),
      now: () => new Date("2026-07-09T16:00:00.000Z"),
    });

    const result = await useCase();
    if (!result.ok || result.value === null) throw new Error("expected a snapshot");
    expect(result.value.positions).toEqual([]);
  });

  it("omits a verdict whose calendar has no snapshot yet", async () => {
    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition()]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([]), // no snapshot
      readLatestVerdictsPerCalendar: fakeReadVerdicts([makeVerdictRow()]),
      now: () => new Date("2026-07-09T16:00:00.000Z"),
    });

    const result = await useCase();
    if (!result.ok || result.value === null) throw new Error("expected a snapshot");
    expect(result.value.positions).toEqual([]);
  });

  it("observedAt/asOf reflect the MAX observedAt across included verdicts", async () => {
    const older = makeVerdictRow({
      calendarId: "cal-1",
      observedAt: new Date("2026-07-09T14:00:00.000Z"),
    });
    const newer = makeVerdictRow({
      calendarId: "cal-2",
      observedAt: new Date("2026-07-09T15:30:00.000Z"),
    });

    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([
        makePosition({ calendarId: "cal-1" }),
        makePosition({ calendarId: "cal-2" }),
      ]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([
        makeSnapshot({ calendarId: "cal-1" }),
        makeSnapshot({ calendarId: "cal-2" }),
      ]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([older, newer]),
      now: () => new Date("2026-07-09T16:00:00.000Z"),
    });

    const result = await useCase();
    if (!result.ok || result.value === null) throw new Error("expected a snapshot");
    expect(result.value.observedAt).toEqual(newer.observedAt);
    expect(result.value.asOf).toBe("2026-07-09");
  });
});

// ─── EXIT-09 gap closure: `changed` passthrough (26-VERIFICATION.md) ───────────────

describe("getExitAdvice — changed passthrough (EXIT-09 gap closure)", () => {
  it("passes the persisted row's real write-time `changed:true` through to the API response", async () => {
    const row = makeVerdictRow({
      verdict: {
        verdict: "STOP",
        rung: "-25%",
        ruleId: "stop",
        metric: { name: "pnlPct", value: -0.26, threshold: -0.25 },
        indicative: false,
        escalate: true,
        roll: null,
        changed: true,
      },
    });

    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition()]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot()]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([row]),
      now: () => new Date("2026-07-09T16:00:00.000Z"),
    });

    const result = await useCase();
    if (!result.ok || result.value === null) throw new Error("expected a snapshot");
    expect(result.value.positions[0]?.changed).toBe(true);
  });

  it("a persisted `changed:false` row (unchanged verdict cycle-to-cycle) still reads back false", async () => {
    const row = makeVerdictRow({
      verdict: {
        verdict: "STOP",
        rung: "-25%",
        ruleId: "stop",
        metric: { name: "pnlPct", value: -0.26, threshold: -0.25 },
        indicative: false,
        escalate: true,
        roll: null,
        changed: false,
      },
    });

    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition()]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot()]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([row]),
      now: () => new Date("2026-07-09T16:00:00.000Z"),
    });

    const result = await useCase();
    if (!result.ok || result.value === null) throw new Error("expected a snapshot");
    expect(result.value.positions[0]?.changed).toBe(false);
  });

  it("a legacy row persisted before this fix (no `changed` key at all) still defaults to false", async () => {
    const row = makeVerdictRow(); // verdict has no `changed` key — pre-fix shape
    const useCase = makeGetExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition()]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot()]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([row]),
      now: () => new Date("2026-07-09T16:00:00.000Z"),
    });

    const result = await useCase();
    if (!result.ok || result.value === null) throw new Error("expected a snapshot");
    expect(result.value.positions[0]?.changed).toBe(false);
  });
});
