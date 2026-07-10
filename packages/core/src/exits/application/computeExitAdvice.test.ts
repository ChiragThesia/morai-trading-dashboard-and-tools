/**
 * computeExitAdvice.ts tests (Phase 26, Plan 04) — the per-cycle read → evaluate → persist
 * orchestration seam, per tdd.md, with in-memory port fakes.
 *
 * Covers:
 *   - Read order / one-verdict-per-open-calendar: every open calendar with a snapshot gets
 *     exactly one persisted verdict this cycle.
 *   - A calendar with no snapshot yet is skipped (not an error), other calendars still get verdicts.
 *   - Hysteresis self-read: the previous verdict row feeds evaluateExit's 3rd argument.
 *   - Change detection: console.warn fires only when (verdict,rung,ruleId) changed AND escalate.
 *   - EXIT-09 gap closure (26-VERIFICATION.md): the SAME `changed` value is attached to the
 *     persisted row, not just used for the console.warn side-effect (was previously discarded).
 *   - Indicative pass-through: an after-hours snapshot produces an indicative, non-escalating verdict.
 *   - Partial-failure/resume: a persist error on one calendar surfaces as err immediately.
 *   - observedAt is the calendar's own snapshot time (retry-idempotency grain), not wall-clock now().
 *   - ROLL: chain-for-roll read failure degrades to empty candidates, non-fatal.
 *   - EXIT-10 static guard: no non-test source file under exits/ imports an order-placement port.
 *
 * Fixtures use distinct timestamps per describe block (green-suite lesson).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makeComputeExitAdviceUseCase } from "./computeExitAdvice.ts";
import type { HeldPosition, Tier1Event } from "../domain/types.ts";
import type {
  ChainQuoteForRoll,
  ExitVerdictRow,
  ForPersistingExitVerdict,
  ForReadingChainForRoll,
  ForReadingEconomicEvents,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingLatestVerdictsPerCalendar,
  LatestSnapshotForCalendar,
  StorageError,
} from "./ports.ts";
import type { ForReadingRuleOverrides } from "../../settings/application/ports.ts";
import type { StoredRuleOverrides } from "../../settings/domain/merge.ts";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

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

function fakeReadChainForRoll(
  quotes: ReadonlyArray<ChainQuoteForRoll> = [],
): ForReadingChainForRoll {
  return async (): Promise<Result<ReadonlyArray<ChainQuoteForRoll>, StorageError>> => ok(quotes);
}

/** 29-11: fresh-per-run rule-overrides read. Defaults to `{}` (no overrides). */
function fakeReadRuleOverrides(overrides: StoredRuleOverrides = {}): ForReadingRuleOverrides {
  return async () => ok(overrides);
}

function makePersistSpy(): { readonly persist: ForPersistingExitVerdict; readonly calls: ExitVerdictRow[] } {
  const calls: ExitVerdictRow[] = [];
  const persist: ForPersistingExitVerdict = async (row) => {
    calls.push(row);
    return ok(undefined);
  };
  return { persist, calls };
}

// ─── Read order / one-verdict-per-open-calendar ────────────────────────────────

describe("computeExitAdvice — one verdict per open calendar", () => {
  it("persists exactly one verdict per calendar that has a snapshot", async () => {
    const positions = [makePosition({ calendarId: "cal-1" }), makePosition({ calendarId: "cal-2" })];
    const snapshots = [
      makeSnapshot({ calendarId: "cal-1" }),
      makeSnapshot({ calendarId: "cal-2" }),
    ];
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions(positions),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots(snapshots),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.calendarId).sort()).toEqual(["cal-1", "cal-2"]);
  });

  it("observedAt on the persisted row is the calendar's own snapshot time, not wall-clock now()", async () => {
    const snapshotTime = new Date("2026-07-09T14:30:00.000Z");
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition()]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ time: snapshotTime })]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"), // 35 min after the snapshot
    });

    await useCase();
    expect(calls[0]?.observedAt).toEqual(snapshotTime);
  });

  it("skips a calendar with no snapshot yet, without erroring, and still persists the others", async () => {
    const positions = [makePosition({ calendarId: "cal-1" }), makePosition({ calendarId: "cal-2" })];
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions(positions),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ calendarId: "cal-1" })]), // cal-2 missing
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.calendarId).toBe("cal-1");
  });
});

// ─── Hysteresis self-read ───────────────────────────────────────────────────────

describe("computeExitAdvice — hysteresis self-read feeds evaluateExit", () => {
  it("a cold-start calendar (no previous row) evaluates with previousVerdict = null", async () => {
    const { persist, calls } = makePersistSpy();
    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4400 })]), // +10%
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(calls[0]?.verdict.verdict).toBe("TAKE");
    expect(calls[0]?.verdict.rung).toBe("+10%");
  });

  it("an armed TAKE rung stays armed inside the hysteresis band via the previous verdict row", async () => {
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
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      // netMark dropped to +8.5% — below the +10% arm line but still above the +8% disarm line.
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ time: snapshotTime, netMark: 4340 })]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(calls[0]?.verdict.verdict).toBe("TAKE");
    expect(calls[0]?.verdict.rung).toBe("+10%"); // still armed, not disarmed to +5%
  });
});

// ─── Change detection / escalation logging (EXIT-09) ────────────────────────────

describe("computeExitAdvice — change detection", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs a warning when the verdict CHANGES to an escalating verdict (STOP)", async () => {
    const previous: ExitVerdictRow = {
      observedAt: new Date("2026-07-09T14:30:00.000Z"),
      calendarId: "cal-1",
      verdict: {
        verdict: "HOLD",
        rung: null,
        ruleId: "hold",
        metric: { name: "pnlPct", value: 0, threshold: 0 },
        indicative: false,
        escalate: false,
        roll: null,
      },
    };
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 2000 })]), // -50%
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("cal-1");
    // EXIT-09 gap closure: the persisted row carries the SAME `changed:true` the warn used.
    expect(calls[0]?.verdict.changed).toBe(true);
  });

  it("does NOT log when the same STOP rung stays armed cycle to cycle (unchanged)", async () => {
    const snapshotTime = new Date("2026-07-09T15:00:00.000Z");
    const previous: ExitVerdictRow = {
      observedAt: new Date("2026-07-09T14:30:00.000Z"),
      calendarId: "cal-1",
      verdict: {
        verdict: "STOP",
        rung: "-50%",
        ruleId: "stop",
        metric: { name: "pnlPct", value: -0.5, threshold: -0.5 },
        indicative: false,
        escalate: true,
        roll: null,
      },
    };
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ time: snapshotTime, netMark: 2000 })]), // still -50%
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(warnSpy).not.toHaveBeenCalled();
    // EXIT-09 gap closure: an unchanged verdict persists `changed:false`.
    expect(calls[0]?.verdict.changed).toBe(false);
  });

  it("logs when escalate transitions false→true even though the verdict is unchanged (IN-05)", async () => {
    // Last cycle the STOP was indicative (escalate:false); this cycle the SAME STOP -50% rung
    // becomes actionable (escalate:true). (verdict,rung,ruleId) are identical so changed=false,
    // but the position just became actionable — ops visibility must still fire.
    const snapshotTime = new Date("2026-07-09T15:00:00.000Z");
    const previous: ExitVerdictRow = {
      observedAt: new Date("2026-07-09T14:30:00.000Z"),
      calendarId: "cal-1",
      verdict: {
        verdict: "STOP",
        rung: "-50%",
        ruleId: "stop",
        metric: { name: "pnlPct", value: -0.5, threshold: -0.5 },
        indicative: true,
        escalate: false,
        roll: null,
      },
    };
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ time: snapshotTime, netMark: 2000 })]), // -50%, fresh RTH → actionable
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The verdict itself is unchanged cycle-to-cycle — the warn fired on the escalation onset.
    expect(calls[0]?.verdict.changed).toBe(false);
    expect(calls[0]?.verdict.escalate).toBe(true);
  });

  it("does NOT log on a changed but non-escalating verdict (e.g. HOLD to TAKE)", async () => {
    const previous: ExitVerdictRow = {
      observedAt: new Date("2026-07-09T14:30:00.000Z"),
      calendarId: "cal-1",
      verdict: {
        verdict: "HOLD",
        rung: null,
        ruleId: "hold",
        metric: { name: "pnlPct", value: 0, threshold: 0 },
        indicative: false,
        escalate: false,
        roll: null,
      },
    };
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4400 })]), // +10%
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(warnSpy).not.toHaveBeenCalled();
    // EXIT-09 gap closure: changed-but-non-escalating still persists `changed:true` — the UI's
    // (non-red) CHANGED marker is a separate concern from console.warn's escalation gate.
    expect(calls[0]?.verdict.changed).toBe(true);
  });
});

// ─── Indicative pass-through ─────────────────────────────────────────────────────

describe("computeExitAdvice — indicative pass-through", () => {
  it("an after-hours snapshot produces an indicative verdict with escalate forced false", async () => {
    // Saturday — always after-hours regardless of clock time (weekend gate in isWithinRth).
    const afterHoursTime = new Date("2026-07-11T15:00:00.000Z");
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([
        makeSnapshot({ time: afterHoursTime, netMark: 2000 }), // -50%, STOP-worthy
      ]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => afterHoursTime,
    });

    await useCase();
    expect(calls[0]?.verdict.indicative).toBe(true);
    expect(calls[0]?.verdict.escalate).toBe(false);
  });
});

// ─── Partial-failure / resume ────────────────────────────────────────────────────

describe("computeExitAdvice — partial-failure surfaces err for pg-boss retry", () => {
  it("a persist error on one calendar returns err immediately (no further calendars processed)", async () => {
    const positions = [makePosition({ calendarId: "cal-1" }), makePosition({ calendarId: "cal-2" })];
    const snapshots = [
      makeSnapshot({ calendarId: "cal-1" }),
      makeSnapshot({ calendarId: "cal-2" }),
    ];
    const calls: string[] = [];
    const failingPersist: ForPersistingExitVerdict = async (row) => {
      calls.push(row.calendarId);
      return err<StorageError>({ kind: "storage-error", message: "boom" });
    };

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions(positions),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots(snapshots),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: failingPersist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    const result = await useCase();
    expect(result.ok).toBe(false);
    expect(calls).toEqual(["cal-1"]); // stopped after the first failure — cal-2 never attempted
  });
});

// ─── ROLL chain read failure is non-fatal ────────────────────────────────────────

describe("computeExitAdvice — chain-for-roll read failure degrades gracefully", () => {
  it("a chain-for-roll error does not fail the cycle — the calendar still gets a verdict", async () => {
    const { persist, calls } = makePersistSpy();
    const failingChain: ForReadingChainForRoll = async () =>
      err<StorageError>({ kind: "storage-error", message: "chain unavailable" });

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition()]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot()]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: failingChain,
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

// ─── Runtime rule-settings overrides (29-11, RUNTIME-*) ──────────────────────────
//
// readRuleOverrides threading: fresh-per-run read, byte-identical omission, overridden
// rung firing, read-error degradation. Mirrors 29-10's picker "runtime rule overrides"
// describe block shape.

describe("computeExitAdvice — runtime rule overrides (29-11)", () => {
  it("no exits override -> the fired verdict matches the compile-time TAKE_RUNGS byte-identically (byte-identical omission, T-29-05)", async () => {
    const { persist, calls } = makePersistSpy();
    // pnlPct = (4140 - 4000) / 4000 = 3.5% — below the default +5% arm (0.05) → no TAKE rung fires.
    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4140 })]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides(),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(calls[0]?.verdict.verdict).toBe("HOLD");
    expect(calls[0]?.verdict.rung).toBeNull();
  });

  it("an exits.take.plus5Arm override lowers the +5% arm threshold and changes the fired rung on the next run (T-29-16)", async () => {
    const { persist, calls } = makePersistSpy();
    // Same 3.5% pnlPct as the omission case above — but the override lowers the +5% arm to 3%,
    // so this cycle now fires TAKE +5% where the compile-time default would not.
    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4140 })]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: fakeReadRuleOverrides({ exits: { take: { plus5Arm: 0.03 } } }),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(calls[0]?.verdict.verdict).toBe("TAKE");
    expect(calls[0]?.verdict.rung).toBe("+5%");
  });

  it("a readRuleOverrides read error degrades to the compile-time defaults rather than failing the whole cycle (T-29-15)", async () => {
    const { persist, calls } = makePersistSpy();
    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4140 })]),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: async () => err<StorageError>({ kind: "storage-error", message: "settings read failed" }),
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    // Same as the omission case: a read failure never fails compute-exit-advice, it just falls
    // back to the compile-time defaults (below the default +5% arm → no TAKE rung fires).
    expect(calls[0]?.verdict.verdict).toBe("HOLD");
    expect(calls[0]?.verdict.rung).toBeNull();
  });

  it("readRuleOverrides is called once per run, before the per-position loop — the same resolved config applies to every position that run", async () => {
    let callCount = 0;
    const trackedReadRuleOverrides: ForReadingRuleOverrides = async () => {
      callCount += 1;
      return ok({ exits: { take: { plus5Arm: 0.03 } } });
    };
    const positions = [makePosition({ calendarId: "cal-1" }), makePosition({ calendarId: "cal-2" })];
    const snapshots = [
      makeSnapshot({ calendarId: "cal-1", netMark: 4140 }), // 3.5% — fires TAKE +5% only under the override
      makeSnapshot({ calendarId: "cal-2", netMark: 4140 }),
    ];
    const { persist, calls } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions(positions),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots(snapshots),
      readLatestVerdictsPerCalendar: fakeReadVerdicts([]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      readRuleOverrides: trackedReadRuleOverrides,
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(callCount).toBe(1); // fresh-per-RUN, not fresh-per-position
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.verdict.verdict === "TAKE" && c.verdict.rung === "+5%")).toBe(true);
  });
});

// ─── EXIT-10 — never-execute static guard ────────────────────────────────────────

// Minimal local ambient shape for Vite's `import.meta.glob` (used only in the guard test
// below) — narrower than pulling in the full `vite/client` triple-slash reference (which
// isn't resolvable from packages/core's isolated tsconfig/typeRoots and would drag in
// unrelated DOM lib globals anyway). node:fs itself is architecture-boundaries-forbidden
// inside packages/core (no-restricted-imports "node:*", applies to *.test.ts too — no
// test-file carve-out); import.meta.glob is Vite's own static-import mechanism (vitest runs
// on Vite, confirmed by the vite:* plugin messages in every `bun run test` invocation) — it
// statically inlines file contents at collection time with no node I/O builtin involved.
declare global {
  interface ImportMeta {
    glob: (
      pattern: string | ReadonlyArray<string>,
      options: { readonly query: string; readonly import: string; readonly eager: true },
    ) => Record<string, unknown>;
  }
}

describe("EXIT-10 — never-execute guard", () => {
  it("no non-test source file under exits/ imports an order-placement/brokerage-write port", () => {
    const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const files = Object.entries(modules);
    expect(files.length).toBeGreaterThan(0); // sanity: the scan actually found source files

    // Assembled from fragments so this guard's own literal is never a false positive if a
    // future refactor moves this test file's content into a non-test-suffixed source file.
    // Checks ONLY `import ...` lines (not doc-comment prose warning about the guard itself —
    // e.g. ports.ts's own header comment names this token while explaining the guard).
    const forbiddenToken = ["For", "Placing", "Order"].join("");
    const importLine = /^\s*import\b/;
    for (const [path, content] of files) {
      const offendingImportLines = String(content)
        .split("\n")
        .filter((line) => importLine.test(line) && line.includes(forbiddenToken));
      expect(offendingImportLines, `in ${path}`).toEqual([]);
    }
  });
});
