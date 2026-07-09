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

// ─── Fixture helpers ──────────────────────────────────────────────────────────

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
    const { persist } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 2000 })]), // -50%
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("cal-1");
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
    const { persist } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ time: snapshotTime, netMark: 2000 })]), // still -50%
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(warnSpy).not.toHaveBeenCalled();
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
    const { persist } = makePersistSpy();

    const useCase = makeComputeExitAdviceUseCase({
      readHeldPositions: fakeReadHeldPositions([makePosition({ openNetDebit: 4000 })]),
      readLatestSnapshotPerOpenCalendar: fakeReadSnapshots([makeSnapshot({ netMark: 4400 })]), // +10%
      readLatestVerdictsPerCalendar: fakeReadVerdicts([previous]),
      readEconomicEvents: fakeReadEvents(),
      readChainForRoll: fakeReadChainForRoll(),
      persistExitVerdict: persist,
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    await useCase();
    expect(warnSpy).not.toHaveBeenCalled();
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
      now: () => new Date("2026-07-09T15:05:00.000Z"),
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
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
