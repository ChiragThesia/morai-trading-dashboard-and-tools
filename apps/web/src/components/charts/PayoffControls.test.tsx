/**
 * PayoffControls.test.tsx — TDD RED→GREEN for the shared payoff-graph control strip.
 *
 * ONE component, two mounts (Overview + Analyzer). Presentational + fully controlled:
 * it owns no state — it renders the forward date-projection picker and the series-toggle
 * chips, and calls the handlers its parent passes. Behaviors under test:
 *   - Date row: renders <input type=date> with the given value/min/max; ‹ / › step by ∓1;
 *     Today resets; editing the input emits the raw value.
 *   - Series toggles: one chip per PayoffChartToggles key, reflecting on/off via aria-pressed,
 *     and clicking a chip emits that exact key (never a positional index).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PayoffChartToggles } from "./PayoffChart.tsx";
import { PayoffControls } from "./PayoffControls.tsx";

const ALL_ON: PayoffChartToggles = {
  showFan: true,
  showExpiration: true,
  showWalls: true,
  showProfitZone: true,
};

function renderControls(overrides: Partial<React.ComponentProps<typeof PayoffControls>> = {}) {
  const props: React.ComponentProps<typeof PayoffControls> = {
    dateInputValue: "2026-07-04",
    minIso: "2026-07-04",
    maxIso: "2026-07-25",
    onDateChange: vi.fn(),
    onStepDate: vi.fn(),
    onResetDate: vi.fn(),
    toggles: ALL_ON,
    onToggle: vi.fn(),
    ...overrides,
  };
  render(<PayoffControls {...props} />);
  return props;
}

afterEach(cleanup);

describe("PayoffControls — date projection picker", () => {
  it("renders the date input with the passed value/min/max", () => {
    renderControls();
    const input = screen.getByTestId("date-picker-input");
    expect(input.getAttribute("min")).toBe("2026-07-04");
    expect(input.getAttribute("max")).toBe("2026-07-25");
    if (!(input instanceof HTMLInputElement)) throw new Error("date picker is not an input");
    expect(input.value).toBe("2026-07-04");
  });

  it("steps the date via the ‹ / › buttons", () => {
    const { onStepDate } = renderControls();
    fireEvent.click(screen.getByLabelText("Previous day"));
    fireEvent.click(screen.getByLabelText("Next day"));
    expect(onStepDate).toHaveBeenNthCalledWith(1, -1);
    expect(onStepDate).toHaveBeenNthCalledWith(2, 1);
  });

  it("resets via the Today button", () => {
    const { onResetDate } = renderControls();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onResetDate).toHaveBeenCalledOnce();
  });

  it("emits the raw input value when the date is edited", () => {
    const { onDateChange } = renderControls();
    fireEvent.change(screen.getByTestId("date-picker-input"), {
      target: { value: "2026-07-10" },
    });
    expect(onDateChange).toHaveBeenCalledWith("2026-07-10");
  });
});

describe("PayoffControls — series toggles", () => {
  it("renders one chip per toggle key, reflecting on/off via aria-pressed", () => {
    renderControls({
      toggles: { showFan: false, showExpiration: true, showWalls: false, showProfitZone: true },
    });
    expect(screen.getByTestId("toggle-showFan").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("toggle-showExpiration").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("toggle-showWalls").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("toggle-showProfitZone").getAttribute("aria-pressed")).toBe("true");
  });

  it("emits the exact toggle key on click (never a positional index)", () => {
    const { onToggle } = renderControls();
    fireEvent.click(screen.getByTestId("toggle-showWalls"));
    expect(onToggle).toHaveBeenCalledWith("showWalls");
    fireEvent.click(screen.getByTestId("toggle-showExpiration"));
    expect(onToggle).toHaveBeenNthCalledWith(2, "showExpiration");
  });
});

describe("PayoffControls — mobile chrome (ChipRail + touch buttons)", () => {
  it("wraps the strip in a role=group ChipRail named 'Chart date and series controls'", () => {
    renderControls();
    expect(
      screen.getByRole("group", { name: "Chart date and series controls" }),
    ).toBeDefined();
  });

  it("renders a toggle button at the touch-target height (min-h-11)", () => {
    renderControls();
    expect(screen.getByTestId("toggle-showFan").className).toContain("min-h-11");
  });
});
