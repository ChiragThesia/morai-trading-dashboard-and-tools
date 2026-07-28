/**
 * calendar-rank.routes.test.ts — GET /calendars/ranked (spec.mdx §11).
 *
 * The last describe is the one that matters: it drives the REAL rankCalendars use-case through
 * the REAL route and parses the response with the REAL rankedCalendarResponse schema. The core
 * ranking type and this contract are mirrored by hand with no compile-time link between the
 * fields' nullability, and this repo has shipped that exact drift before. A fixture that agrees
 * with the schema it is testing proves nothing; a real engine result does.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import { makeRankCalendarsUseCase } from "@morai/core";
import type {
  CalendarChainQuote,
  CalendarRanking,
  ForRankingCalendars,
  RankCalendarsDeps,
  RankCalendarsRequest,
} from "@morai/core";
import { rankedCalendarResponse } from "@morai/contracts";
import { calendarRankRoutes } from "./calendar-rank.routes.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

const NOW = new Date("2026-07-27T16:00:00.000Z");
const SPOT = 7401.89;

const LEG = {
  strike: 7400,
  iv: 0.1712,
  bid: 61.2,
  ask: 62.4,
  mid: 61.8,
  openInterest: 39,
  extrinsic: 61.8,
  delta: -0.48,
  gamma: 0.00042,
  theta: -1.84,
  vega: 6.12,
  tradeable: true,
};

const TERM = { raw: 0.0771, percentile: 96.4, weight: 45, contribution: 43.38 };

/** One ranked row with a null in every nullable slot — the shape a real snapshot produces. */
const ROW = {
  root: "SPXW" as const,
  strike: 7400,
  frontExpiration: "2026-08-21",
  backExpiration: "2026-09-18",
  frontDte: 25,
  backDte: 53,
  gapDays: 28,
  score: 91.2,
  breakdown: {
    fwdEdge: TERM,
    deltaBalance: { raw: null, percentile: null, weight: 0, contribution: 0 },
  },
  fwdIv: 0.1589,
  cushion: 0.0021,
  ffAtm: 0.0771,
  slope: 0.0184,
  frontRefIv: 0.1712,
  backRefIv: 0.161,
  ffStrike: null,
  hSkew: 0.0102,
  vSkewFront: null,
  vSkewBack: null,
  frontIv: 0.1712,
  backIv: 0.161,
  net: { delta: 0.021, gamma: -0.00018, theta: 1.12, vega: 8.4 },
  thetaCarry: null,
  debit: 21.4,
  spreadCost: 2.4,
  frontLeg: LEG,
  backLeg: LEG,
  carrySource: { front: "implied" as const, back: "default" as const },
};

const RANKING: CalendarRanking = {
  asOf: NOW,
  spot: SPOT,
  candidates: [ROW],
  totalCandidates: 2454,
  expiryPairs: 124,
  drops: {
    "front-dte-floor": 12,
    "front-dte-ceiling": 3,
    "back-dte-ceiling": 1,
    "gap-floor": 44,
    "root-mismatch": 8,
    "not-tradeable": 91,
    "no-iv": 0,
    "term-inverted": 6,
    "no-atm-reference": 2,
  },
  realizedVol: null,
  frontDteMax: 60,
  defaultCarryExpiries: ["2026-09-18"],
};

const rankOk: ForRankingCalendars = async () => ok(RANKING);

const rankErr: ForRankingCalendars = async () =>
  err({ kind: "storage-error" as const, message: "db connection failed" });

/** Captures the request the route hands the use-case. */
function makeSpy(): { rank: ForRankingCalendars; seen: RankCalendarsRequest[] } {
  const seen: RankCalendarsRequest[] = [];
  const rank: ForRankingCalendars = async (request) => {
    seen.push(request);
    return ok(RANKING);
  };
  return { rank, seen };
}

function buildTestApp(rankCalendars: ForRankingCalendars) {
  const app = new Hono();
  // Mounted at "/" matching the main.ts apiRouter chain — effective path is
  // GET /api/calendars/ranked.
  app.route("/", calendarRankRoutes(rankCalendars));
  return app;
}

// ── Route behaviour ───────────────────────────────────────────────────────────

describe("GET /calendars/ranked", () => {
  it("returns 200 with a rankedCalendarResponse-valid body", async () => {
    const res = await buildTestApp(rankOk).request("/calendars/ranked");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = rankedCalendarResponse.parse(body);
    expect(parsed.asOf).toBe("2026-07-27T16:00:00.000Z");
    expect(parsed.spot).toBeCloseTo(SPOT, 6);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.root).toBe("SPXW");
    expect(parsed.totalCandidates).toBe(2454);
    expect(parsed.drops["gap-floor"]).toBe(44);
  });

  it("serializes asOf as an ISO string — a raw Date fails the contract", async () => {
    const res = await buildTestApp(rankOk).request("/calendars/ranked");
    const body: unknown = await res.json();
    const parsed = rankedCalendarResponse.parse(body);
    expect(parsed.asOf).toBe(NOW.toISOString());
  });

  it("forwards frontDteMax, limit and contractType to the use-case", async () => {
    const spy = makeSpy();
    const res = await buildTestApp(spy.rank).request(
      "/calendars/ranked?frontDteMax=45&limit=5&contractType=C",
    );
    expect(res.status).toBe(200);
    expect(spy.seen).toEqual([{ frontDteMax: 45, limit: 5, contractType: "C" }]);
  });

  it("omits absent params entirely so the use-case's own defaults apply", async () => {
    const spy = makeSpy();
    await buildTestApp(spy.rank).request("/calendars/ranked");
    // Not {frontDteMax: undefined} — exactOptionalPropertyTypes, and an explicit undefined
    // would override a default in any callee that checks `in`.
    expect(spy.seen).toEqual([{}]);
  });

  it("returns 400 on an invalid query and never calls the use-case", async () => {
    const spy = makeSpy();
    const res = await buildTestApp(spy.rank).request("/calendars/ranked?limit=nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toStrictEqual({ error: "invalid query" });
    expect(spy.seen).toEqual([]);
  });

  it("returns 500 {error:'internal'} on a storage error — no DB message on the wire", async () => {
    const res = await buildTestApp(rankErr).request("/calendars/ranked");
    expect(res.status).toBe(500);
    expect(await res.json()).toStrictEqual({ error: "internal" });
  });
});

// ── Cross-seam: real use-case → real schema ───────────────────────────────────

/** A put ladder at one expiry, mirroring rankCalendars.test.ts's fixture shape. */
function ladder(expiration: string, ivAtm: number): CalendarChainQuote[] {
  return [7350, 7400, 7450].map((k) => {
    const iv = ivAtm + ((7400 - k) / 50) * 0.004;
    const value = Math.max(20, 60 + (k - 7400) * 0.4);
    return {
      time: NOW,
      strike: k * 1000,
      expiration,
      contractType: "P" as const,
      underlyingPrice: SPOT,
      bsmIv: String(iv),
      root: "SPXW" as const,
      bid: value,
      ask: value + 1,
      openInterest: 39,
      source: "cboe" as const,
    };
  });
}

const CHAIN: CalendarChainQuote[] = [
  ...ladder("2026-08-11", 0.17),
  ...ladder("2026-08-26", 0.165),
  ...ladder("2026-09-11", 0.16),
];

function realDeps(over: Partial<RankCalendarsDeps> = {}): RankCalendarsDeps {
  return {
    readChain: () => Promise.resolve(ok(CHAIN)),
    readExpiryCarry: () => Promise.resolve(ok([])),
    readDailyCloses: () => Promise.resolve(ok(Array.from({ length: 25 }, (_, i) => 7300 + i * 4))),
    now: () => NOW,
    defaultCarry: { rate: 0.045, divYield: 0.013 },
    ...over,
  };
}

describe("cross-seam: a REAL engine result satisfies the REAL contract", () => {
  it("parses a live-shaped ranking through rankedCalendarResponse without throwing", async () => {
    const app = buildTestApp(makeRankCalendarsUseCase(realDeps()));
    const res = await app.request("/calendars/ranked");
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    // The whole point: NOT a fixture that agrees with the schema by construction.
    const parsed = rankedCalendarResponse.parse(body);
    expect(parsed.candidates.length).toBeGreaterThan(0);
    expect(parsed.totalCandidates).toBeGreaterThan(0);
    expect(parsed.spot).toBeCloseTo(SPOT, 6);
    expect(parsed.asOf).toBe(NOW.toISOString());

    // Every scored term the engine actually produced survives the seam, contributions and all.
    const top = parsed.candidates[0];
    expect(top).toBeDefined();
    if (top === undefined) return;
    const sum = top.breakdown.fwdEdge.contribution + top.breakdown.deltaBalance.contribution;
    expect(sum).toBeCloseTo(top.score, 6);
    expect(top.frontDte).toBeGreaterThanOrEqual(15);
    expect(top.gapDays).toBeGreaterThanOrEqual(15);
  });

  it("survives the null-honest path: no realized vol → null on the wire, ranking unchanged", async () => {
    // Realized vol is snapshot CONTEXT, not a score term. A contract that made it required would
    // throw here, on real data, having passed every hand-written fixture — and a ranking that
    // still moved when it vanished would mean it was quietly scoring something after all.
    const withRv = buildTestApp(makeRankCalendarsUseCase(realDeps()));
    const withoutRv = buildTestApp(
      makeRankCalendarsUseCase(realDeps({ readDailyCloses: () => Promise.resolve(ok([])) })),
    );
    const [a, b] = await Promise.all([
      withRv.request("/calendars/ranked"),
      withoutRv.request("/calendars/ranked"),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const parsedA = rankedCalendarResponse.parse(await a.json());
    const parsedB = rankedCalendarResponse.parse(await b.json());
    expect(parsedA.realizedVol).not.toBeNull();
    expect(parsedB.realizedVol).toBeNull();
    expect(parsedB.candidates.map((c) => c.score)).toEqual(parsedA.candidates.map((c) => c.score));
  });

  it("passes the request through to the engine: frontDteMax bounds the front leg", async () => {
    const app = buildTestApp(makeRankCalendarsUseCase(realDeps()));
    const res = await app.request("/calendars/ranked?frontDteMax=20&limit=3");
    const parsed = rankedCalendarResponse.parse(await res.json());
    expect(parsed.frontDteMax).toBe(20);
    expect(parsed.candidates.length).toBeLessThanOrEqual(3);
    expect(parsed.candidates.every((c) => c.frontDte <= 20)).toBe(true);
  });
});
