/**
 * Contract test for the in-memory picker-snapshot twin.
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared
 * contract suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */

import { describe, it, expect } from "vitest";
import { runPickerSnapshotContractTests } from "../__contract__/picker-snapshot.contract.ts";
import { makeMemoryPickerSnapshotRepo } from "./picker-snapshot.ts";
import type { PickerGate, PickerSnapshotRow } from "@morai/core";

runPickerSnapshotContractTests(() => {
  const repo = makeMemoryPickerSnapshotRepo();
  return {
    insertPickerSnapshot: repo.insertPickerSnapshot,
    readPickerSnapshot: repo.readPickerSnapshot,
    countSnapshots: repo.countSnapshots,
  };
});

// 28-03 (PLAY-01/PLAY-02): the twin stores/returns PickerSnapshotRow generically (no
// field-specific logic), so the additive `gate` field round-trips byte-for-byte with zero
// twin code change — this proves it explicitly rather than leaving it implicit.
describe("in-memory picker-snapshot twin — gate field (28-03)", () => {
  it("round-trips a full gate object", async () => {
    const repo = makeMemoryPickerSnapshotRepo();
    const gate: PickerGate = {
      vix: 26.4,
      vix3m: 21.1,
      ratio: 1.25,
      asOf: "2026-07-08",
      state: "blocked",
      penaltyMultiplier: 0,
      brakes: { maxOpen: true, cooldown: false, cooldownUntil: null },
      reasons: ["vixBlocked", "maxOpen"],
    };
    const row: PickerSnapshotRow = {
      observedAt: new Date("2026-07-08T14:00:00.000Z"),
      snapshot: {
        asOf: "2026-07-08",
        observedAt: "2026-07-08T14:00:00.000Z",
        spot: 7400,
        source: "schwab",
        gexContextStatus: "ok",
        eventsContextStatus: "ok",
        marketSession: "rth",
        termStructure: [],
        gex: { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null, nearTerm: null },
        events: [],
        candidates: [],
        ruleSet: [],
        gateDrops: { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 },
        gate,
      },
    };

    await repo.insertPickerSnapshot(row);
    const result = await repo.readPickerSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.snapshot.gate).toEqual(gate);
  });
});
