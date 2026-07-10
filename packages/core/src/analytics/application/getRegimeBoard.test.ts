/**
 * getRegimeBoard.test.ts — makeGetRegimeBoardUseCase (BOARD-01/02, MACRO-03, T-24-09/T-24-10).
 *
 * Tests verify:
 *   1. vix-term-structure = VIXCLS/VXVCLS (latest row per series), asOf = OLDER input date
 *   2. vvix = VVIX level, asOf = that row's date
 *   3. vix9d-vix = VIX9D/VIXCLS, asOf = OLDER input date
 *   4. hy-oas = BAMLH0A0HYM2 level, asOf = that row's date
 *   5. each indicator carries source + rationale from the domain metadata table (BOARD-02)
 *   6. a missing input series OMITS its indicator — never a fabricated/placeholder row (T-24-09)
 *   7. empty store → ok([]) (not an error)
 *   8. StorageError from the repo propagates unchanged
 *
 * Test doubles are inline function implementations (core cannot import adapters —
 * architecture-boundaries §2). No any/as/! (typescript.md). All promises awaited.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { ForReadingMacroObservations, MacroObservationRow, StorageError } from "../../journal/index.ts";
import type { ForReadingRuleOverrides } from "../../settings/application/ports.ts";
import { makeGetRegimeBoardUseCase } from "./getRegimeBoard.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function row(seriesId: string, date: string, value: number): MacroObservationRow {
  return { seriesId, date, value, source: seriesId === "VVIX" || seriesId === "VIX9D" ? "cboe" : "fred" };
}

/** No stored overrides — the fresh-per-request default (29-12). */
const noOverrides: ForReadingRuleOverrides = async () => ok({});

const FULL_ROWS: ReadonlyArray<MacroObservationRow> = [
  // VIXCLS: latest 2026-07-08 (18.0), older 2026-07-01 (17.0)
  row("VIXCLS", "2026-07-01", 17.0),
  row("VIXCLS", "2026-07-08", 18.0),
  // VXVCLS: latest 2026-07-07 (20.0) — older than VIXCLS's latest date
  row("VXVCLS", "2026-07-07", 20.0),
  // VVIX: latest 2026-07-08 (89.0) — calm band
  row("VVIX", "2026-07-08", 89.0),
  // VIX9D: latest 2026-07-08 (19.8) — ratio vs VIXCLS (18.0) = 1.1 → crisis band
  row("VIX9D", "2026-07-08", 19.8),
  // BAMLH0A0HYM2 (HY OAS): latest 2026-07-06 (3.5) — warning band
  row("BAMLH0A0HYM2", "2026-07-06", 3.5),
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeGetRegimeBoardUseCase", () => {
  it("computes vix-term-structure from the latest VIXCLS/VXVCLS rows, asOf = OLDER date", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok(FULL_ROWS);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const indicator = result.value.find((i) => i.id === "vix-term-structure");
      expect(indicator).toBeDefined();
      expect(indicator?.value).toBeCloseTo(0.9);
      expect(indicator?.band).toBe("warning");
      // OLDER of 2026-07-08 (VIXCLS latest) and 2026-07-07 (VXVCLS latest) = 2026-07-07
      expect(indicator?.asOf).toBe("2026-07-07");
      expect(indicator?.inputs).toEqual({ VIXCLS: 18.0, VXVCLS: 20.0 });
    }
  });

  it("computes vvix from the latest VVIX row, asOf = that row's date", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok(FULL_ROWS);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const indicator = result.value.find((i) => i.id === "vvix");
      expect(indicator?.value).toBe(89.0);
      expect(indicator?.band).toBe("calm");
      expect(indicator?.asOf).toBe("2026-07-08");
      expect(indicator?.inputs).toEqual({ VVIX: 89.0 });
    }
  });

  it("computes vix9d-vix from the latest VIX9D/VIXCLS rows, asOf = OLDER date", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok(FULL_ROWS);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const indicator = result.value.find((i) => i.id === "vix9d-vix");
      expect(indicator?.value).toBeCloseTo(1.1);
      expect(indicator?.band).toBe("crisis");
      expect(indicator?.asOf).toBe("2026-07-08");
      expect(indicator?.inputs).toEqual({ VIX9D: 19.8, VIXCLS: 18.0 });
    }
  });

  it("computes hy-oas from the latest BAMLH0A0HYM2 row, asOf = that row's date", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok(FULL_ROWS);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const indicator = result.value.find((i) => i.id === "hy-oas");
      expect(indicator?.value).toBe(3.5);
      expect(indicator?.band).toBe("warning");
      expect(indicator?.asOf).toBe("2026-07-06");
      expect(indicator?.inputs).toEqual({ BAMLH0A0HYM2: 3.5 });
    }
  });

  it("carries non-empty source + rationale strings for every indicator (BOARD-02)", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok(FULL_ROWS);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(4);
      for (const indicator of result.value) {
        expect(indicator.source.length).toBeGreaterThan(0);
        expect(indicator.rationale.length).toBeGreaterThan(0);
        expect(indicator.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("OMITS vix-term-structure when VXVCLS has no row — never fabricates (T-24-09)", async () => {
    const rows = FULL_ROWS.filter((r) => r.seriesId !== "VXVCLS");
    const readMacroObservations: ForReadingMacroObservations = async () => ok(rows);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((i) => i.id === "vix-term-structure")).toBeUndefined();
      expect(result.value).toHaveLength(3);
    }
  });

  it("OMITS vix9d-vix when VIX9D has no row — never fabricates (T-24-09)", async () => {
    const rows = FULL_ROWS.filter((r) => r.seriesId !== "VIX9D");
    const readMacroObservations: ForReadingMacroObservations = async () => ok(rows);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((i) => i.id === "vix9d-vix")).toBeUndefined();
      expect(result.value).toHaveLength(3);
    }
  });

  it("OMITS vix9d-vix when the VIXCLS denominator is 0 — never emits Infinity (WR-01)", async () => {
    const rows = FULL_ROWS.map((r) =>
      r.seriesId === "VIXCLS" && r.date === "2026-07-08" ? { ...r, value: 0 } : r,
    );
    const readMacroObservations: ForReadingMacroObservations = async () => ok(rows);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((i) => i.id === "vix9d-vix")).toBeUndefined();
      // one bad ratio omits itself only — the rest of the board still ships
      expect(result.value.find((i) => i.id === "vvix")).toBeDefined();
      expect(result.value.find((i) => i.id === "hy-oas")).toBeDefined();
      expect(result.value.find((i) => i.id === "vix-term-structure")).toBeDefined();
    }
  });

  it("returns ok([]) when the store is empty", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok([]);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("propagates StorageError from the repo unchanged", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "db down" };
    const readMacroObservations: ForReadingMacroObservations = async () => err(storageError);
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides: noOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(storageError);
    }
  });

  // ─── Runtime rule-settings overrides (29-12, RUNTIME-*) ────────────────────────

  it("reads overrides fresh on every call — invoked once per getRegimeBoard() invocation", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok(FULL_ROWS);
    let callCount = 0;
    const readRuleOverrides: ForReadingRuleOverrides = async () => {
      callCount += 1;
      return ok({});
    };
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides });

    await getRegimeBoard();
    await getRegimeBoard();

    expect(callCount).toBe(2);
  });

  it("a regime override rebands the vvix indicator on the next call", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok(FULL_ROWS);
    // VVIX value is 89.0 — below the default warn=100 (calm) but above an overridden warn=80.
    const readRuleOverrides: ForReadingRuleOverrides = async () => ok({ regime: { vvixWarn: 80 } });
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const indicator = result.value.find((i) => i.id === "vvix");
      expect(indicator?.band).toBe("warning");
    }
  });

  it("a readRuleOverrides read error degrades to defaults — never crashes the board (T-29-15)", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok(FULL_ROWS);
    const readRuleOverrides: ForReadingRuleOverrides = async () =>
      err({ kind: "storage-error", message: "settings read failed" });
    const getRegimeBoard = makeGetRegimeBoardUseCase({ readMacroObservations, readRuleOverrides });

    const result = await getRegimeBoard();

    expect(result.ok).toBe(true);
    if (result.ok) {
      // defaults (VVIX_WARN=100) — 89.0 stays "calm", board still ships
      const indicator = result.value.find((i) => i.id === "vvix");
      expect(indicator?.band).toBe("calm");
      expect(result.value).toHaveLength(4);
    }
  });
});
