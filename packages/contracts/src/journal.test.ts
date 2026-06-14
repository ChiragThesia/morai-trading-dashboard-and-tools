import { describe, it, expect } from "vitest";
import { snapshotResponse, journalResponse } from "./journal.ts";
import { termStructureResponse, skewResponse } from "./analytics.ts";

describe("snapshotResponse", () => {
  const validSnapshot = {
    time: "2026-06-14T15:00:00.000Z",
    calendarId: "550e8400-e29b-41d4-a716-446655440001",
    spot: "7274.14",
    netMark: "12.5",
    frontMark: "25.4",
    backMark: "37.9",
    frontIv: "NaN",
    backIv: "0.2341",
    frontIvRaw: "NaN",
    backIvRaw: "0.1818",
    netDelta: "NaN",
    netGamma: "NaN",
    netTheta: "NaN",
    netVega: "NaN",
    termSlope: "NaN",
    dteFront: 7,
    dteBack: 97,
    pnlOpen: "-450",
    source: "cboe" as const,
  };

  it("accepts a full snapshot row including frontIv:'NaN'", () => {
    expect(() => snapshotResponse.parse(validSnapshot)).not.toThrow();
    const parsed = snapshotResponse.parse(validSnapshot);
    expect(parsed.frontIv).toBe("NaN");
    expect(parsed.calendarId).toBe("550e8400-e29b-41d4-a716-446655440001");
  });

  it("rejects a row missing pnlOpen", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pnlOpen: _, ...withoutPnlOpen } = validSnapshot;
    expect(() => snapshotResponse.parse(withoutPnlOpen)).toThrow();
  });

  it("rejects a row with invalid source", () => {
    const bad = { ...validSnapshot, source: "invalid-source" };
    expect(() => snapshotResponse.parse(bad)).toThrow();
  });

  it("rejects a row with non-integer dteFront", () => {
    const bad = { ...validSnapshot, dteFront: 7.5 };
    expect(() => snapshotResponse.parse(bad)).toThrow();
  });

  it("rejects a row with non-UUID calendarId", () => {
    const bad = { ...validSnapshot, calendarId: "not-a-uuid" };
    expect(() => snapshotResponse.parse(bad)).toThrow();
  });

  it("accepts source:'schwab_chain' and source:'computed_only'", () => {
    const s1 = { ...validSnapshot, source: "schwab_chain" as const };
    const s2 = { ...validSnapshot, source: "computed_only" as const };
    expect(() => snapshotResponse.parse(s1)).not.toThrow();
    expect(() => snapshotResponse.parse(s2)).not.toThrow();
  });
});

describe("journalResponse", () => {
  it("accepts { snapshots: [] } (empty array)", () => {
    expect(() => journalResponse.parse({ snapshots: [] })).not.toThrow();
    const parsed = journalResponse.parse({ snapshots: [] });
    expect(parsed.snapshots).toHaveLength(0);
  });

  it("accepts { snapshots: [snapshot] } with a valid snapshot", () => {
    const snapshot = {
      time: "2026-06-14T15:00:00.000Z",
      calendarId: "550e8400-e29b-41d4-a716-446655440001",
      spot: "7274.14",
      netMark: "12.5",
      frontMark: "25.4",
      backMark: "37.9",
      frontIv: "0.25",
      backIv: "0.2341",
      frontIvRaw: "0.26",
      backIvRaw: "0.1818",
      netDelta: "-0.05",
      netGamma: "0.001",
      netTheta: "-12.3",
      netVega: "4.5",
      termSlope: "-0.016",
      dteFront: 7,
      dteBack: 97,
      pnlOpen: "-450",
      source: "cboe" as const,
    };
    expect(() => journalResponse.parse({ snapshots: [snapshot] })).not.toThrow();
    const parsed = journalResponse.parse({ snapshots: [snapshot] });
    expect(parsed.snapshots).toHaveLength(1);
  });

  it("rejects a missing snapshots field", () => {
    expect(() => journalResponse.parse({})).toThrow();
  });
});

describe("termStructureResponse", () => {
  it("accepts { observations: [] }", () => {
    expect(() => termStructureResponse.parse({ observations: [] })).not.toThrow();
  });

  it("accepts { observations: [anything] }", () => {
    const parsed = termStructureResponse.parse({ observations: [{ x: 1 }, { y: "foo" }] });
    expect(parsed.observations).toHaveLength(2);
  });
});

describe("skewResponse", () => {
  it("accepts { observations: [] }", () => {
    expect(() => skewResponse.parse({ observations: [] })).not.toThrow();
  });
});
