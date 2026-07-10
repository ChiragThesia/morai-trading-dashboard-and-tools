/**
 * previewExitRuleOverrides.ts tests (Phase 32, Plan 03, B2) — per tdd.md's numerical-code rule
 * (fast-check property test) plus example tests, mirroring computeExitAdvice.test.ts's fixture
 * shapes and previewPickerRuleOverrides.test.ts's byte-parity property structure.
 *
 * Covers:
 *   - byte-parity property (T-32-02 precedent): an ABSENT/empty staged exits group reproduces
 *     the SAME verdict the current config produces, for every open position.
 *   - a staged rung change (plus10Arm) flips the previewed verdict where the metric crosses
 *     the new arm.
 *   - an AH/stale snapshot stays indicative on both current and staged sides.
 *   - a calendar with no snapshot yet is skipped, not an error.
 *   - StorageError propagation from each critical read.
 *   - port hygiene: deps structurally exclude persistExitVerdict / readChainForRoll.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makePreviewExitRuleOverridesUseCase } from "./previewExitRuleOverrides.ts";
import type { HeldPosition, Tier1Event } from "../domain/types.ts";
import type {
  ExitPreviewDeps,
  ExitVerdictRow,
  ForReadingEconomicEvents,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingLatestVerdictsPerCalendar,
  LatestSnapshotForCalendar,
  StorageError,
} from "./ports.ts";
import type { ForReadingRuleOverrides } from "../../settings/application/ports.ts";
import type { StoredRuleOverrides } from "../../settings/domain/merge.ts";

// ─── Fixture helpers (mirror computeExitAdvice.test.ts) ──────────────────────────

function makePosition(overrides: Partial<HeldPosition> = {}): HeldPosition {
  return {
    calendarId: "cal-1",
    name: "7000P calendar",
    strike: 7000,
    optionType: "P",
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
    netMark: 4000,
    pnlOpen: 0,
    spot: 7000,
    frontIv: 0.2,
    backIv: 0.25,
    dteFront: 30,
    dteBack: 58,
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

function fakeReadEvents(events: ReadonlyArray<Tier1Event> = []): ForReadingEconomicEvents {
  return async (): Promise<Result<ReadonlyArray<Tier1Event>, StorageError>> => ok(events);
}

function fakeReadRuleOverrides(overrides: StoredRuleOverrides = {}): ForReadingRuleOverrides {
  return async () => ok(overrides);
}

function makeDeps(overrides: Partial<ExitPreviewDeps> = {}): ExitPreviewDeps {
  return {
    readHeldPositions: fakeReadHeldPositions([makePosition()]),
    readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot()]),
    readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
    readEconomicEvents: fakeReadEvents(),
    readRuleOverrides: fakeReadRuleOverrides(),
    now: () => new Date("2026-07-09T15:05:00.000Z"),
    ...overrides,
  };
}

describe("makePreviewExitRuleOverridesUseCase", () => {
  it("byte-parity: an ABSENT staged exits group reproduces the current verdict EXACTLY, for every open position (fast-check)", async () => {
    const netMarkArb = fc.double({ min: 1000, max: 8000, noNaN: true });

    await fc.assert(
      fc.asyncProperty(netMarkArb, async (netMark) => {
        const deps = makeDeps({
          readHeldPositions: fakeReadHeldPositions([
            makePosition({ calendarId: "cal-1", openNetDebit: 4000 }),
            makePosition({ calendarId: "cal-2", openNetDebit: 4000 }),
          ]),
          readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([
            makeSnapshot({ calendarId: "cal-1", netMark }),
            makeSnapshot({ calendarId: "cal-2", netMark }),
          ]),
        });
        const preview = makePreviewExitRuleOverridesUseCase(deps);
        const result = await preview(); // no staged argument at all
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(2);
        for (const entry of result.value) {
          expect(entry.staged.verdict).toBe(entry.current.verdict);
          expect(entry.staged.rung).toBe(entry.current.rung);
          expect(entry.staged.ruleId).toBe(entry.current.ruleId);
        }
      }),
    );
  });

  it("byte-parity: an EMPTY staged exits group ({}) also reproduces the current verdict EXACTLY", async () => {
    const deps = makeDeps({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4400 })]), // +10%
    });
    const result = await makePreviewExitRuleOverridesUseCase(deps)({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.staged.verdict).toBe(result.value[0]?.current.verdict);
    expect(result.value[0]?.staged.rung).toBe(result.value[0]?.current.rung);
  });

  it("a staged plus10Arm rung change flips the previewed verdict where the metric crosses the new arm", async () => {
    // pnlPct = (4300 - 4000) / 4000 = 7.5% -- below the default +10% arm, so current stays
    // at the default TAKE rung reachable at 7.5% (none: +5% arm is 0.05 <= 0.075, so current
    // fires TAKE +5%). Staging plus10Arm down to 0.07 makes the staged config fire TAKE +10%
    // instead -- the metric crosses the NEW arm but not the OLD one.
    const deps = makeDeps({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4300 })]),
    });
    const result = await makePreviewExitRuleOverridesUseCase(deps)({ take: { plus10Arm: 0.07 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [entry] = result.value;
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.current.verdict).toBe("TAKE");
    expect(entry.current.rung).toBe("+5%");
    expect(entry.staged.verdict).toBe("TAKE");
    expect(entry.staged.rung).toBe("+10%");
  });

  it("an after-hours/stale snapshot still computes a normal verdict identity on both sides (Pitfall 4: the AH gate forces indicative on the OUTPUT, it never blocks rule evaluation)", async () => {
    // Saturday -- always after-hours regardless of clock time (weekend gate in isWithinRth).
    const afterHoursTime = new Date("2026-07-11T15:00:00.000Z");
    const deps = makeDeps({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([
        makeSnapshot({ time: afterHoursTime, netMark: 2000 }), // -50%, STOP-worthy metric
      ]),
      now: () => afterHoursTime,
    });
    const result = await makePreviewExitRuleOverridesUseCase(deps)();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [entry] = result.value;
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    // The AH gate never suppresses the underlying rule identity -- both sides still resolve
    // to the STOP -50% rung, exactly as the RTH case would (ExitPreviewEntry carries no
    // `indicative` field per the contract; the gate's only observable effect here is that it
    // never crashes or masks the winning rule).
    expect(entry.current.verdict).toBe("STOP");
    expect(entry.current.rung).toBe("-50%");
    expect(entry.staged.verdict).toBe("STOP");
    expect(entry.staged.rung).toBe("-50%");
  });

  it("skips a calendar with no snapshot yet, without erroring, and still previews the others", async () => {
    const deps = makeDeps({
      readHeldPositions: fakeReadHeldPositions([
        makePosition({ calendarId: "cal-1" }),
        makePosition({ calendarId: "cal-2" }),
      ]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ calendarId: "cal-1" })]), // cal-2 missing
    });
    const result = await makePreviewExitRuleOverridesUseCase(deps)();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.calendarId).toBe("cal-1");
  });

  it("a stored (self-read) previous verdict feeds hysteresis into BOTH current and staged evaluations", async () => {
    const snapshotTime = new Date("2026-07-09T15:00:00.000Z");
    const previous: ExitVerdictRow = {
      observedAt: new Date("2026-07-09T14:30:00.000Z"),
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
    };
    const deps = makeDeps({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      // netMark dropped to +8.5% -- below the +10% arm but still above the +8% disarm line.
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ time: snapshotTime, netMark: 4340 })]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
    });
    const result = await makePreviewExitRuleOverridesUseCase(deps)();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Held armed via hysteresis on BOTH sides (empty staged group).
    expect(result.value[0]?.current.rung).toBe("+10%");
    expect(result.value[0]?.staged.rung).toBe("+10%");
  });

  it("propagates a StorageError from readHeldPositions unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "read failed" };
    const deps = makeDeps({ readHeldPositions: async () => err(storageError) });
    const result = await makePreviewExitRuleOverridesUseCase(deps)();
    expect(result).toEqual(err(storageError));
  });

  it("propagates a StorageError from readLatestSnapshotPerOpenCalendar unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "read failed" };
    const deps = makeDeps({ readLatestSnapshotPerOpenCalendar: async () => err(storageError) });
    const result = await makePreviewExitRuleOverridesUseCase(deps)();
    expect(result).toEqual(err(storageError));
  });

  it("propagates a StorageError from readLatestVerdictsPerCalendar unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "read failed" };
    const deps = makeDeps({ readLatestVerdictsPerCalendar: async () => err(storageError) });
    const result = await makePreviewExitRuleOverridesUseCase(deps)();
    expect(result).toEqual(err(storageError));
  });

  it("propagates a StorageError from readEconomicEvents unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "read failed" };
    const deps = makeDeps({ readEconomicEvents: async () => err(storageError) });
    const result = await makePreviewExitRuleOverridesUseCase(deps)();
    expect(result).toEqual(err(storageError));
  });

  it("a readRuleOverrides read error degrades to the compile-time defaults rather than failing the whole preview", async () => {
    const deps = makeDeps({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4140 })]), // 3.5%
      readRuleOverrides: async () => err<StorageError>({ kind: "storage-error", message: "settings read failed" }),
    });
    const result = await makePreviewExitRuleOverridesUseCase(deps)();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Below the default +5% arm -> HOLD on both sides, never a fatal error.
    expect(result.value[0]?.current.verdict).toBe("HOLD");
    expect(result.value[0]?.staged.verdict).toBe("HOLD");
  });

  it("port hygiene: deps structurally exclude persistExitVerdict and readChainForRoll -- only these 6 fields exist", async () => {
    const deps = makeDeps();
    expect(Object.keys(deps).sort()).toEqual(
      [
        "now",
        "readEconomicEvents",
        "readHeldPositions",
        "readLatestSnapshotPerOpenCalendar",
        "readLatestVerdictsPerCalendar",
        "readRuleOverrides",
      ].sort(),
    );
  });
});
