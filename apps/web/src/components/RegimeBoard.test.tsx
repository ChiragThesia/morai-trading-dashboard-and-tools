/**
 * RegimeBoard.test.tsx — TDD suite for the Regime & Breadth board (Phase 24, BOARD-01/02)
 * plus the picker entry-gate tile (Phase 28, PLAY-01, 28-06).
 *
 * Behaviors under test:
 *   1. Loading / empty / error states use the exact 24-UI-SPEC.md copy.
 *   2. All 4 indicators present → one regime-chip-{id} per indicator, each with a
 *      band-colored value + dot and an "as of {date}" stamp.
 *   3. Partial data (2 of 4) → exactly 2 chips, no placeholder/dash chip for the missing 2.
 *   4. Provenance: the regime-why-{id} ⓘ trigger's tooltip shows the payload's own
 *      source + rationale verbatim — not a hardcoded per-indicator lookup.
 *   5. Entry-gate tile (28-06): all four gate states render with VIX/ratio/asOf; "blind"
 *      renders louder than "blocked"; a tripped brake is named; no gate tile when the
 *      picker snapshot is unavailable (never a fabricated tile, T-24-09 precedent).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fc from "fast-check";
import { assertDefined } from "@morai/shared";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { RegimeResponse, PickerGate } from "@morai/contracts";

const { mockUseRegimeBoard } = vi.hoisted(() => ({ mockUseRegimeBoard: vi.fn() }));
vi.mock("../hooks/useRegimeBoard.ts", () => ({ useRegimeBoard: mockUseRegimeBoard }));

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn() }));
vi.mock("../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

const { mockUseMacro } = vi.hoisted(() => ({ mockUseMacro: vi.fn() }));
vi.mock("../hooks/useMacro.ts", () => ({ useMacro: mockUseMacro }));

import { RegimeBoard } from "./RegimeBoard.tsx";

const INDICATORS: RegimeResponse = [
  {
    id: "vix-term-structure",
    label: "VIX/VIX3M Term Structure",
    value: 0.92,
    band: "warning",
    bandWarn: 0.9,
    bandCrisis: 0.95,
    asOf: "2026-07-08",
    source: "eco3min.fr, systemtrader.co",
    rationale: "0.90 warn / 0.95 crisis, confirmed by independent sources.",
  },
  {
    id: "vvix",
    label: "VVIX",
    value: 89.0,
    band: "calm",
    bandWarn: 100,
    bandCrisis: 115,
    asOf: "2026-07-08",
    source: "SpotGamma, TOS Indicators",
    rationale: "100 warn confirmed directly by 4 independent sources.",
  },
  {
    id: "vix9d-vix",
    label: "VIX9D/VIX",
    value: 1.15,
    band: "crisis",
    bandWarn: 1.0,
    bandCrisis: 1.1,
    asOf: "2026-07-08",
    source: "topstep.com, macroption.com, cboe.com",
    rationale: "[ASSUMED] structural analogy to the VIX/VIX3M ratio.",
  },
  {
    id: "hy-oas",
    label: "HY OAS (Credit Spread)",
    value: 3.4,
    band: "warning",
    bandWarn: 3.0,
    bandCrisis: 5.0,
    asOf: "2026-07-07",
    source: "eco3min.fr, macroradar.io, convextrade.com",
    rationale: "Synthesized from 3 practitioner sources.",
  },
];

function setRegimeBoard(data: unknown, opts: { isPending?: boolean; isError?: boolean } = {}): void {
  mockUseRegimeBoard.mockReturnValue({
    data,
    isPending: opts.isPending ?? false,
    isError: opts.isError ?? false,
  });
}

/** Sets usePicker()'s snapshot to `null` (no gate tile — the T-24-09 "never fabricate" default),
 *  or a full snapshot carrying the given `gate` when provided. */
function setPickerGate(gate?: PickerGate): void {
  mockUsePicker.mockReturnValue({
    data: gate === undefined ? null : { ...pickerSnapshotFixture, gate },
    isPending: false,
    isError: false,
  });
}

const MACRO_DATA = {
  DFF: [{ time: "2026-06-30", value: 4.33 }],
  SOFR: [{ time: "2026-06-30", value: 4.35 }],
  T10Y2Y: [{ time: "2026-06-30", value: 0.52 }],
  T10Y3M: [{ time: "2026-06-30", value: -0.18 }],
  DGS1MO: [{ time: "2026-06-30", value: 5.28 }],
  DGS3MO: [{ time: "2026-06-30", value: 5.1 }],
};

/** Sets useMacro()'s data — omitted/empty (no rates row, "never fabricate" default) or
 *  the given series map. */
function setMacro(data?: unknown): void {
  mockUseMacro.mockReturnValue({ data, isPending: false });
}

describe("RegimeBoard", () => {
  beforeEach(() => {
    setPickerGate();
    setMacro();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the loading copy while useRegimeBoard is pending", () => {
    setRegimeBoard(undefined, { isPending: true });
    render(<RegimeBoard />);
    expect(screen.getByText("Loading regime board…")).toBeDefined();
  });

  it("renders the empty-state copy when the array is []", () => {
    setRegimeBoard([]);
    render(<RegimeBoard />);
    expect(
      screen.getByText("Regime data unavailable — run fetch-rates to populate."),
    ).toBeDefined();
  });

  it("renders the error-state copy when the query errors", () => {
    setRegimeBoard(undefined, { isError: true });
    render(<RegimeBoard />);
    expect(
      screen.getByText("Regime board unavailable — check the FRED/CBOE fetch job."),
    ).toBeDefined();
  });

  it("renders one compact row per present indicator; band = value color only when abnormal (calm stays quiet)", () => {
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard />);

    for (const ind of INDICATORS) {
      expect(screen.getByTestId(`regime-chip-${ind.id}`)).toBeDefined();
      expect(screen.getByTestId(`regime-value-${ind.id}`).textContent).toContain(ind.value.toFixed(2));
      // Per-row "as of" caption is gone — deduped into one freshness footer.
      expect(screen.queryByTestId(`regime-asof-${ind.id}`)).toBeNull();
    }

    // calm → quiet default text, NOT the loud up/green token; abnormal bands carry the color.
    expect(screen.getByTestId("regime-value-vvix").className).toContain("text-txt");
    expect(screen.getByTestId("regime-value-vvix").className).not.toContain("text-up");
    expect(screen.getByTestId("regime-gauge-marker-vvix").className).not.toContain("bg-up");
    expect(screen.getByTestId("regime-value-vix-term-structure").className).toContain("text-amber");
    expect(screen.getByTestId("regime-gauge-marker-vix-term-structure").className).toContain("bg-amber");
    expect(screen.getByTestId("regime-value-vix9d-vix").className).toContain("text-down");
    expect(screen.getByTestId("regime-gauge-marker-vix9d-vix").className).toContain("bg-down");
  });

  it("renders a role=meter gauge per indicator, band-colored marker, aria carrying value/band (DEFECT-2)", () => {
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard />);

    for (const ind of INDICATORS) {
      const gauge = screen.getByTestId(`regime-gauge-${ind.id}`);
      expect(gauge.getAttribute("role")).toBe("meter");
      expect(gauge.getAttribute("aria-valuenow")).toBe(String(ind.value));
      expect(gauge.getAttribute("aria-valuetext")).toBe(`${ind.value.toFixed(2)} — ${ind.band}`);
      expect(gauge.getAttribute("aria-label")).toBe(`${ind.label} gauge`);
    }

    // Removed: the standalone band dot double-encoded the marker's color signal.
    expect(screen.queryByTestId("regime-band-vvix")).toBeNull();

    // Marker color reads the server band, not a client recomputation.
    expect(screen.getByTestId("regime-gauge-marker-vvix").className).toContain("bg-txt");
    expect(screen.getByTestId("regime-gauge-marker-vix-term-structure").className).toContain("bg-amber");
    expect(screen.getByTestId("regime-gauge-marker-vix9d-vix").className).toContain("bg-down");
  });

  it("positions band segments from response bandWarn/bandCrisis (not client threshold constants)", () => {
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard />);

    // vix-term-structure: GAUGE_SCALE 0.6-1.2, bandWarn 0.9 → 50%, bandCrisis 0.95 → 58.33%
    const gauge = screen.getByTestId("regime-gauge-vix-term-structure");
    const segments = gauge.querySelectorAll<HTMLElement>(":scope > div");
    const warnSegment = segments[0];
    const crisisSegment = segments[1];
    assertDefined(warnSegment, "warn segment present");
    assertDefined(crisisSegment, "crisis segment present");
    expect(parseFloat(warnSegment.style.left)).toBeCloseTo(50, 5);
    expect(parseFloat(crisisSegment.style.left)).toBeCloseTo(58.333, 1);
  });

  it("clamps the marker position at both axis ends (fast-check: value/min/max never overflow [0,100]%)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
        (value, min, max) => {
          if (max <= min) return; // degenerate scale, not a real GAUGE_SCALE entry
          cleanup();
          const indicator = {
            ...INDICATORS[0],
            id: "vix-term-structure",
            value,
            band: "calm" as const,
            bandWarn: min,
            bandCrisis: max,
          };
          setRegimeBoard([indicator]);
          render(<RegimeBoard />);
          const marker = screen.getByTestId("regime-gauge-marker-vix-term-structure");
          // GAUGE_SCALE for vix-term-structure is fixed (0.6-1.2) — the marker clamps to that
          // axis regardless of the arbitrary bandWarn/bandCrisis fed in, so `left` is always
          // a valid clamped percentage string in [0, 100].
          const left = parseFloat(marker.style.left);
          expect(left).toBeGreaterThanOrEqual(0);
          expect(left).toBeLessThanOrEqual(100);

          // CR-01 regression guard: warn/crisis band segments must clamp the same way the
          // marker does. An out-of-axis bandWarn/bandCrisis must never produce a negative
          // CSS width (invalid CSS, silently dropped by the browser) or an out-of-[0,100]
          // `left`. DOM order is [warn segment, crisis segment, marker].
          const gauge = screen.getByTestId("regime-gauge-vix-term-structure");
          const segments = gauge.querySelectorAll<HTMLElement>(":scope > div");
          const warnSegment = segments[0];
          const crisisSegment = segments[1];
          assertDefined(warnSegment, "warn segment present");
          assertDefined(crisisSegment, "crisis segment present");
          const warnLeft = parseFloat(warnSegment.style.left);
          const warnWidth = parseFloat(warnSegment.style.width);
          const crisisLeft = parseFloat(crisisSegment.style.left);
          const crisisWidth = parseFloat(crisisSegment.style.width);
          expect(warnLeft).toBeGreaterThanOrEqual(0);
          expect(warnLeft).toBeLessThanOrEqual(100);
          expect(warnWidth).toBeGreaterThanOrEqual(0);
          expect(crisisLeft).toBeGreaterThanOrEqual(0);
          expect(crisisLeft).toBeLessThanOrEqual(100);
          expect(crisisWidth).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("dedupes per-indicator 'as of' captions into one freshness footer, noting date exceptions", () => {
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard />);

    for (const ind of INDICATORS) {
      expect(screen.queryByTestId(`regime-asof-${ind.id}`)).toBeNull();
    }
    const footer = screen.getByTestId("regime-freshness");
    // Newest regime date is the headline; the one older indicator (hy-oas 07-07) is noted inline.
    expect(footer.textContent).toContain("2026-07-08");
    expect(footer.textContent).toContain("2026-07-07");
  });

  it("renders exactly 2 chips for 2-of-4 present indicators — no placeholder/dash chip", () => {
    setRegimeBoard(INDICATORS.slice(0, 2));
    render(<RegimeBoard />);

    expect(screen.getByTestId("regime-chip-vix-term-structure")).toBeDefined();
    expect(screen.getByTestId("regime-chip-vvix")).toBeDefined();
    expect(screen.queryByTestId("regime-chip-vix9d-vix")).toBeNull();
    expect(screen.queryByTestId("regime-chip-hy-oas")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("the ⓘ trigger's tooltip renders the indicator's own source + rationale verbatim", async () => {
    const user = userEvent.setup();
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard />);

    await user.hover(screen.getByTestId("regime-why-hy-oas"));

    const hyOas = INDICATORS.find((ind) => ind.id === "hy-oas");
    assertDefined(hyOas, "hy-oas fixture present");
    expect(await screen.findByText(hyOas.source)).toBeDefined();
    expect(await screen.findByText(hyOas.rationale)).toBeDefined();
  });

  it("shortens long indicator labels in dense mode so tiles never wrap; full labels stay outside dense mode", () => {
    setRegimeBoard(INDICATORS);
    const { unmount } = render(<RegimeBoard dense />);
    expect(screen.getByTestId("regime-chip-vix-term-structure").textContent).toContain("VIX/VIX3M");
    expect(screen.getByTestId("regime-chip-vix-term-structure").textContent).not.toContain(
      "VIX/VIX3M Term Structure",
    );
    expect(screen.getByTestId("regime-chip-hy-oas").textContent).toContain("HY OAS");
    expect(screen.getByTestId("regime-chip-hy-oas").textContent).not.toContain("Credit Spread");
    unmount();

    render(<RegimeBoard />);
    expect(screen.getByTestId("regime-chip-vix-term-structure").textContent).toContain(
      "VIX/VIX3M Term Structure",
    );
    expect(screen.getByTestId("regime-chip-hy-oas").textContent).toContain("HY OAS (Credit Spread)");
  });

  it("renders the 'Market regime' panel heading in every state (loading/error/empty/populated)", () => {
    setRegimeBoard(undefined, { isPending: true });
    const { unmount } = render(<RegimeBoard />);
    expect(screen.getByText("Market regime")).toBeDefined();
    unmount();

    setRegimeBoard(undefined, { isError: true });
    const err1 = render(<RegimeBoard />);
    expect(screen.getByText("Market regime")).toBeDefined();
    err1.unmount();

    setRegimeBoard([]);
    const empty = render(<RegimeBoard />);
    expect(screen.getByText("Market regime")).toBeDefined();
    empty.unmount();

    setRegimeBoard(INDICATORS);
    render(<RegimeBoard />);
    expect(screen.getByText("Market regime")).toBeDefined();
  });
});

describe("RegimeBoard — merged rates row (post-v1.3 FRED macro absorption)", () => {
  beforeEach(() => {
    setPickerGate();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("omits the rates row when macro data is unavailable — never fabricated (T-24-09 precedent)", () => {
    setRegimeBoard(INDICATORS);
    setMacro(undefined);
    render(<RegimeBoard />);
    expect(screen.queryByTestId("regime-rates-row")).toBeNull();
  });

  it("omits the rates row when macro data is an empty map", () => {
    setRegimeBoard(INDICATORS);
    setMacro({});
    render(<RegimeBoard />);
    expect(screen.queryByTestId("regime-rates-row")).toBeNull();
  });

  it("renders one pill per rate series with its latest value, dropping the old bare VIX/VVIX chips", () => {
    setRegimeBoard(INDICATORS);
    setMacro(MACRO_DATA);
    render(<RegimeBoard />);

    expect(screen.getByTestId("rate-chip-DFF").textContent).toContain("4.33");
    expect(screen.getByTestId("rate-chip-SOFR").textContent).toContain("4.35");
    expect(screen.getByTestId("rate-chip-DGS1MO").textContent).toContain("5.28");
    expect(screen.getByTestId("rate-chip-DGS3MO").textContent).toContain("5.10");
    expect(screen.getByTestId("rate-chip-T10Y2Y").textContent).toContain("0.52");
    expect(screen.getByTestId("rate-chip-T10Y3M").textContent).toContain("-0.18");
    // VIX/VVIX are dropped from this row — VVIX stays only as a banded indicator chip above.
    expect(screen.queryByTestId("rate-chip-VIXCLS")).toBeNull();
    expect(screen.queryByTestId("rate-chip-VVIX")).toBeNull();
  });

  it("renders regime indicators and rates as compact rows — no cards, no pills; only the gate stays a framed tile", () => {
    setRegimeBoard(INDICATORS);
    setMacro(MACRO_DATA);
    setPickerGate({
      vix: 18,
      vix3m: 20,
      ratio: 0.9,
      asOf: "2026-07-09",
      state: "open",
      penaltyMultiplier: 1,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
      reasons: [],
    });
    render(<RegimeBoard />);

    // Regime indicators are rows now, not rounded cards or pills.
    expect(screen.getByTestId("regime-chip-vvix").className).not.toContain("rounded-lg");
    expect(screen.getByTestId("regime-chip-vvix").className).not.toContain("rounded-full");
    // Rates are compact label/value rows, not the rejected fat pills.
    expect(screen.getByTestId("rate-chip-DFF").className).not.toContain("rounded-full");
    // The entry gate stays a framed tile at the top — it is THE signal.
    expect(screen.getByTestId("gate-chip").className).toContain("rounded");
  });

  it("renders the rates row alongside the loading/error/empty regime-board states (independent data source)", () => {
    setRegimeBoard(undefined, { isError: true });
    setMacro(MACRO_DATA);
    render(<RegimeBoard />);
    expect(
      screen.getByText("Regime board unavailable — check the FRED/CBOE fetch job."),
    ).toBeDefined();
    expect(screen.getByTestId("regime-rates-row")).toBeDefined();
  });
});

describe("RegimeBoard — entry-gate tile (28-06, PLAY-01)", () => {
  beforeEach(() => {
    setMacro();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const BASE_GATE: PickerGate = {
    vix: 18,
    vix3m: 20,
    ratio: 0.9,
    asOf: "2026-07-09",
    state: "open",
    penaltyMultiplier: 1,
    brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
    reasons: [],
  };

  it("renders no gate tile when the picker snapshot is unavailable (never a fabricated tile)", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate();
    render(<RegimeBoard />);

    expect(screen.queryByTestId("gate-chip")).toBeNull();
  });

  it("renders the open gate state with VIX/ratio/asOf", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate(BASE_GATE);
    render(<RegimeBoard />);

    expect(screen.getByTestId("gate-state").textContent).toBe("OPEN");
    expect(screen.getByTestId("gate-metrics").textContent).toBe("VIX 18.00 · ratio 0.90");
    expect(screen.getByTestId("gate-asof").textContent).toBe("as of 2026-07-09");
    expect(screen.getByTestId("gate-state").className).toContain("text-up");
  });

  it("renders the penalty gate state distinctly (amber)", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate({ ...BASE_GATE, state: "penalty", vix: 22 });
    render(<RegimeBoard />);

    expect(screen.getByTestId("gate-state").textContent).toBe("PENALTY");
    expect(screen.getByTestId("gate-state").className).toContain("text-amber");
  });

  it("renders the blocked gate state (down token), without the blind alarm treatment", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate({ ...BASE_GATE, state: "blocked", vix: 26 });
    render(<RegimeBoard />);

    expect(screen.getByTestId("gate-state").textContent).toBe("BLOCKED");
    expect(screen.getByTestId("gate-state").className).toContain("text-down");
    expect(screen.getByTestId("gate-chip").className).not.toContain("bg-downd");
  });

  it("renders GATE BLIND visibly louder than blocked — the filled alarm treatment", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate({ ...BASE_GATE, state: "blind", vix: null, ratio: null, asOf: null, reasons: ["gateReadError"] });
    render(<RegimeBoard />);

    expect(screen.getByTestId("gate-state").textContent).toBe("GATE BLIND");
    expect(screen.getByTestId("gate-chip").className).toContain("bg-downd");
    expect(screen.getByTestId("gate-metrics").textContent).toBe("VIX — · ratio —");
    expect(screen.getByTestId("gate-asof").textContent).toBe("as of —");
  });

  it("names a tripped max-open brake alongside the gate state", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate({ ...BASE_GATE, brakes: { maxOpen: true, cooldown: false, cooldownUntil: null } });
    render(<RegimeBoard />);

    expect(screen.getByTestId("gate-brake").textContent).toBe("brake: max-open");
  });

  it("names a tripped cooldown brake alongside the gate state", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate({
      ...BASE_GATE,
      brakes: { maxOpen: false, cooldown: true, cooldownUntil: "2026-07-11" },
    });
    render(<RegimeBoard />);

    expect(screen.getByTestId("gate-brake").textContent).toBe("brake: cooldown");
  });

  it("renders no brake tag when neither brake is tripped", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate(BASE_GATE);
    render(<RegimeBoard />);

    expect(screen.queryByTestId("gate-brake")).toBeNull();
  });

  it("still shows the gate chip when the regime board query errors (WR-02: gate is a separate data source, never hidden by an unrelated failure)", () => {
    setRegimeBoard(undefined, { isError: true });
    setPickerGate({
      ...BASE_GATE,
      state: "blind",
      vix: null,
      ratio: null,
      asOf: null,
      reasons: ["gateReadError"],
    });
    render(<RegimeBoard />);

    expect(
      screen.getByText("Regime board unavailable — check the FRED/CBOE fetch job."),
    ).toBeDefined();
    expect(screen.getByTestId("gate-chip")).toBeDefined();
    expect(screen.getByTestId("gate-state").textContent).toBe("GATE BLIND");
    expect(screen.getByTestId("gate-chip").className).toContain("bg-downd");
  });
});

describe("RegimeBoard — live display value + client band recompute (Phase 38-06, LIVE-05, display-live/gate-EOD LAW)", () => {
  // Distinct from every EOD fixture value (catch #20): vix-term-structure EOD 0.92/warning,
  // vvix EOD 89.00/calm, vix9d-vix EOD 1.15/crisis.
  const LIVE_INDICES = {
    vix: 21.7,
    vix3m: 20.9,
    vvix: 120.3,
    vix9d: 23.5,
    ts: "2026-07-13T14:32:00Z",
  };

  beforeEach(() => {
    setPickerGate();
    setMacro();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a live value + client-recomputed band for the 3 broker-quotable rows while liveStatus is live", () => {
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard liveIndices={LIVE_INDICES} liveStatus="live" />);

    // vvix: EOD 89.00/calm -> live 120.30 (>= VVIX_CRISIS 115) -> crisis
    expect(screen.getByTestId("regime-value-vvix").textContent).toBe("120.30");
    expect(screen.getByTestId("regime-value-vvix").className).toContain("text-down");
    expect(screen.getByTestId("regime-gauge-marker-vvix").className).toContain("bg-down");

    // vix-term-structure: EOD 0.92/warning -> live 21.7/20.9=1.04 (>= crisis 0.95) -> crisis
    expect(screen.getByTestId("regime-value-vix-term-structure").textContent).toBe("1.04");
    expect(screen.getByTestId("regime-value-vix-term-structure").className).toContain("text-down");

    // vix9d-vix: EOD 1.15/crisis -> live 23.5/21.7=1.08 (>= warn 1.0, < crisis 1.1) -> warning
    expect(screen.getByTestId("regime-value-vix9d-vix").textContent).toBe("1.08");
    expect(screen.getByTestId("regime-value-vix9d-vix").className).toContain("text-amber");

    // Footer flips to a live marker — never a silent live/EOD mix (catch #26)
    expect(screen.getByTestId("regime-freshness").textContent).toBe("LIVE");
  });

  it("stays on the EOD value/band and the 'EOD · as of …' footer while liveStatus is quiet, even with liveIndices present", () => {
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard liveIndices={LIVE_INDICES} liveStatus="quiet" />);

    expect(screen.getByTestId("regime-value-vvix").textContent).toBe("89.00");
    expect(screen.getByTestId("regime-value-vvix").className).toContain("text-txt");
    expect(screen.getByTestId("regime-freshness").textContent).toContain("EOD · as of 2026-07-08");
  });

  it("never lets liveIndices reach the gate chip or the hy-oas row (separate FRED-only sources)", () => {
    setRegimeBoard(INDICATORS);
    setPickerGate({
      vix: 18,
      vix3m: 20,
      ratio: 0.9,
      asOf: "2026-07-09",
      state: "open",
      penaltyMultiplier: 1,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
      reasons: [],
    });
    render(<RegimeBoard liveIndices={LIVE_INDICES} liveStatus="live" />);

    expect(screen.getByTestId("gate-metrics").textContent).toBe("VIX 18.00 · ratio 0.90");
    expect(screen.getByTestId("regime-value-hy-oas").textContent).toBe("3.40");
    expect(screen.getByTestId("regime-value-hy-oas").className).toContain("text-amber");
  });

  it("degrades only the affected row to EOD when one required live input is null (per-symbol Schwab failure)", () => {
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard liveIndices={{ ...LIVE_INDICES, vix3m: null }} liveStatus="live" />);

    // vix-term-structure needs vix3m -> falls back to EOD, untouched
    expect(screen.getByTestId("regime-value-vix-term-structure").textContent).toBe("0.92");
    // vvix has no dependency on vix3m -> still live
    expect(screen.getByTestId("regime-value-vvix").textContent).toBe("120.30");
  });
});

describe("RegimeBoard — rate block gauges (39-02, GAUGE-02/GAUGE-05)", () => {
  beforeEach(() => {
    setRegimeBoard(INDICATORS);
    setPickerGate();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the 4 money-rate rows as NEUTRAL bg-dim gauges, no band-segment children, for any value", () => {
    setMacro(MACRO_DATA);
    render(<RegimeBoard />);

    for (const id of ["DFF", "SOFR", "DGS1MO", "DGS3MO"] as const) {
      const gauge = screen.getByTestId(`rate-gauge-${id}`);
      const marker = screen.getByTestId(`rate-gauge-marker-${id}`);
      expect(marker.className).toContain("bg-dim");
      expect(marker.className).not.toContain("bg-amber");
      expect(marker.className).not.toContain("bg-down");
      expect(marker.className).not.toContain("bg-txt");
      expect(gauge.querySelectorAll(":scope > div").length).toBe(1);
      expect(gauge.getAttribute("role")).toBe("meter");
      expect(gauge.getAttribute("aria-valuemin")).toBe("0");
      expect(gauge.getAttribute("aria-valuemax")).toBe("8");
    }
  });

  it("a neutral row's aria-valuetext states the value + 'position', never a band word", () => {
    setMacro(MACRO_DATA);
    render(<RegimeBoard />);

    const gauge = screen.getByTestId("rate-gauge-DFF");
    expect(gauge.getAttribute("aria-valuetext")).toBe("4.33% — position");
    expect(gauge.getAttribute("aria-valuetext")).not.toMatch(/calm|warning|crisis/);
  });

  it("renders 10Y-2Y at -0.60 as BANDED crisis (band segments present, marker bg-down)", () => {
    setMacro({ ...MACRO_DATA, T10Y2Y: [{ time: "2026-06-30", value: -0.6 }] });
    render(<RegimeBoard />);

    const gauge = screen.getByTestId("rate-gauge-T10Y2Y");
    expect(gauge.querySelectorAll(":scope > div").length).toBe(3);
    expect(screen.getByTestId("rate-gauge-marker-T10Y2Y").className).toContain("bg-down");
    expect(gauge.getAttribute("aria-valuetext")).toBe("-0.60% — crisis");
  });

  it("renders 10Y-2Y at -0.20 as BANDED warning", () => {
    setMacro({ ...MACRO_DATA, T10Y2Y: [{ time: "2026-06-30", value: -0.2 }] });
    render(<RegimeBoard />);

    expect(screen.getByTestId("rate-gauge-marker-T10Y2Y").className).toContain("bg-amber");
    expect(screen.getByTestId("rate-gauge-T10Y2Y").getAttribute("aria-valuetext")).toBe("-0.20% — warning");
  });

  it("renders 10Y-3M at +0.50 as BANDED calm", () => {
    setMacro({ ...MACRO_DATA, T10Y3M: [{ time: "2026-06-30", value: 0.5 }] });
    render(<RegimeBoard />);

    expect(screen.getByTestId("rate-gauge-marker-T10Y3M").className).toContain("bg-txt");
    expect(screen.getByTestId("rate-gauge-T10Y3M").getAttribute("aria-valuetext")).toBe("0.50% — calm");
  });

  it("keeps the printed rate-chip value strings unchanged from today (fmtRate)", () => {
    setMacro(MACRO_DATA);
    render(<RegimeBoard />);

    expect(screen.getByTestId("rate-chip-DFF").textContent).toContain("4.33");
    expect(screen.getByTestId("rate-chip-T10Y2Y").textContent).toContain("0.52");
    expect(screen.getByTestId("rate-chip-T10Y3M").textContent).toContain("-0.18");
  });

  it("omits the gauge (never a marker at a fabricated 0) when a rate has no macro point", () => {
    const { DFF: _dff, ...rest } = MACRO_DATA;
    setMacro(rest);
    render(<RegimeBoard />);

    expect(screen.getByTestId("rate-chip-DFF").textContent).toContain("—");
    expect(screen.queryByTestId("rate-gauge-DFF")).toBeNull();
  });
});

describe("RegimeBoard — teaching tooltips (39-02, GAUGE-04)", () => {
  beforeEach(() => {
    setRegimeBoard(INDICATORS);
    setPickerGate();
    setMacro(MACRO_DATA);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("hovering regime-why-hy-oas shows its WHAT sentence AND still shows the server source + rationale (SOURCE line preserved)", async () => {
    const user = userEvent.setup();
    render(<RegimeBoard />);

    await user.hover(screen.getByTestId("regime-why-hy-oas"));

    expect(
      await screen.findByText("HY OAS — junk-bond yield premium over Treasuries"),
    ).toBeDefined();
    const hyOas = INDICATORS.find((ind) => ind.id === "hy-oas");
    assertDefined(hyOas, "hy-oas fixture present");
    expect(await screen.findByText(hyOas.source)).toBeDefined();
    expect(await screen.findByText(hyOas.rationale)).toBeDefined();
  });

  it("hovering rate-why-T10Y2Y shows its WHAT + the banded META wording", async () => {
    const user = userEvent.setup();
    render(<RegimeBoard />);

    await user.hover(screen.getByTestId("rate-why-T10Y2Y"));

    expect(
      await screen.findByText("10Y minus 2Y Treasury yield — the curve slope"),
    ).toBeDefined();
    expect(
      await screen.findByText("Calm >0 · warn ≤0 · crisis ≤−0.50 · FRED T10Y2Y, daily"),
    ).toBeDefined();
  });

  it("hovering rate-why-DFF shows its WHAT + the neutral 'position only' META wording", async () => {
    const user = userEvent.setup();
    render(<RegimeBoard />);

    await user.hover(screen.getByTestId("rate-why-DFF"));

    expect(
      await screen.findByText("Fed's overnight bank lending rate — sets everything else"),
    ).toBeDefined();
    expect(await screen.findByText("0–8% range · FRED DFF, daily")).toBeDefined();
  });
});

// ─── Trend delta chips (2026-07-16: "% change since last so we can see the trend") ──────
describe("RegimeBoard — trend delta chips", () => {
  beforeEach(() => {
    setPickerGate();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const MACRO_WITH_HISTORY = {
    VIXCLS: [
      { time: "2026-07-14", value: 17.16 },
      { time: "2026-07-15", value: 16.5 },
    ],
    VXVCLS: [
      { time: "2026-07-14", value: 19.5 },
      { time: "2026-07-15", value: 19.4 },
    ],
    VVIX: [
      { time: "2026-07-14", value: 93.5 },
      { time: "2026-07-15", value: 94.3 },
    ],
    VIX9D: [
      { time: "2026-07-14", value: 14.0 },
      { time: "2026-07-15", value: 14.2 },
    ],
    BAMLH0A0HYM2: [
      { time: "2026-07-14", value: 2.69 },
      { time: "2026-07-15", value: 2.72 },
    ],
    DFF: [
      { time: "2026-07-14", value: 4.33 },
      { time: "2026-07-15", value: 4.31 },
    ],
  };

  it("renders unit-appropriate deltas vs the prior EOD observation on regime + rate rows", () => {
    setRegimeBoard(INDICATORS);
    setMacro(MACRO_WITH_HISTORY);
    render(<RegimeBoard />);

    // ratio rows: raw Δ 2dp — VIX/VIX3M 17.16/19.5=0.880 → 16.5/19.4=0.851 = ▼0.03
    expect(screen.getByTestId("regime-delta-vix-term-structure").textContent).toBe("▼0.03");
    // VIX9D/VIX 14/17.16=0.816 → 14.2/16.5=0.861 = ▲0.04
    expect(screen.getByTestId("regime-delta-vix9d-vix").textContent).toBe("▲0.04");
    // VVIX level: % of prev — 93.5 → 94.3 = +0.9%
    expect(screen.getByTestId("regime-delta-vvix").textContent).toBe("▲0.9%");
    // HY OAS: bp — 2.69 → 2.72 = ▲3bp
    expect(screen.getByTestId("regime-delta-hy-oas").textContent).toBe("▲3bp");
    // rate row: DFF 4.33 → 4.31 = ▼2bp
    expect(screen.getByTestId("regime-delta-DFF").textContent).toBe("▼2bp");
    // tooltip carries the vs-date provenance
    expect(screen.getByTestId("regime-delta-vvix").getAttribute("title")).toContain("vs 2026-07-14");
  });

  it("renders NO delta chip when a series has fewer than 2 observations (never fabricated)", () => {
    setRegimeBoard(INDICATORS);
    setMacro(MACRO_DATA); // the single-point fixture
    render(<RegimeBoard />);

    expect(screen.queryByTestId("regime-delta-DFF")).toBeNull();
    expect(screen.queryByTestId("regime-delta-vvix")).toBeNull();
    expect(screen.queryByTestId("regime-delta-vix-term-structure")).toBeNull();
  });
});
