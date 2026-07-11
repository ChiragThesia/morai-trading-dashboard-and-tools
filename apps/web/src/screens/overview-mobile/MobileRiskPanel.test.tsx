/**
 * MobileRiskPanel tests (35.1-02, D-05/D-06/D-09/D-13) — J6/J7 from 35.1-VALIDATION.md,
 * reworked per user UAT feedback 2026-07-11: the control row is `‹ [date pill] ›` + `⋯`
 * only; @ exp joins Fan/Walls/Profit zone in the ⋯ Dialog; the pill opens a Projection
 * dialog (quick chips + day slider + exact date input). The component is fully
 * controlled: every test passes a props fixture and asserts row/dialog behavior, the
 * full-bleed chart section, and the single worst-of freshness caption.
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

const PROJECTED = {
  ...BASE.dateControl,
  dateInputValue: "2026-07-14",
  daysForward: 3,
};

function openOverflowDialog(): void {
  fireEvent.click(screen.getByRole("button", { name: "More chart options" }));
}

function openDateDialog(): void {
  fireEvent.click(screen.getByTestId("date-pill"));
}

describe("MobileRiskPanel — slim row + projection dialog + ⋯ dialog (D-05/D-06/D-09/D-13, J6/J7)", () => {
  it("J6a: ‹ calls stepDate(-1) and › calls stepDate(1)", () => {
    const stepDate = vi.fn();
    render(<MobileRiskPanel {...BASE} dateControl={{ ...BASE.dateControl, stepDate }} />);

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(stepDate).toHaveBeenCalledWith(-1);

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(stepDate).toHaveBeenCalledWith(1);
  });

  it("J6b: the date pill reads `Mon D · today` at offset 0 and `Mon D · +Nd` + violet ring when projected", () => {
    render(<MobileRiskPanel {...BASE} />);
    const pill = screen.getByTestId("date-pill");
    expect(pill.textContent).toBe("Jul 11 · today");
    expect(pill.className).not.toContain("ring-1 ring-violet");

    cleanup();
    render(<MobileRiskPanel {...BASE} dateControl={PROJECTED} />);
    const projectedPill = screen.getByTestId("date-pill");
    expect(projectedPill.textContent).toBe("Jul 14 · +3d");
    expect(projectedPill.className).toContain("ring-1 ring-violet");
  });

  it("row slimming: no native date input and no @ exp button OUTSIDE the dialogs", () => {
    render(<MobileRiskPanel {...BASE} />);
    expect(screen.queryByTestId("date-picker-input")).toBeNull();
    expect(screen.queryByRole("button", { name: "@ exp" })).toBeNull();
  });

  it("J7a: ⋯ opens the Dialog with the Chart heading and @ exp/Fan/Walls/Profit zone — Today moved out", () => {
    render(<MobileRiskPanel {...BASE} />);
    openOverflowDialog();

    expect(screen.getByText("Chart")).toBeDefined();
    for (const label of ["@ exp", "Fan", "Walls", "Profit zone"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
  });

  it("J6c: @ exp (in ⋯) mirrors aria-pressed from toggles.showExpiration and click calls onToggle", () => {
    const onToggle = vi.fn();
    render(<MobileRiskPanel {...BASE} onToggle={onToggle} />);
    openOverflowDialog();

    const btn = screen.getByRole("button", { name: "@ exp" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledWith("showExpiration");

    cleanup();
    render(<MobileRiskPanel {...BASE} toggles={{ ...BASE.toggles, showExpiration: false }} />);
    openOverflowDialog();
    expect(screen.getByRole("button", { name: "@ exp" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("J7b: Today lives in the Projection dialog — disabled at today; when projected, clicking calls resetDate", () => {
    render(<MobileRiskPanel {...BASE} />);
    openDateDialog();
    expect(screen.getByText("Projection")).toBeDefined();
    expect(screen.getByRole("button", { name: "Today" }).hasAttribute("disabled")).toBe(true);

    cleanup();
    const resetDate = vi.fn();
    render(<MobileRiskPanel {...BASE} dateControl={{ ...PROJECTED, resetDate }} />);
    openDateDialog();
    const todayBtn = screen.getByRole("button", { name: "Today" });
    expect(todayBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(todayBtn);
    expect(resetDate).toHaveBeenCalled();
  });

  it("J6d: quick chips jump from TODAY — +1w/+2w/+1m/Expiry call setDate with the absolute ISO", () => {
    const setDate = vi.fn();
    render(<MobileRiskPanel {...BASE} dateControl={{ ...BASE.dateControl, setDate }} />);
    openDateDialog();

    fireEvent.click(screen.getByRole("button", { name: "+1w" }));
    expect(setDate).toHaveBeenCalledWith("2026-07-18");

    fireEvent.click(screen.getByRole("button", { name: "+2w" }));
    expect(setDate).toHaveBeenCalledWith("2026-07-25");

    fireEvent.click(screen.getByRole("button", { name: "+1m" }));
    expect(setDate).toHaveBeenCalledWith("2026-08-10");

    fireEvent.click(screen.getByRole("button", { name: "Expiry" }));
    expect(setDate).toHaveBeenCalledWith("2026-08-11");
  });

  it("J6d2: chips past the front expiry are disabled (maxDays 10 → +2w and +1m dead, +1w alive)", () => {
    render(
      <MobileRiskPanel {...BASE} bounds={{ minIso: "2026-07-11", maxIso: "2026-07-21" }} />,
    );
    openDateDialog();

    expect(screen.getByRole("button", { name: "+1w" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "+2w" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "+1m" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Expiry" }).hasAttribute("disabled")).toBe(false);
  });

  it("J6e: the day slider spans [0, maxDays], tracks daysForward, and drags to setDate(today + n)", () => {
    const setDate = vi.fn();
    render(<MobileRiskPanel {...BASE} dateControl={{ ...PROJECTED, setDate }} />);
    openDateDialog();

    const slider = screen.getByTestId<HTMLInputElement>("date-slider");
    expect(slider.getAttribute("min")).toBe("0");
    expect(slider.getAttribute("max")).toBe("31");
    expect(slider.value).toBe("3");

    fireEvent.change(slider, { target: { value: "5" } });
    expect(setDate).toHaveBeenCalledWith("2026-07-16");
  });

  it("J6f: the exact date input lives INSIDE the Projection dialog with min/max and calls setDate", () => {
    const setDate = vi.fn();
    render(<MobileRiskPanel {...BASE} dateControl={{ ...BASE.dateControl, setDate }} />);
    openDateDialog();

    const input = screen.getByTestId<HTMLInputElement>("date-picker-input");
    expect(input.getAttribute("min")).toBe("2026-07-11");
    expect(input.getAttribute("max")).toBe("2026-08-11");
    fireEvent.change(input, { target: { value: "2026-07-20" } });
    expect(setDate).toHaveBeenCalledWith("2026-07-20");
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
