/**
 * MobileRiskPanel tests (35.1-02, D-05/D-06/D-09/D-13) — J6/J7 from 35.1-VALIDATION.md.
 * The component is fully controlled: every test passes a props fixture and asserts the
 * ONE control row (‹ date › + @ exp + ⋯ Dialog), the full-bleed chart section, and the
 * single worst-of freshness caption. The real PayoffChart renders (jsdom-safe — the
 * existing Overview.test.tsx renders it unmocked).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PayoffPoint } from "../../lib/scenario-engine.ts";
import { MobileRiskPanel } from "./MobileRiskPanel.tsx";

afterEach(cleanup);

const CURVE: PayoffPoint[] = [
  { spot: 6700, pl: -120 },
  { spot: 6850, pl: 80 },
  { spot: 7000, pl: -110 },
];

const BASE = {
  scenario: { payoffCurve: CURVE, expirationCurve: CURVE },
  payoffDomain: { min: 6700, max: 7000 },
  spot: 6850,
  gex: undefined,
  toggles: { showFan: false, showExpiration: true, showWalls: true, showProfitZone: true },
  onToggle: (): void => {},
  dateControl: {
    dateInputValue: "2026-07-11",
    daysForward: 0,
    setDate: (): void => {},
    stepDate: (): void => {},
    resetDate: (): void => {},
  },
  bounds: { minIso: "2026-07-11", maxIso: "2026-08-11", maxDaysForward: 31 },
  positionSetSignature: "sig",
  excludedFromT0Count: 0,
  freshness: {
    gexFresh: true,
    gexAsOf: "Jul 11, 02:00 PM",
    gexAgeMs: 120_000,
    markFresh: true,
    markAsOf: "Jul 11, 02:03 PM",
    markAgeMs: 60_000,
  },
};

function openOverflowDialog(): void {
  fireEvent.click(screen.getByRole("button", { name: "More chart options" }));
}

describe("MobileRiskPanel — one-row chart chrome + ⋯ dialog (D-05/D-06/D-09/D-13, J6/J7)", () => {
  it("J6a: ‹ calls stepDate(-1) and › calls stepDate(1)", () => {
    const stepDate = vi.fn();
    render(<MobileRiskPanel {...BASE} dateControl={{ ...BASE.dateControl, stepDate }} />);

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(stepDate).toHaveBeenCalledWith(-1);

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(stepDate).toHaveBeenCalledWith(1);
  });

  it("J6b: the date input carries ring-1 ring-violet only when projected (≠ minIso)", () => {
    render(<MobileRiskPanel {...BASE} />);
    expect(screen.getByTestId("date-picker-input").className).not.toContain("ring-1 ring-violet");

    cleanup();
    render(
      <MobileRiskPanel
        {...BASE}
        dateControl={{ ...BASE.dateControl, dateInputValue: "2026-07-14" }}
      />,
    );
    expect(screen.getByTestId("date-picker-input").className).toContain("ring-1 ring-violet");
  });

  it("J6c: @ exp mirrors aria-pressed from toggles.showExpiration and click calls onToggle", () => {
    const onToggle = vi.fn();
    render(<MobileRiskPanel {...BASE} onToggle={onToggle} />);

    const btn = screen.getByRole("button", { name: "@ exp" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledWith("showExpiration");

    cleanup();
    render(
      <MobileRiskPanel {...BASE} toggles={{ ...BASE.toggles, showExpiration: false }} />,
    );
    expect(screen.getByRole("button", { name: "@ exp" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("J7a: ⋯ opens the Dialog with the Chart heading and Today/Fan/Walls/Profit zone buttons", () => {
    render(<MobileRiskPanel {...BASE} />);
    openOverflowDialog();

    expect(screen.getByText("Chart")).toBeDefined();
    for (const label of ["Today", "Fan", "Walls", "Profit zone"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("J7b: Today is disabled at today; when projected, clicking it calls resetDate", () => {
    render(<MobileRiskPanel {...BASE} />);
    openOverflowDialog();
    expect(screen.getByRole("button", { name: "Today" }).hasAttribute("disabled")).toBe(true);

    cleanup();
    const resetDate = vi.fn();
    render(
      <MobileRiskPanel
        {...BASE}
        dateControl={{ ...BASE.dateControl, dateInputValue: "2026-07-14", resetDate }}
      />,
    );
    openOverflowDialog();
    const todayBtn = screen.getByRole("button", { name: "Today" });
    expect(todayBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(todayBtn);
    expect(resetDate).toHaveBeenCalled();
  });

  it("J7c: Fan/Walls/Profit zone call onToggle with their keys and carry aria-pressed from toggles", () => {
    const onToggle = vi.fn();
    render(<MobileRiskPanel {...BASE} onToggle={onToggle} />);
    openOverflowDialog();

    const fan = screen.getByRole("button", { name: "Fan" });
    expect(fan.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(fan);
    expect(onToggle).toHaveBeenCalledWith("showFan");

    const walls = screen.getByRole("button", { name: "Walls" });
    expect(walls.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(walls);
    expect(onToggle).toHaveBeenCalledWith("showWalls");

    const zone = screen.getByRole("button", { name: "Profit zone" });
    expect(zone.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(zone);
    expect(onToggle).toHaveBeenCalledWith("showProfitZone");
  });

  it("D-06/D-13: the chart section mounts and the freshness caption dot is bg-up when BOTH channels are fresh", () => {
    render(<MobileRiskPanel {...BASE} />);

    expect(screen.getByTestId("mobile-payoff")).toBeDefined();

    const caption = screen.getByTestId("mobile-freshness");
    expect(caption.querySelector(".bg-up")).not.toBeNull();
    expect(caption.querySelector(".bg-amber")).toBeNull();
    expect(caption.textContent).toContain("GEX Jul 11, 02:00 PM");
    expect(caption.textContent).toContain("mark Jul 11, 02:03 PM");
  });

  it("D-05: the freshness dot degrades to bg-amber when either channel is stale", () => {
    render(<MobileRiskPanel {...BASE} freshness={{ ...BASE.freshness, markFresh: false }} />);

    const caption = screen.getByTestId("mobile-freshness");
    expect(caption.querySelector(".bg-up")).toBeNull();
    expect(caption.querySelector(".bg-amber")).not.toBeNull();
  });
});
