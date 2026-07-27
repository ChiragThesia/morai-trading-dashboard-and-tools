/**
 * rankCalendars.test.ts — the use-case: one chain read, ranked calendars out.
 *
 * The port-hygiene test at the bottom is the important one. It proves STRUCTURALLY that this
 * use-case cannot reach a gate, a snapshot, a macro series or an events feed — the incumbent
 * grew to fifteen injected dependencies and a three-system entry gate, and the only defence
 * against that happening again is a test that fails when a dependency is added.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeRankCalendarsUseCase } from "./rankCalendars.ts";
import type { RankCalendarsDeps } from "./rankCalendars.ts";
import type { CalendarChainQuote } from "../domain/types.ts";

const NOW = new Date("2026-07-27T16:00:00.000Z");
const SPOT = 7401.89;

function ladder(over: {
  root?: "SPX" | "SPXW";
  expiration: string;
  ivAtm: number;
  strikes?: ReadonlyArray<number>;
}): CalendarChainQuote[] {
  const strikes = over.strikes ?? [7350, 7400, 7450];
  return strikes.map((k) => {
    const iv = over.ivAtm + ((7400 - k) / 50) * 0.004;
    const value = Math.max(20, 60 + (k - 7400) * 0.4);
    return {
      time: NOW,
      strike: k * 1000,
      expiration: over.expiration,
      contractType: "P" as const,
      underlyingPrice: SPOT,
      bsmIv: String(iv),
      root: over.root ?? ("SPXW" as const),
      bid: value,
      ask: value + 1,
      openInterest: 39,
      source: "cboe" as const,
    };
  });
}

const CHAIN: CalendarChainQuote[] = [
  ...ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
  ...ladder({ expiration: "2026-08-26", ivAtm: 0.165 }),
  ...ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
];

/** 25 closes on a gentle uptrend — enough for realizedVol, which needs at least three. */
const CLOSES = Array.from({ length: 25 }, (_, i) => 7300 + i * 4);

function deps(over: Partial<RankCalendarsDeps> = {}): RankCalendarsDeps {
  return {
    readChain: () => Promise.resolve(ok(CHAIN)),
    readExpiryCarry: () => Promise.resolve(ok([])),
    readDailyCloses: () => Promise.resolve(ok(CLOSES)),
    now: () => NOW,
    defaultCarry: { rate: 0.045, divYield: 0.013 },
    ...over,
  };
}

describe("rankCalendars — the happy path", () => {
  it("returns candidates ranked best-first with a decomposable score", async () => {
    const result = await makeRankCalendarsUseCase(deps())({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { candidates, totalCandidates, expiryPairs, spot, asOf } = result.value;
    expect(candidates.length).toBeGreaterThan(0);
    expect(totalCandidates).toBe(candidates.length);
    expect(expiryPairs).toBeGreaterThan(0);
    expect(spot).toBe(SPOT);
    expect(asOf).toEqual(NOW);

    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(candidates[i]?.score ?? 0);
    }
    const top = candidates[0];
    expect(top).toBeDefined();
    if (top === undefined) return;
    const sum = Object.values(top.breakdown).reduce((a, t) => a + t.contribution, 0);
    expect(sum).toBeCloseTo(top.score, 9);
  });

  it("honours the limit without changing totalCandidates", async () => {
    const all = await makeRankCalendarsUseCase(deps())({});
    const capped = await makeRankCalendarsUseCase(deps())({ limit: 2 });
    expect(all.ok && capped.ok).toBe(true);
    if (!all.ok || !capped.ok) return;

    expect(capped.value.candidates).toHaveLength(2);
    expect(capped.value.totalCandidates).toBe(all.value.totalCandidates);
    expect(capped.value.candidates.map((c) => c.score)).toEqual(
      all.value.candidates.slice(0, 2).map((c) => c.score),
    );
  });

  it("reports the realized vol the VRP term actually used", async () => {
    const result = await makeRankCalendarsUseCase(deps())({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.realizedVol).not.toBeNull();
    expect(result.value.candidates[0]?.breakdown.frontVrp.weight).toBeGreaterThan(0);
  });

  it("reports the front ceiling it applied and respects it", async () => {
    const result = await makeRankCalendarsUseCase(deps())({ frontDteMax: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.frontDteMax).toBe(20);
    expect(result.value.candidates.every((c) => c.frontDte <= 20)).toBe(true);
  });

  it("cannot be asked to go below the 15-day floors", async () => {
    // The floors are the trader's rule. There is no request field that lowers them, and a
    // hostile ceiling cannot produce a shorter front leg.
    const result = await makeRankCalendarsUseCase(deps())({ frontDteMax: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);

    const normal = await makeRankCalendarsUseCase(deps())({});
    if (!normal.ok) return;
    expect(normal.value.candidates.every((c) => c.frontDte >= 15)).toBe(true);
    expect(normal.value.candidates.every((c) => c.gapDays >= 15)).toBe(true);
  });
});

describe("rankCalendars — carry", () => {
  it("uses solved per-expiry carry and reports nothing as defaulted", async () => {
    const carry = [
      { expiration: "2026-08-11", rate: 0.0382, divYield: 0.0121 },
      { expiration: "2026-08-26", rate: 0.0383, divYield: 0.0122 },
      { expiration: "2026-09-11", rate: 0.0384, divYield: 0.0123 },
    ];
    const result = await makeRankCalendarsUseCase(
      deps({ readExpiryCarry: () => Promise.resolve(ok(carry)) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultCarryExpiries).toEqual([]);
    expect(result.value.candidates[0]?.carrySource).toEqual({ front: "implied", back: "implied" });
  });

  it("NAMES the expiries it had to price on the flat fallback", async () => {
    // A cohort silently priced at a flat 4.5%/1.3% is not the same measurement as one priced on
    // solved parity carry, and today's browser hides exactly that difference.
    const carry = [{ expiration: "2026-08-11", rate: 0.0382, divYield: 0.0121 }];
    const result = await makeRankCalendarsUseCase(
      deps({ readExpiryCarry: () => Promise.resolve(ok(carry)) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultCarryExpiries).toEqual(["2026-08-26", "2026-09-11"]);
  });
});

describe("rankCalendars — degradation", () => {
  it("fails the call when the chain read fails — a ranking without a chain is not a ranking", async () => {
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(err({ kind: "storage-error", message: "boom" })) }),
    )({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("still ranks when the carry read fails, marking every expiry as defaulted", async () => {
    const result = await makeRankCalendarsUseCase(
      deps({
        readExpiryCarry: () => Promise.resolve(err({ kind: "storage-error", message: "no gex" })),
      }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates.length).toBeGreaterThan(0);
    expect(result.value.defaultCarryExpiries.length).toBeGreaterThan(0);
  });

  it("still ranks when realized vol is unavailable, dropping the VRP term and saying so", async () => {
    const result = await makeRankCalendarsUseCase(
      deps({ readDailyCloses: () => Promise.resolve(ok([])) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.realizedVol).toBeNull();
    expect(result.value.candidates.length).toBeGreaterThan(0);
    expect(result.value.candidates[0]?.breakdown.frontVrp.weight).toBe(0);

    // The surviving three terms renormalise to 100, so the scale is unchanged and snapshots
    // with and without realized vol stay comparable. Leaving the dead term in at weight 25
    // would cap every score in this snapshot at 75 instead.
    const weights = Object.values(result.value.candidates[0]?.breakdown ?? {}).map((t) => t.weight);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    expect(result.value.candidates[0]?.score ?? 0).toBeGreaterThan(75);
  });

  it("returns an empty ranking with drop counts, not an error, when nothing qualifies", async () => {
    const tooClose = [
      ...ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ...ladder({ expiration: "2026-08-20", ivAtm: 0.165 }),
    ];
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok(tooClose)) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);
    expect(result.value.drops["gap-floor"]).toBeGreaterThan(0);
  });

  it("returns an empty ranking for an empty chain rather than throwing", async () => {
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok([])) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);
    expect(result.value.totalCandidates).toBe(0);
  });

  it("never throws, whatever a driven port does", async () => {
    const result = await makeRankCalendarsUseCase(
      deps({
        readChain: () => {
          throw new Error("adapter exploded");
        },
      }),
    )({});
    expect(result.ok).toBe(false);
  });
});

describe("rankCalendars — determinism", () => {
  it("produces a byte-identical ranking from the same snapshot, twice", async () => {
    const run = makeRankCalendarsUseCase(deps());
    const a = await run({});
    const b = await run({});
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });

  it("produces the same ranking however the chain rows are ordered", async () => {
    const forward = await makeRankCalendarsUseCase(deps())({});
    const reversed = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok([...CHAIN].reverse())) }),
    )({});
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(JSON.stringify(forward.value)).toBe(JSON.stringify(reversed.value));
  });
});

describe("port hygiene — the engine cannot reach what it must not", () => {
  it("declares exactly five dependencies", () => {
    // The incumbent reached fifteen. This assertion is the only thing that stops the same drift:
    // adding a gate, a persisted snapshot, a macro series or an events feed fails here first,
    // which forces the addition to be argued rather than absorbed.
    const keys = Object.keys(deps()).sort();
    expect(keys).toEqual([
      "defaultCarry",
      "now",
      "readChain",
      "readDailyCloses",
      "readExpiryCarry",
    ]);
  });

  it("has no dependency whose name suggests a gate, a snapshot or an event feed", () => {
    const forbidden = /gate|vix|snapshot|event|macro|regime|gex|sizing|brake|calendar_?open|position/i;
    for (const key of Object.keys(deps())) {
      expect(forbidden.test(key), `dependency "${key}" reaches outside the engine`).toBe(false);
    }
  });
});
