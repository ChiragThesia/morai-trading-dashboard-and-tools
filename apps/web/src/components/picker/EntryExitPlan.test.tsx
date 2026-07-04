/**
 * EntryExitPlan.test.tsx — TDD RED for the picker's "Entry / exit plan" card (ANLZ-03, D-01b).
 *
 * Covers the UI-SPEC "Entry/exit plan card" contract: 5 locked rows, target/stop dollar
 * arithmetic (debit×profitTargetPct / debit×stopPct) from `candidate.exitPlan`, formatted
 * manage/close-by dates, and the verbatim footnote.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { PickerCandidate } from "@morai/contracts";
import { EntryExitPlan } from "./EntryExitPlan.tsx";

const CANDIDATES = pickerSnapshotFixture.candidates;

function findCandidate(id: string): PickerCandidate {
  const found = CANDIDATES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`fixture candidate not found: ${id}`);
  return found;
}

/** debit 4627.55, closeByExpiry 2026-07-23, manageShortDte 21. */
const NORMAL = findCandidate("7500-260723-260814");
/** debit 5009.48, closeByExpiry 2026-07-27 — different date to prove the date math isn't hardcoded. */
const OTHER_DATE = findCandidate("7500-260727-260821");
/** Constructed guard candidate: debit is negative (-802.82) — exercises the arithmetic with a
 * negative debit without special-casing (D-06: no candidate's rendering may throw/NaN). */
const GUARD = findCandidate("7450-guard-inverted");

describe("EntryExitPlan — 5 locked rows + arithmetic (ANLZ-03/D-01b)", () => {
  afterEach(cleanup);

  it("renders the 5 locked row labels verbatim", () => {
    render(<EntryExitPlan candidate={NORMAL} />);
    expect(screen.getByText("Debit = max loss")).toBeTruthy();
    expect(screen.getByText("Profit target (+25%)")).toBeTruthy();
    expect(screen.getByText("Stop (−17.5%)")).toBeTruthy();
    expect(screen.getByText("Manage short (21 DTE)")).toBeTruthy();
    expect(screen.getByText("Hard close by")).toBeTruthy();
  });

  it("Debit = max loss shows the candidate's debit", () => {
    render(<EntryExitPlan candidate={NORMAL} />);
    expect(screen.getByTestId("entryexit-value-debit").textContent).toBe("$4628");
  });

  it("Profit target = debit × profitTargetPct (0.25)", () => {
    render(<EntryExitPlan candidate={NORMAL} />);
    expect(screen.getByTestId("entryexit-value-target").textContent).toBe("+$1157");
  });

  it("Stop = debit × stopPct (0.175)", () => {
    render(<EntryExitPlan candidate={NORMAL} />);
    expect(screen.getByTestId("entryexit-value-stop").textContent).toBe("−$810");
  });

  it("recomputes target/stop dollar amounts for a different candidate's debit (not hardcoded)", () => {
    render(<EntryExitPlan candidate={OTHER_DATE} />);
    expect(screen.getByTestId("entryexit-value-target").textContent).toBe("+$1252");
    expect(screen.getByTestId("entryexit-value-stop").textContent).toBe("−$877");
  });

  it("Manage short shows closeByExpiry minus manageShortDte days, formatted", () => {
    render(<EntryExitPlan candidate={NORMAL} />);
    expect(screen.getByTestId("entryexit-value-manage").textContent).toBe("Jul 2");
  });

  it("Manage short date shifts with a different closeByExpiry (not hardcoded)", () => {
    render(<EntryExitPlan candidate={OTHER_DATE} />);
    expect(screen.getByTestId("entryexit-value-manage").textContent).toBe("Jul 6");
  });

  it("Hard close by shows the formatted closeByExpiry date with the '(front expiry)' suffix", () => {
    render(<EntryExitPlan candidate={NORMAL} />);
    expect(screen.getByTestId("entryexit-value-closeby").textContent).toBe("Jul 23 (front expiry)");
  });

  it("handles a negative debit (guard candidate) without throwing or rendering NaN", () => {
    render(<EntryExitPlan candidate={GUARD} />);
    expect(screen.getByTestId("entryexit-value-debit").textContent).toBe("−$803");
    // Target/stop use a fixed +/− sign convention (always gain/always loss) over the
    // |debit|-derived magnitude, so a negative-debit guard candidate never double-negates.
    expect(screen.getByTestId("entryexit-value-target").textContent).toBe("+$201");
    expect(screen.getByTestId("entryexit-value-stop").textContent).toBe("−$140");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("renders the verbatim footnote", () => {
    render(<EntryExitPlan candidate={NORMAL} />);
    expect(
      screen.getByText(
        "Max-loss=debit holds only if closed as a spread by front expiration (European SPX, no early assignment). Targets are tunable defaults, not validated thresholds.",
      ),
    ).toBeTruthy();
  });
});
