/**
 * Picker contract tests (Phase 18, D-01).
 *
 * pickerCandidate/pickerSnapshotResponse is the single Zod schema source for both the
 * Phase-19 GET /api/picker/candidates response and the get_picker_candidates MCP tool
 * (MCP-02). Oracle values ported from mockups/playground-v4.html's real buildCandidates()
 * output over the 2026-07-01 chain snapshot (D-03).
 */

import { describe, it, expect } from "vitest";
import {
  breakdownEntry,
  pickerCandidate,
  pickerSnapshotResponse,
  analyzeAdHocCalendarRequest,
  analyzeAdHocCalendarResponse,
} from "./picker.ts";
import { pickerSnapshotFixture } from "./__fixtures__/picker-candidates.fixture.ts";

// Oracle payload — one real candidate from mockups/playground-v4.html buildCandidates()
// OUTPUT (top-scored: 7500P Jul 23 / Aug 14, score 47).
const oraclePayload = {
  id: "7500-260723-260814",
  name: "7500P Jul 23 / Aug 14",
  score: 47,
  breakdown: [
    { criterion: "slope", weight: 40, rawValue: 0.253841, contribution: 42.31 },
    { criterion: "fwdEdge", weight: 25, rawValue: -0.028487, contribution: 0 },
    { criterion: "gexFit", weight: 15, rawValue: 1, contribution: 100 },
    { criterion: "eventAdjustment", weight: 10, rawValue: 0.5, contribution: 50 },
    { criterion: "beVsEm", weight: 10, rawValue: 0.5329, contribution: 53.29 },
  ],
  debit: 4627.55,
  theta: 45.896,
  vega: 305.343,
  delta: 1.198,
  fwdIv: 0.153387,
  fwdIvGuard: "ok",
  slope: 0.253841,
  fwdEdge: -0.028487,
  expectedMove: 224.657,
  frontEvents: ["NFP", "CPI"],
  backEvents: ["FOMC"],
  frontLeg: { strike: 7500, putCall: "P", dte: 21, iv: 0.1249 },
  backLeg: { strike: 7500, putCall: "P", dte: 43, iv: 0.1402 },
  exitPlan: {
    profitTargetPct: 0.25,
    stopPct: 0.175,
    manageShortDte: 21,
    closeByExpiry: "2026-07-23",
  },
};

describe("pickerCandidate", () => {
  it("parses the oracle payload (7500P Jul 23 / Aug 14, score 47)", () => {
    expect(() => pickerCandidate.parse(oraclePayload)).not.toThrow();
  });

  it("REJECTS a malformed breakdown entry with an out-of-enum criterion", () => {
    const malformed = {
      ...oraclePayload,
      breakdown: [
        { criterion: "ivRankGate", weight: 40, rawValue: 0.5, contribution: 50 },
        ...oraclePayload.breakdown.slice(1),
      ],
    };
    expect(() => pickerCandidate.parse(malformed)).toThrow();
  });

  it("REJECTS a breakdown entry missing a required numeric field", () => {
    const malformed = {
      ...oraclePayload,
      breakdown: [
        { criterion: "slope", weight: 40, contribution: 42.31 }, // rawValue missing
        ...oraclePayload.breakdown.slice(1),
      ],
    };
    expect(() => pickerCandidate.parse(malformed)).toThrow();
  });

  it("parses a guard-case candidate (fwdIv: null, fwdIvGuard: 'inverted') clean", () => {
    const guardPayload = { ...oraclePayload, fwdIv: null, fwdIvGuard: "inverted", fwdEdge: 0 };
    expect(() => pickerCandidate.parse(guardPayload)).not.toThrow();
  });
});

describe("breakdownEntry.criterion (closed enum, structurally excludes REFUTED criteria)", () => {
  const base = { weight: 10, rawValue: 0.5, contribution: 50 };

  it.each(["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm"] as const)(
    "accepts criterion '%s'",
    (criterion) => {
      expect(() => breakdownEntry.parse({ ...base, criterion })).not.toThrow();
    },
  );

  it("rejects a REFUTED criterion (e.g. ivRankGate) — not in the closed enum", () => {
    expect(() => breakdownEntry.parse({ ...base, criterion: "ivRankGate" })).toThrow();
  });

  it("rejects any other out-of-enum criterion string", () => {
    expect(() => breakdownEntry.parse({ ...base, criterion: "ivDiffBand" })).toThrow();
  });
});

describe("pickerSnapshotFixture (frozen fixture — D-03)", () => {
  it("parses the frozen pickerSnapshotFixture clean", () => {
    expect(() => pickerSnapshotResponse.parse(pickerSnapshotFixture)).not.toThrow();
  });

  it("carries an asOf reference date the DTE fields are relative to (WR-03)", () => {
    expect(typeof pickerSnapshotFixture.asOf).toBe("string");
  });

  it("REJECTS a snapshot missing asOf (the DTE/event x-axis needs a reference date — WR-03)", () => {
    const { asOf: _omit, ...withoutAsOf } = pickerSnapshotFixture;
    expect(() => pickerSnapshotResponse.parse(withoutAsOf)).toThrow();
  });

  it("contains exactly ONE guard-case candidate (fwdIv null + fwdIvGuard 'inverted')", () => {
    const guardCandidates = pickerSnapshotFixture.candidates.filter(
      (c) => c.fwdIv === null && c.fwdIvGuard === "inverted",
    );
    expect(guardCandidates).toHaveLength(1);
  });

  it("every non-guard candidate has fwdIv !== null and fwdIvGuard === 'ok'", () => {
    const nonGuard = pickerSnapshotFixture.candidates.filter((c) => c.fwdIvGuard !== "inverted");
    expect(nonGuard.every((c) => c.fwdIv !== null && c.fwdIvGuard === "ok")).toBe(true);
  });

  it("the guard-case candidate's expectedMove/theta/vega/score are all finite non-null numbers (Pitfall 3)", () => {
    const guard = pickerSnapshotFixture.candidates.find((c) => c.fwdIvGuard === "inverted");
    expect(guard).toBeDefined();
    expect(Number.isFinite(guard?.expectedMove)).toBe(true);
    expect(Number.isFinite(guard?.theta)).toBe(true);
    expect(Number.isFinite(guard?.vega)).toBe(true);
    expect(Number.isFinite(guard?.score)).toBe(true);
  });

  it("every candidate's breakdown array contains all five criteria exactly once", () => {
    const allCriteria = ["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm"].sort();
    for (const candidate of pickerSnapshotFixture.candidates) {
      const criteria = candidate.breakdown.map((entry) => entry.criterion).sort();
      expect(criteria).toEqual(allCriteria);
    }
  });

  it("has between 6 and 8 non-guard candidates plus exactly 1 guard-case candidate", () => {
    const nonGuardCount = pickerSnapshotFixture.candidates.filter(
      (c) => c.fwdIvGuard !== "inverted",
    ).length;
    const guardCount = pickerSnapshotFixture.candidates.filter(
      (c) => c.fwdIvGuard === "inverted",
    ).length;
    expect(nonGuardCount).toBeGreaterThanOrEqual(6);
    expect(nonGuardCount).toBeLessThanOrEqual(8);
    expect(guardCount).toBe(1);
  });
});

describe("pickerSnapshotResponse.observedAt (WR-03 — real instant, not date-only asOf)", () => {
  const basePayload = {
    asOf: "2026-07-02",
    observedAt: "2026-07-02T14:32:00.000Z",
    spot: 7498.85,
    source: "schwab",
    gexContextStatus: "ok",
    eventsContextStatus: "ok",
    termStructure: [],
    gex: { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null },
    events: [],
    candidates: [],
  };

  it("parses a payload carrying a full-ISO observedAt instant", () => {
    expect(() => pickerSnapshotResponse.parse(basePayload)).not.toThrow();
  });

  it("REJECTS a snapshot missing observedAt (the freshness dot needs the real instant, not date-only asOf)", () => {
    const { observedAt: _omit, ...withoutObservedAt } = basePayload;
    expect(() => pickerSnapshotResponse.parse(withoutObservedAt)).toThrow();
  });

  it("REJECTS a date-only observedAt (must be a full ISO datetime, not YYYY-MM-DD)", () => {
    expect(() =>
      pickerSnapshotResponse.parse({ ...basePayload, observedAt: "2026-07-02" }),
    ).toThrow();
  });
});

describe("pickerSnapshotResponse.gate (28-03, PLAY-01/PLAY-02 — additive)", () => {
  const basePayload = {
    asOf: "2026-07-02",
    observedAt: "2026-07-02T14:32:00.000Z",
    spot: 7498.85,
    source: "schwab",
    gexContextStatus: "ok",
    eventsContextStatus: "ok",
    termStructure: [],
    gex: { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null },
    events: [],
    candidates: [],
  };

  it("a stored snapshot MISSING gate parses to the defaulted gate (no schema break)", () => {
    const parsed = pickerSnapshotResponse.parse(basePayload);
    expect(parsed.gate).toEqual({
      vix: null,
      vix3m: null,
      ratio: null,
      asOf: null,
      state: "open",
      penaltyMultiplier: 1,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
      reasons: [],
    });
  });

  it("a full gate object round-trips through pickerSnapshotResponse", () => {
    const fullGate = {
      vix: 27.4,
      vix3m: 24.1,
      ratio: 1.137,
      asOf: "2026-07-08",
      state: "blocked",
      penaltyMultiplier: 0,
      brakes: { maxOpen: true, cooldown: false, cooldownUntil: null },
      reasons: ["vixBlocked"],
    };
    const parsed = pickerSnapshotResponse.parse({ ...basePayload, gate: fullGate });
    expect(parsed.gate).toEqual(fullGate);
  });

  it("REJECTS an out-of-enum gate.state value", () => {
    const badGate = {
      vix: 20,
      vix3m: 20,
      ratio: 1,
      asOf: "2026-07-08",
      state: "crisis", // not a valid state
      penaltyMultiplier: 0.5,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
    };
    expect(() => pickerSnapshotResponse.parse({ ...basePayload, gate: badGate })).toThrow();
  });
});

describe("pickerSnapshotResponse.source / gexContextStatus / eventsContextStatus (Phase 19, D-15/D-17)", () => {
  const basePayload = {
    asOf: "2026-07-02",
    observedAt: "2026-07-02T14:32:00.000Z",
    spot: 7498.85,
    source: "schwab",
    gexContextStatus: "ok",
    eventsContextStatus: "ok",
    termStructure: [],
    gex: { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null },
    events: [],
    candidates: [],
  };

  it("parses a payload carrying source/gexContextStatus/eventsContextStatus", () => {
    expect(() => pickerSnapshotResponse.parse(basePayload)).not.toThrow();
  });

  it("REJECTS a payload missing source", () => {
    const { source: _omit, ...withoutSource } = basePayload;
    expect(() => pickerSnapshotResponse.parse(withoutSource)).toThrow();
  });

  it("REJECTS a payload missing gexContextStatus", () => {
    const { gexContextStatus: _omit, ...withoutGexStatus } = basePayload;
    expect(() => pickerSnapshotResponse.parse(withoutGexStatus)).toThrow();
  });

  it("REJECTS a payload missing eventsContextStatus", () => {
    const { eventsContextStatus: _omit, ...withoutEventsStatus } = basePayload;
    expect(() => pickerSnapshotResponse.parse(withoutEventsStatus)).toThrow();
  });

  it("REJECTS an out-of-enum source value", () => {
    expect(() =>
      pickerSnapshotResponse.parse({ ...basePayload, source: "vendor" }),
    ).toThrow();
  });

  it("REJECTS an out-of-enum gexContextStatus value", () => {
    expect(() =>
      pickerSnapshotResponse.parse({ ...basePayload, gexContextStatus: "fresh" }),
    ).toThrow();
  });

  it("REJECTS an out-of-enum eventsContextStatus value", () => {
    expect(() =>
      pickerSnapshotResponse.parse({ ...basePayload, eventsContextStatus: "fresh" }),
    ).toThrow();
  });
});

describe("pickerCandidate.bucket (28-05, PLAY-04 event-calendar bucket — additive)", () => {
  it("defaults to 'standard' when absent -- old stored rows (pre-Plan-05) still parse", () => {
    const parsed = pickerCandidate.parse(oraclePayload);
    expect(parsed.bucket).toBe("standard");
  });

  it("round-trips an explicit 'event-calendar' bucket tag", () => {
    const parsed = pickerCandidate.parse({ ...oraclePayload, bucket: "event-calendar" });
    expect(parsed.bucket).toBe("event-calendar");
  });

  it("rejects an out-of-enum bucket value", () => {
    expect(() => pickerCandidate.parse({ ...oraclePayload, bucket: "premium" })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// analyzeAdHocCalendarRequest/Response (Phase 30, D-02, MCP-02 additive) — the shared
// POST /picker/analyze route + MCP tool schema. Puts-only (D-03), NO client-supplied
// spot (threat mitigation — server derives it from the latest snapshot).
// ─────────────────────────────────────────────────────────────

describe("analyzeAdHocCalendarRequest", () => {
  const validBody = {
    putCall: "P",
    strike: 7500,
    frontDte: 7,
    backDte: 35,
    qty: 1,
    frontIv: 0.15,
    backIv: 0.15,
    debit: 12.5,
    frontExpiry: "2026-07-17",
    backExpiry: "2026-08-14",
  };

  it("parses a valid PUT ad-hoc calendar body", () => {
    expect(() => analyzeAdHocCalendarRequest.parse(validBody)).not.toThrow();
  });

  it("rejects putCall 'C' (puts only, D-03)", () => {
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, putCall: "C" })).toThrow();
  });

  it("rejects strike <= 0", () => {
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, strike: 0 })).toThrow();
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, strike: -7500 })).toThrow();
  });

  it("rejects non-finite frontIv/backIv", () => {
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, frontIv: Infinity })).toThrow();
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, backIv: Number.NaN })).toThrow();
  });

  it("rejects non-finite debit", () => {
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, debit: Infinity })).toThrow();
  });

  it("rejects frontDte/backDte non-integer or <= 0", () => {
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, frontDte: 7.5 })).toThrow();
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, frontDte: 0 })).toThrow();
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, backDte: -5 })).toThrow();
  });

  it("rejects backDte <= frontDte", () => {
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, frontDte: 35, backDte: 35 })).toThrow();
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, frontDte: 35, backDte: 7 })).toThrow();
  });

  it("rejects an extra 'spot' key (.strict() — never trust a client-supplied spot)", () => {
    expect(() => analyzeAdHocCalendarRequest.parse({ ...validBody, spot: 7500 })).toThrow();
  });
});

describe("analyzeAdHocCalendarResponse", () => {
  it("parses a scored response ({scored:true, candidate:<valid pickerCandidate>, reason:null})", () => {
    expect(() =>
      analyzeAdHocCalendarResponse.parse({ scored: true, candidate: oraclePayload, reason: null }),
    ).not.toThrow();
  });

  it("parses an unscored response ({scored:false, candidate:null, reason:'no-snapshot'})", () => {
    expect(() =>
      analyzeAdHocCalendarResponse.parse({ scored: false, candidate: null, reason: "no-snapshot" }),
    ).not.toThrow();
  });
});
