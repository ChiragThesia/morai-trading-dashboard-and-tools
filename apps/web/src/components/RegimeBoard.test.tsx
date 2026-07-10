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
    asOf: "2026-07-08",
    source: "eco3min.fr, systemtrader.co",
    rationale: "0.90 warn / 0.95 crisis, confirmed by independent sources.",
  },
  {
    id: "vvix",
    label: "VVIX",
    value: 89.0,
    band: "calm",
    asOf: "2026-07-08",
    source: "SpotGamma, TOS Indicators",
    rationale: "100 warn confirmed directly by 4 independent sources.",
  },
  {
    id: "vix9d-vix",
    label: "VIX9D/VIX",
    value: 1.15,
    band: "crisis",
    asOf: "2026-07-08",
    source: "topstep.com, macroption.com, cboe.com",
    rationale: "[ASSUMED] structural analogy to the VIX/VIX3M ratio.",
  },
  {
    id: "hy-oas",
    label: "HY OAS (Credit Spread)",
    value: 3.4,
    band: "warning",
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
    expect(screen.getByTestId("regime-band-vvix").className).not.toContain("bg-up");
    expect(screen.getByTestId("regime-value-vix-term-structure").className).toContain("text-amber");
    expect(screen.getByTestId("regime-band-vix-term-structure").className).toContain("bg-amber");
    expect(screen.getByTestId("regime-value-vix9d-vix").className).toContain("text-down");
    expect(screen.getByTestId("regime-band-vix9d-vix").className).toContain("bg-down");
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
