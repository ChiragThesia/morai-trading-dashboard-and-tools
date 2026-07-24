/**
 * getTradeDetail.test.ts — per-trade daily history (Trade Ledger expansion).
 *
 * Proves:
 *  - unknown calendarId → ok(null); empty snapshot series → days: [] and zero leg lookups
 *  - snapshots collapse to ONE row per ET day, anchored at the day's LATEST slot, and the
 *    leg resolver is called with that slot time + correct per-leg query args
 *  - per-leg greeks are position-scaled dollars and SIGNED: front (short) × −qty×100,
 *    back (long) × +qty×100; property: front.x + back.x = (backRaw − frontRaw)×qty×100
 *  - 'NaN' strings and missing leg observations map to null, never NaN (JSON rule)
 *  - dep errors propagate
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ok, err, formatOccSymbol } from "@morai/shared";
import { makeGetTradeDetailUseCase } from "./getTradeDetail.ts";
import type {
  Calendar,
  ForResolvingLegObservationForSlot,
  LegSnapshot,
  SnapshotRow,
  StorageError,
} from "./ports.ts";

const CAL: Calendar = {
  id: "cal-1",
  underlying: "SPXW",
  strike: 7400000,
  optionType: "P",
  frontExpiry: "2026-08-11",
  backExpiry: "2026-08-31",
  qty: 1,
  openNetDebit: 40.08,
  status: "open",
  openedAt: new Date("2026-07-23T19:50:00Z"),
  closedAt: null,
  notes: null,
};

function snap(time: string, overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    time: new Date(time),
    calendarId: "cal-1",
    spot: "7400.5",
    netMark: "40.1",
    frontMark: "103.4",
    backMark: "143.5",
    frontIv: "0.145",
    backIv: "0.139",
    frontIvRaw: "0.146",
    backIvRaw: "0.14",
    netDelta: "1.2",
    netGamma: "-0.05",
    netTheta: "38.5",
    netVega: "112.3",
    termSlope: "-0.006",
    dteFront: 18,
    dteBack: 38,
    pnlOpen: "2.0",
    source: "schwab_chain",
    ...overrides,
  };
}

function legObs(
  greeks: Partial<Pick<LegSnapshot, "bsmDelta" | "bsmGamma" | "bsmTheta" | "bsmVega" | "bsmIv">> = {},
): LegSnapshot {
  return {
    occSymbol: formatOccSymbol({
      root: "SPXW",
      expiry: new Date("2026-08-11T12:00:00Z"),
      type: "P",
      strike: 7400,
    }),
    time: new Date("2026-07-23T19:30:00Z"),
    mark: 103.4,
    underlyingPrice: 7400.5,
    ivRaw: 0.146,
    bsmIv: "0.145",
    bsmDelta: "-0.4",
    bsmGamma: "0.002",
    bsmTheta: "-5.5",
    bsmVega: "6.1",
    ...greeks,
  };
}

type ResolverCall = Parameters<ForResolvingLegObservationForSlot>[0];

function makeDeps(overrides: {
  calendar?: Calendar | null;
  snapshots?: ReadonlyArray<SnapshotRow> | null;
  resolve?: ForResolvingLegObservationForSlot;
} = {}) {
  const calls: ResolverCall[] = [];
  const inner: ForResolvingLegObservationForSlot =
    overrides.resolve ?? (async () => ok(legObs()));
  const resolve: ForResolvingLegObservationForSlot = async (query) => {
    calls.push(query);
    return inner(query);
  };
  return {
    calls,
    deps: {
      getCalendarById: async () =>
        ok(overrides.calendar === undefined ? CAL : overrides.calendar),
      readJournal: async () =>
        ok(overrides.snapshots === undefined ? [snap("2026-07-23T19:30:00Z")] : overrides.snapshots),
      resolveLegObservationForSlot: resolve,
    },
  };
}

describe("makeGetTradeDetailUseCase", () => {
  it("unknown calendarId → ok(null)", async () => {
    const { deps } = makeDeps({ calendar: null });
    const result = await makeGetTradeDetailUseCase(deps)("nope");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it("empty snapshot series → days: [], zero leg lookups", async () => {
    const { deps, calls } = makeDeps({ snapshots: [] });
    const result = await makeGetTradeDetailUseCase(deps)("cal-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.days).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("collapses same-ET-day slots to the LATEST, resolves both legs at that slot", async () => {
    const { deps, calls } = makeDeps({
      snapshots: [
        snap("2026-07-23T14:00:00Z", { spot: "7460" }), // 10:00 ET
        snap("2026-07-23T19:30:00Z", { spot: "7400.5" }), // 15:30 ET — same ET day, later
        snap("2026-07-24T14:00:00Z", { spot: "7410" }), // next ET day
      ],
    });
    const result = await makeGetTradeDetailUseCase(deps)("cal-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const days = result.value?.days ?? [];
    expect(days.map((d) => d.date)).toEqual(["2026-07-23", "2026-07-24"]);
    expect(days[0]?.spot).toBeCloseTo(7400.5, 10); // the later slot won
    expect(days[0]?.asOf.toISOString()).toBe("2026-07-23T19:30:00.000Z");

    // 2 legs × 2 days, anchored at the day's chosen slot with per-leg query args
    expect(calls).toHaveLength(4);
    const day1Calls = calls.filter(
      (c) => c.slotAnchor.toISOString() === "2026-07-23T19:30:00.000Z",
    );
    expect(day1Calls.map((c) => c.expiry).sort()).toEqual(["2026-08-11", "2026-08-31"]);
    for (const c of day1Calls) {
      expect(c.underlying).toBe("SPXW");
      expect(c.strike).toBe(7400000);
      expect(c.optionType).toBe("P");
    }
  });

  it("per-leg greeks are dollar-scaled and signed: front short × −qty×100, back long × +qty×100", async () => {
    const cal2: Calendar = { ...CAL, qty: 2 };
    const resolve: ForResolvingLegObservationForSlot = async (query) =>
      ok(
        query.expiry === "2026-08-11"
          ? legObs({ bsmDelta: "0.5", bsmTheta: "-5.5" })
          : legObs({ bsmDelta: "0.4", bsmTheta: "-3.1" }),
      );
    const { deps } = makeDeps({ calendar: cal2, resolve });
    const result = await makeGetTradeDetailUseCase(deps)("cal-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const day = result.value?.days[0];
    expect(day?.front.delta).toBeCloseTo(-100, 8); // 0.5 × −(2×100)
    expect(day?.back.delta).toBeCloseTo(80, 8); // 0.4 × +(2×100)
    expect(day?.front.theta).toBeCloseTo(1100, 8); // −5.5 × −200
    expect(day?.back.theta).toBeCloseTo(-620, 8);
    // marks/IVs come from the snapshot's own columns, raw
    expect(day?.front.mark).toBeCloseTo(103.4, 10);
    expect(day?.back.mark).toBeCloseTo(143.5, 10);
    expect(day?.front.iv).toBeCloseTo(0.145, 10);
    expect(day?.back.iv).toBeCloseTo(0.139, 10);
  });

  it("'NaN' greek strings and missing leg observations map to null", async () => {
    const resolve: ForResolvingLegObservationForSlot = async (query) =>
      query.expiry === "2026-08-11"
        ? ok(legObs({ bsmDelta: "NaN", bsmVega: null }))
        : ok(null); // back leg has no observation for the slot
    const { deps } = makeDeps({ resolve });
    const result = await makeGetTradeDetailUseCase(deps)("cal-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const day = result.value?.days[0];
    expect(day?.front.delta).toBeNull();
    expect(day?.front.vega).toBeNull();
    expect(day?.front.theta).not.toBeNull(); // unaffected sibling greek
    expect(day?.back.delta).toBeNull();
    expect(day?.back.theta).toBeNull();
    // snapshot 'NaN' → null too
    const { deps: deps2 } = makeDeps({
      snapshots: [snap("2026-07-23T19:30:00Z", { frontIv: "NaN", spot: "NaN" })],
    });
    const r2 = await makeGetTradeDetailUseCase(deps2)("cal-1");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value?.days[0]?.front.iv).toBeNull();
    expect(r2.value?.days[0]?.spot).toBeNull();
  });

  it("property: front.x + back.x = (backRaw − frontRaw) × qty × 100 for finite greeks", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.integer({ min: 1, max: 5 }),
        async (frontRaw, backRaw, qty) => {
          const resolve: ForResolvingLegObservationForSlot = async (query) =>
            ok(
              legObs({
                bsmDelta: String(query.expiry === "2026-08-11" ? frontRaw : backRaw),
              }),
            );
          const { deps } = makeDeps({ calendar: { ...CAL, qty }, resolve });
          const result = await makeGetTradeDetailUseCase(deps)("cal-1");
          if (!result.ok) return false;
          const day = result.value?.days[0];
          if (day?.front.delta === null || day?.front.delta === undefined) return false;
          if (day.back.delta === null) return false;
          const sum = day.front.delta + day.back.delta;
          const expected = (backRaw - frontRaw) * qty * 100;
          return Math.abs(sum - expected) < 1e-6 * Math.max(1, Math.abs(expected));
        },
      ),
      { numRuns: 50 },
    );
  });

  it("propagates dep errors", async () => {
    const boom = err<StorageError>({ kind: "storage-error", message: "db down" });
    // getCalendarById err
    const r1 = await makeGetTradeDetailUseCase({
      ...makeDeps({}).deps,
      getCalendarById: async () => boom,
    })("cal-1");
    expect(r1.ok).toBe(false);
    // readJournal err
    const r2 = await makeGetTradeDetailUseCase({
      ...makeDeps({}).deps,
      readJournal: async () => boom,
    })("cal-1");
    expect(r2.ok).toBe(false);
    // resolver err
    const r3 = await makeGetTradeDetailUseCase({
      ...makeDeps({}).deps,
      resolveLegObservationForSlot: async () => boom,
    })("cal-1");
    expect(r3.ok).toBe(false);
  });
});
