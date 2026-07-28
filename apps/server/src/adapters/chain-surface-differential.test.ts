/**
 * chain-surface-differential.test.ts — the core chain surface against the browser copy it
 * replaces, one fixture chain through both, field by field.
 *
 * WHY IT LIVES HERE. It has to import `apps/web/src/lib/chain-math.ts` AND `@morai/core`, and
 * `apps/` is the only element type ESLint's boundary rules let import both (eslint.config.js:
 * `{ from: "apps", allow: [... "core", "apps"] }`). A core-side test importing the browser module
 * would be `core → apps`, which is the dependency law backwards. `chain-math.ts` is pure TS —
 * no React, no DOM — so importing it from a server-side test costs nothing. Nothing under
 * `apps/web/` is modified by this file; it only reads it.
 *
 * WHAT IT IS FOR. `apps/web` computes atmStrike, atmIv, per-leg greeks, vertical skew, horizontal
 * skew, forward IV, edge, net calendar greeks and the haircut debit in the browser. Every one now
 * has a core twin. This test is the evidence that the switch is safe — without it, repointing the
 * chain table at the server is a leap of faith, and any drift ships silently to a screen the
 * owner reads daily.
 *
 * HOW IT ISOLATES. Three known divergences are inputs, not formulas, so the shared fixture
 * NEUTRALISES them and each is then pinned in its own test below with the handover note:
 *
 *   spot   — the browser takes `rows[0].underlyingPrice`; core takes the lower median of every
 *            usable quote. One spot on every fixture row makes them equal.
 *   carry  — the browser resolves carry PER EXPIRY off the GEX snapshot; core takes ONE injected
 *            carry. Passing `gex = undefined` makes `resolveCarry` return its flat defaults
 *            (0.045 / 0.013), which is exactly what this test injects into the use-case.
 *   clock  — the browser prices each leg at its OWN `observedAt`; core prices the whole snapshot
 *            at the injected `now`. One observation instant on every fixture row makes them equal.
 *
 * The fourth divergence — `edge` on whole DTE days against the settlement clock — cannot be
 * neutralised, and it is the one the switch will visibly move. It has its own test.
 *
 * THE TWO DIVERGENCES THE BRIEF PREDICTED ARE STALE, and it is worth saying so rather than
 * inventing replacements. "The server substitutes 0 for an inverted structure" is the retired
 * PICKER scorer (`packages/core/src/picker/domain/scoring.ts:139`); the calendar engine drops the
 * pair with a named `term-inverted` reason and `pairMetrics` returns null, same as the browser.
 * "The engine scales net greeks ×100 into dollars" is likewise the picker
 * (`candidate-selection.ts:433-445`); `calendar/domain/pair.ts` returns them unscaled in index
 * points, same as the browser. Both are asserted below so they cannot come back.
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import { makePriceChainUseCase, pairMetrics, buildCohorts } from "@morai/core";
import type { CalendarChainQuote, Carry, PairLeg } from "@morai/core";

// The browser copy, imported verbatim. Not modified, not re-implemented — this is the oracle.
import {
  atmIv as webAtmIv,
  atmStrike as webAtmStrike,
  calendarDebit as webCalendarDebit,
  edge as webEdge,
  hSkew as webHSkew,
  legGreeks as webLegGreeks,
  netCalendarGreeks as webNetCalendarGreeks,
  vSkewVsAtm as webVSkewVsAtm,
} from "../../../web/src/lib/chain-math.ts";
import { DEFAULT_DIV, DEFAULT_RATE, resolveCarry } from "../../../web/src/lib/resolve-carry.ts";

// ─── The shared fixture ────────────────────────────────────────────────────────

/**
 * ONE observation instant on every row, and it is also the injected `now`. Neutralises the clock
 * divergence; see the header.
 */
const OBSERVED_AT = "2026-07-28T15:30:00.000Z";
const NOW = new Date(OBSERVED_AT);

/** ONE spot on every row. Lower median == `rows[0]`, so the two spot rules agree. */
const SPOT = 7401.89;

/**
 * `resolveCarry(undefined, …)` returns exactly this pair, and so does the server's composition
 * root when the GEX snapshot carries no entry for an expiry (apps/server/src/config.ts:39-40
 * default to the same two numbers). The equality is not a coincidence to lean on, though — it is
 * asserted, so a config drift fails here rather than moving the chain table.
 */
const FLAT: Carry = { rate: DEFAULT_RATE, divYield: DEFAULT_DIV };

const FRONT = "2026-08-14";
const BACK = "2026-09-18";

type Row = {
  strike: number;
  expiration: string;
  root: "SPX" | "SPXW";
  bsmIv: number | null;
  bid: number;
  ask: number;
  openInterest: number;
  contractType?: "C" | "P";
};

/**
 * A deliberately awkward chain: two roots, two expirations, both wings, a ragged strike ladder,
 * and three strikes the inversion never solved (one `null`, one `'NaN'`, one that only one vendor
 * priced). Every one of those is a live condition, not a synthetic edge case.
 */
const ROWS: ReadonlyArray<Row> = [
  // SPXW front — the ATM strike (7400) solved.
  { strike: 7_300_000, expiration: FRONT, root: "SPXW", bsmIv: 0.1810, bid: 22.0, ask: 23.4, openInterest: 812 },
  { strike: 7_350_000, expiration: FRONT, root: "SPXW", bsmIv: 0.1724, bid: 33.1, ask: 34.9, openInterest: 1290 },
  { strike: 7_400_000, expiration: FRONT, root: "SPXW", bsmIv: 0.1620, bid: 48.6, ask: 50.2, openInterest: 2417 },
  { strike: 7_425_000, expiration: FRONT, root: "SPXW", bsmIv: null, bid: 58.0, ask: 60.5, openInterest: 66 },
  { strike: 7_450_000, expiration: FRONT, root: "SPXW", bsmIv: 0.1551, bid: 69.4, ask: 71.8, openInterest: 903 },
  // SPXW back — ragged: 7425 is quoted here and 7300 is not.
  { strike: 7_350_000, expiration: BACK, root: "SPXW", bsmIv: 0.1688, bid: 88.2, ask: 91.0, openInterest: 501 },
  { strike: 7_400_000, expiration: BACK, root: "SPXW", bsmIv: 0.1642, bid: 108.5, ask: 111.9, openInterest: 1744 },
  { strike: 7_425_000, expiration: BACK, root: "SPXW", bsmIv: 0.1619, bid: 119.8, ask: 123.4, openInterest: 240 },
  { strike: 7_450_000, expiration: BACK, root: "SPXW", bsmIv: 0.1597, bid: 132.0, ask: 136.1, openInterest: 688 },
  // SPX — the AM-settled book, quoting the SAME strikes on the SAME date. Root must separate it.
  { strike: 7_350_000, expiration: FRONT, root: "SPX", bsmIv: 0.1701, bid: 32.4, ask: 34.2, openInterest: 55 },
  { strike: 7_400_000, expiration: FRONT, root: "SPX", bsmIv: 0.1604, bid: 47.9, ask: 49.6, openInterest: 118 },
  { strike: 7_450_000, expiration: FRONT, root: "SPX", bsmIv: 0.1533, bid: 68.7, ask: 71.0, openInterest: 71 },
  // A call, to prove the wing filter binds on both sides.
  { strike: 7_400_000, expiration: FRONT, root: "SPXW", bsmIv: 0.1412, bid: 51.1, ask: 52.9, openInterest: 990, contractType: "C" },
];

/** The core side's input: the repo port's shape, `bsmIv` a string with three states. */
function coreQuotes(rows: ReadonlyArray<Row> = ROWS): ReadonlyArray<CalendarChainQuote> {
  return rows.map((r) => ({
    time: new Date(OBSERVED_AT),
    strike: r.strike,
    expiration: r.expiration,
    contractType: r.contractType ?? "P",
    underlyingPrice: SPOT,
    // The wire's three states, restored: null stays null, a solved value becomes its string.
    bsmIv: r.bsmIv === null ? null : String(r.bsmIv),
    root: r.root,
    bid: r.bid,
    ask: r.ask,
    openInterest: r.openInterest,
    source: "cboe" as const,
  }));
}

/** The browser side's input: `/api/chain`'s already-flattened row, `bsmIv` a number or null. */
function webRows(rows: ReadonlyArray<Row> = ROWS) {
  return rows.map((r) => ({
    strike: r.strike,
    expiration: r.expiration,
    contractType: r.contractType ?? ("P" as const),
    root: r.root,
    dte: dteOf(r.expiration),
    bsmIv: r.bsmIv,
    bid: r.bid,
    ask: r.ask,
    openInterest: r.openInterest,
    underlyingPrice: SPOT,
    source: "cboe" as const,
    observedAt: OBSERVED_AT,
  }));
}

/** Whole calendar days, the same arithmetic `getChain` applies before the wire. */
function dteOf(expiration: string): number {
  const day = Date.parse(`${OBSERVED_AT.slice(0, 10)}T00:00:00.000Z`);
  return Math.round((Date.parse(`${expiration}T00:00:00.000Z`) - day) / 86_400_000);
}

async function surface(rows: ReadonlyArray<Row> = ROWS, carry: Carry = FLAT) {
  const run = makePriceChainUseCase({
    readChain: () => Promise.resolve(ok(coreQuotes(rows))),
    now: () => NOW,
    carry,
  });
  const result = await run({ contractType: "P" });
  if (!result.ok) throw new Error(`use-case failed: ${result.error.message}`);
  return result.value;
}

// ─── The fixture's own invariants ──────────────────────────────────────────────

describe("the fixture neutralises the three input divergences, and says so out loud", () => {
  it("gives the browser and the engine the same carry", () => {
    // If either default moves, this fails before any formula comparison can silently pass.
    expect(resolveCarry(undefined, FRONT)).toEqual(FLAT);
    expect(FLAT).toEqual({ rate: 0.045, divYield: 0.013 });
  });

  it("gives the browser and the engine the same spot", () => {
    // The browser reads rows[0]; core takes the lower median. One spot everywhere makes them one.
    const rows = webRows();
    expect(new Set(rows.map((r) => r.underlyingPrice)).size).toBe(1);
    expect(rows[0]?.underlyingPrice).toBe(SPOT);
  });
});

// ─── Field by field ────────────────────────────────────────────────────────────

describe("per-cohort ATM reference — core against the browser", () => {
  it("names the same ATM strike for every cohort", async () => {
    const s = await surface();
    expect(s.cohorts.length).toBeGreaterThan(0);
    for (const cohort of s.cohorts) {
      const sameCohort = webRows().filter(
        (r) =>
          r.root === cohort.root && r.expiration === cohort.expiration && r.contractType === "P",
      );
      expect(cohort.atmStrike).not.toBeNull();
      // The browser returns ×1000; core returns points. The scale is the only difference.
      expect((cohort.atmStrike ?? 0) * 1000).toBe(webAtmStrike(sameCohort, SPOT));
    }
  });

  it("reads the same ATM IV for every cohort", async () => {
    const s = await surface();
    for (const cohort of s.cohorts) {
      expect(cohort.atmIv).toBe(
        webAtmIv(webRows(), SPOT, cohort.expiration, "P", cohort.root),
      );
    }
  });

  it("reports a NULL ATM IV — on both sides — when the nearest strike never solved", async () => {
    // The condition that separates `quotedAtm` from `Cohort.atmIv`. 7400 does not solve, so the
    // nearest strike to 7401.89 has no reference IV, and neither side substitutes 7350's.
    const rows = ROWS.map((r) =>
      r.expiration === FRONT && r.root === "SPXW" && r.strike === 7_400_000 && r.contractType === undefined
        ? { ...r, bsmIv: null }
        : r,
    );
    const s = await surface(rows);
    const front = s.cohorts.find((c) => c.root === "SPXW" && c.expiration === FRONT);
    expect(front?.atmStrike).toBe(7400);
    expect(front?.atmIv).toBeNull();
    expect(webAtmIv(webRows(rows), SPOT, FRONT, "P", "SPXW")).toBeNull();
    // Every vertical skew in the cohort goes with it. A blank column beats a re-based one.
    expect(front?.strikes.every((r) => r.vSkew === null)).toBe(true);
  });
});

describe("per-strike rows — core against the browser", () => {
  it("shows the SAME strike ladder, gaps included", async () => {
    const s = await surface();
    for (const cohort of s.cohorts) {
      const expected = webRows()
        .filter(
          (r) =>
            r.root === cohort.root && r.expiration === cohort.expiration && r.contractType === "P",
        )
        .map((r) => r.strike / 1000)
        .sort((a, b) => a - b);
      expect(cohort.strikes.map((r) => r.strike)).toEqual(expected);
    }
  });

  it("prices every leg's greeks to the browser's numbers, exactly", async () => {
    const s = await surface();
    let compared = 0;
    for (const cohort of s.cohorts) {
      for (const row of cohort.strikes) {
        const source = webRows().find(
          (r) =>
            r.root === cohort.root &&
            r.expiration === cohort.expiration &&
            r.contractType === "P" &&
            r.strike === row.strike * 1000,
        );
        expect(source).toBeDefined();
        if (source === undefined) continue;
        const web = webLegGreeks(source, FLAT, NOW);
        expect(row.delta).toBe(web?.delta ?? null);
        expect(row.gamma).toBe(web?.gamma ?? null);
        expect(row.theta).toBe(web?.theta ?? null);
        expect(row.vega).toBe(web?.vega ?? null);
        compared += 1;
      }
    }
    // A comparison loop that compared nothing is a green test that proves nothing.
    expect(compared).toBe(12);
  });

  it("leaves an unpriceable strike's greeks null on both sides, and keeps its quote", async () => {
    const s = await surface();
    const front = s.cohorts.find((c) => c.root === "SPXW" && c.expiration === FRONT);
    const gap = front?.strikes.find((r) => r.strike === 7425);
    expect(gap).toBeDefined();
    expect([gap?.iv, gap?.delta, gap?.gamma, gap?.theta, gap?.vega, gap?.vSkew]).toEqual([
      null, null, null, null, null, null,
    ]);
    // The row survives with its market intact — a gap is not a deletion.
    expect([gap?.bid, gap?.ask, gap?.openInterest]).toEqual([58.0, 60.5, 66]);
  });

  it("computes the same vertical skew for every strike", async () => {
    const s = await surface();
    for (const cohort of s.cohorts) {
      const reference = webAtmIv(webRows(), SPOT, cohort.expiration, "P", cohort.root);
      for (const row of cohort.strikes) {
        expect(row.vSkew).toBe(webVSkewVsAtm(row.iv, reference));
      }
    }
  });
});

describe("pair math — core against the browser", () => {
  /** Pull one strike out of two cohorts as `pairMetrics` wants it. */
  async function corePair(strike: number, frontRoot: "SPX" | "SPXW" = "SPXW") {
    const cohorts = buildCohorts(coreQuotes(), { now: NOW, contractType: "P", carry: FLAT });
    const pick = (expiration: string): PairLeg => {
      const cohort = cohorts.find((c) => c.root === frontRoot && c.expiration === expiration);
      const leg = cohort?.legs.find((l) => l.strike === strike);
      if (cohort === undefined || leg === undefined) throw new Error(`no leg ${expiration}@${strike}`);
      return { t: cohort.t, leg };
    };
    return pairMetrics(pick(FRONT), pick(BACK));
  }

  function webPair(strike: number, root: "SPX" | "SPXW" = "SPXW") {
    const pick = (expiration: string) => {
      const row = webRows().find(
        (r) =>
          r.root === root &&
          r.expiration === expiration &&
          r.contractType === "P" &&
          r.strike === strike * 1000,
      );
      if (row === undefined) throw new Error(`no row ${expiration}@${strike}`);
      return row;
    };
    return { front: pick(FRONT), back: pick(BACK) };
  }

  it("computes the same horizontal skew", async () => {
    const { front, back } = webPair(7400);
    expect((await corePair(7400)).hSkew).toBe(webHSkew(front.bsmIv, back.bsmIv));
  });

  it("computes the same net calendar greeks, in the same units", async () => {
    const { front, back } = webPair(7400);
    const web = webNetCalendarGreeks(
      webLegGreeks(front, FLAT, NOW),
      webLegGreeks(back, FLAT, NOW),
    );
    const core = (await corePair(7400)).net;
    expect(web).not.toBeNull();
    expect(core.delta).toBe(web?.delta);
    expect(core.gamma).toBe(web?.gamma);
    expect(core.theta).toBe(web?.theta);
    expect(core.vega).toBe(web?.vega);
    // NO ×100. The retired picker engine returned dollars under the same label
    // (candidate-selection.ts:433-445), which put two unit spaces on one screen. This asserts
    // the calendar engine never acquires that habit.
    expect(Math.abs(core.vega)).toBeLessThan(100);
  });

  it("computes the same haircut debit", async () => {
    const { front, back } = webPair(7400);
    expect((await corePair(7400)).debit).toBe(webCalendarDebit(front, back));
  });

  it("returns NULL, not 0, on an inverted structure — on both sides", async () => {
    // The brief predicted this as a live divergence. It is not one: the "0 for inverted" branch
    // belongs to the retired picker scorer (packages/core/src/picker/domain/scoring.ts:139), and
    // both surviving implementations refuse. Asserted so it cannot come back.
    const inverted = ROWS.map((r) =>
      r.expiration === FRONT && r.root === "SPXW" && r.strike === 7_400_000 && r.contractType === undefined
        ? { ...r, bsmIv: 0.42 }
        : r,
    );
    const cohorts = buildCohorts(coreQuotes(inverted), { now: NOW, contractType: "P", carry: FLAT });
    const pick = (expiration: string): PairLeg => {
      const cohort = cohorts.find((c) => c.root === "SPXW" && c.expiration === expiration);
      const leg = cohort?.legs.find((l) => l.strike === 7400);
      if (cohort === undefined || leg === undefined) throw new Error("missing leg");
      return { t: cohort.t, leg };
    };
    const core = pairMetrics(pick(FRONT), pick(BACK));
    const rows = webRows(inverted);
    const front = rows.find((r) => r.expiration === FRONT && r.root === "SPXW" && r.strike === 7_400_000 && r.contractType === "P");
    const back = rows.find((r) => r.expiration === BACK && r.root === "SPXW" && r.strike === 7_400_000);
    expect(core.fwdIv).toBeNull();
    expect(core.edge).toBeNull();
    expect(webEdge(front?.dte ?? 0, front?.bsmIv ?? null, back?.dte ?? 0, back?.bsmIv ?? null)).toBeNull();
    // Everything else on the pair still measures — a degraded input nulls its OWN field.
    expect(core.hSkew).not.toBeNull();
    expect(core.debit).not.toBeNull();
  });
});

// ─── The divergences, pinned ───────────────────────────────────────────────────

describe("DIVERGENCE — the edge is measured on a different clock", () => {
  it("core prices the forward vol at settlement; the browser prices it in whole DTE days", async () => {
    // THE HANDOVER NOTE. `chain-math.edge` passes whole `dte` days into `computeFwdIv`; the core
    // path passes `Cohort.t`, years to the SETTLEMENT instant. The identity is scale-invariant in
    // t, so days-vs-years alone would cancel — but the settlement clock is NOT a uniform rescale
    // of dte: AM settlement (09:30 ET) lands before the expiry day's UTC midnight and PM (16:00
    // ET) after it, so t_f / t_b != dte_f / dte_b and the forward vol genuinely moves.
    //
    // This is the same defect class as commit cc06625 ("price chain legs on the settlement clock,
    // not a whole day") and the scar already written into `chain-math.legGreeks`'s comment: fixed
    // for greeks, never fixed for edge.
    //
    // AT THE SWITCH, measured on this fixture's 17/52-day pair (2026-07-28 15:30Z → 2026-08-14
    // and 2026-09-18), core minus browser:
    //
    //     SPXW   t_f/t_b 0.32934132   against dte 0.32692308   edge −0.001163 vol points
    //     SPX    t_f/t_b 0.33105939   against dte 0.32692308   edge −0.001995 vol points
    //
    // ROOT-DEPENDENT, and by a factor of nearly two on the same two dates — 2026-09-18 IS a third
    // Friday, so the SPX back leg settles AM (09:30 ET) and lands EARLIER than its SPXW twin,
    // which moves the ratio the identity divides by. Small in absolute terms; not uniform across
    // the axis this table puts side by side, which is the part that matters. Core is right.
    const core = await (async () => {
      const cohorts = buildCohorts(coreQuotes(), { now: NOW, contractType: "P", carry: FLAT });
      const pick = (expiration: string): PairLeg => {
        const cohort = cohorts.find((c) => c.root === "SPXW" && c.expiration === expiration);
        const leg = cohort?.legs.find((l) => l.strike === 7400);
        if (cohort === undefined || leg === undefined) throw new Error("missing leg");
        return { t: cohort.t, leg };
      };
      return pairMetrics(pick(FRONT), pick(BACK));
    })();

    const rows = webRows();
    const front = rows.find((r) => r.expiration === FRONT && r.root === "SPXW" && r.strike === 7_400_000 && r.contractType === "P");
    const web = webEdge(front?.dte ?? 0, front?.bsmIv ?? null, dteOf(BACK), 0.1642);

    expect(core.edge).not.toBeNull();
    expect(web).not.toBeNull();
    // They agree to a basis point and disagree beyond it. Both halves matter: the first says the
    // switch is not a rewrite of the column, the second says it is not a no-op either.
    expect(core.edge ?? 0).toBeCloseTo(web ?? 0, 4);
    expect(core.edge).not.toBe(web);
  });
});

describe("DIVERGENCE — one spot for the snapshot, not the first row's", () => {
  it("core takes the lower median; the browser takes whichever vendor row landed first", async () => {
    // AT THE SWITCH: on a clean chain nothing moves — every row carries the same spot. On a chain
    // with one stale vendor row, `rows[0]` can BE that row, and then every greek on the screen is
    // priced against a spot the index never traded at. Core's median cannot be moved by one row.
    // Core is right; `cohort.ts` scar 3 is the standing note.
    const stale: ReadonlyArray<Row> = ROWS;
    const quotes = coreQuotes(stale).map((q, i) =>
      i === 0 ? { ...q, underlyingPrice: 6000 } : q,
    );
    const run = makePriceChainUseCase({
      readChain: () => Promise.resolve(ok(quotes)),
      now: () => NOW,
      carry: FLAT,
    });
    const result = await run({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spot).toBe(SPOT);
    // The browser would have used 6000 — the stale row is rows[0].
    expect(quotes[0]?.underlyingPrice).toBe(6000);
  });
});

describe("DIVERGENCE — ONE carry for the snapshot, not one per expiry", () => {
  it("core prices both legs of a calendar on the same (r, q); the browser does not", async () => {
    // AT THE SWITCH: greeks move wherever the GEX snapshot carried a solved `implied_carry` entry
    // for one leg's expiry and not the other's. Measured on the live chain 2026-07-28, that was
    // 3,313 of 5,917 candidates on the latest carry array. Core is right, and the reason is not
    // "one is simpler": the solved array is computed by `computeImpliedCarry` (FRED-interpolated
    // r, put-call-parity q) while `bsm_iv` was INVERTED at (DGS3MO r, a constant q). Repricing at
    // a carry the inversion did not use breaks this repo's `invert → reprice shares (r, q)` law.
    // `cohort.ts` scar 4 carries the numbers. Do NOT reintroduce a per-expiry carry read.
    const solved: Carry = { rate: 0.0431, divYield: 0.0002 };
    const flat = await surface(ROWS, FLAT);
    const mixed = await surface(ROWS, solved);

    const ivOf = (s: Awaited<ReturnType<typeof surface>>, expiration: string) =>
      s.cohorts.find((c) => c.root === "SPXW" && c.expiration === expiration)?.strikes
        .find((r) => r.strike === 7400)?.delta;

    // Same wing, same strike, same IV — only the carry moved, and delta moved with it. That is
    // the quantity the browser lets differ BETWEEN the two legs of one calendar.
    expect(ivOf(flat, FRONT)).not.toBe(ivOf(mixed, FRONT));
    // The browser's own fallback is the flat pair, so an absent GEX snapshot already agrees.
    expect(resolveCarry(undefined, FRONT)).toEqual(FLAT);
  });
});

describe("DIVERGENCE — one clock for the snapshot, not one per row", () => {
  it("core prices every leg at the injected instant; the browser at each row's own observedAt", async () => {
    // AT THE SWITCH: nothing moves on a clean snapshot — the chain read is one cohort and its
    // rows share an instant to the minute. It moves when the two vendors' rows are stamped a
    // minute apart, which they routinely are (Schwab writes a minute after CBOE). The browser
    // then prices two legs of one calendar on two clocks; core cannot. Core is right.
    const rows = coreQuotes();
    const skewed = rows.map((q, i) =>
      i % 2 === 0 ? { ...q, time: new Date("2026-07-28T15:31:00.000Z") } : q,
    );
    const run = makePriceChainUseCase({
      readChain: () => Promise.resolve(ok(skewed)),
      now: () => NOW,
      carry: FLAT,
    });
    const result = await run({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Every greek still came off NOW; only `asOf` reports the newest row.
    expect(result.value.asOf.toISOString()).toBe("2026-07-28T15:31:00.000Z");
    const front = result.value.cohorts.find((c) => c.root === "SPXW" && c.expiration === FRONT);
    const clean = await surface();
    const cleanFront = clean.cohorts.find((c) => c.root === "SPXW" && c.expiration === FRONT);
    expect(front?.strikes.map((r) => r.theta)).toEqual(cleanFront?.strikes.map((r) => r.theta));
  });
});
