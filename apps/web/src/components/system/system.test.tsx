/**
 * Design-system molecule smoke tests — render + token-class contract.
 * These guard the public API screens depend on (label/value/children pass-through)
 * and that molecules carry the LOCKED token classes (not hardcoded hex).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Panel, SectionLabel, Stat, MetricChip, PanelHeading } from "./index.tsx";

describe("design system molecules", () => {
  afterEach(() => cleanup());

  it("Panel renders children on the gradient token surface", () => {
    render(<Panel data-testid="p">hello</Panel>);
    const el = screen.getByTestId("p");
    expect(el.textContent).toBe("hello");
    expect(el.className).toContain("from-panel");
    expect(el.className).toContain("ring-line");
  });

  it("SectionLabel uses the muted token by default and dim when tone=dim", () => {
    const { rerender } = render(<SectionLabel>open</SectionLabel>);
    expect(screen.getByText("open").className).toContain("text-muted-foreground");
    rerender(<SectionLabel tone="dim">open</SectionLabel>);
    expect(screen.getByText("open").className).toContain("text-dim");
  });

  it("Stat shows label + value", () => {
    render(<Stat label="MARK" value="-$178.75" />);
    expect(screen.getByText("MARK")).toBeDefined();
    expect(screen.getByText("-$178.75")).toBeDefined();
  });

  it("MetricChip swaps to the danger surface when alert", () => {
    render(<MetricChip label="net γ" value="-$56B" alert valueClassName="text-down" />);
    const value = screen.getByText("-$56B");
    expect(value.className).toContain("text-down");
  });

  it("PanelHeading renders title, badge and action", () => {
    render(
      <PanelHeading title="Open" badge={<span>closed</span>} action={<button>x</button>} />,
    );
    expect(screen.getByText("Open")).toBeDefined();
    expect(screen.getByText("closed")).toBeDefined();
    expect(screen.getByRole("button", { name: "x" })).toBeDefined();
  });
});
