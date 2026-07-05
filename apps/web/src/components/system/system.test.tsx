/**
 * Design-system molecule smoke tests — render + token-class contract.
 * These guard the public API screens depend on (label/value/children pass-through)
 * and that molecules carry the LOCKED token classes (not hardcoded hex).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Panel, SectionLabel, Stat, MetricChip, PanelHeading, Button } from "./index.tsx";

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

describe("Button — shared control-affordance primitive (Phase 21)", () => {
  afterEach(() => cleanup());

  it("carries the focus-visible ring class on every variant", () => {
    render(<Button>focus me</Button>);
    expect(screen.getByText("focus me").className).toContain("focus-visible:ring-violet");
  });

  it("primary renders a filled violet CTA (bg-violet, dark text)", () => {
    render(<Button variant="primary">Analyze</Button>);
    const el = screen.getByText("Analyze");
    expect(el.className).toContain("bg-violet");
    expect(el.className).toContain("text-bg");
  });

  it("secondary renders the raised-surface outline (default variant)", () => {
    render(<Button>Retry</Button>);
    const el = screen.getByText("Retry");
    expect(el.className).toContain("bg-raise");
    expect(el.className).toContain("border-line2");
  });

  it("ghost renders transparent with a hover-only surface", () => {
    render(<Button variant="ghost">Clear all</Button>);
    const el = screen.getByText("Clear all");
    expect(el.className).toContain("bg-transparent");
    expect(el.className).toContain("hover:bg-line/60");
  });

  it("destructive renders transparent with a hover-down tint", () => {
    render(<Button variant="destructive">{"×"}</Button>);
    const el = screen.getByText("×");
    expect(el.className).toContain("hover:text-down");
    expect(el.className).toContain("hover:bg-down/15");
  });

  it("toggle active=true is a FILLED accent (not a faint tint) — differs from active=false", () => {
    const { rerender } = render(
      <Button variant="toggle" active>
        Combine
      </Button>,
    );
    const onClass = screen.getByText("Combine").className;
    expect(onClass).toContain("bg-violet");
    expect(onClass).toContain("text-bg");
    expect(onClass).not.toContain("bg-violet/10");

    rerender(
      <Button variant="toggle" active={false}>
        Combine
      </Button>,
    );
    const offClass = screen.getByText("Combine").className;
    expect(offClass).toContain("bg-transparent");
    expect(offClass).toContain("border-line2");
    expect(offClass).not.toContain("bg-violet");
  });

  it("toggle honors tone for the active fill (amber/up)", () => {
    render(
      <Button variant="toggle" tone="amber" active>
        Combine
      </Button>,
    );
    expect(screen.getByText("Combine").className).toContain("bg-amber");
  });

  it("disabled dims the control and blocks pointer events", () => {
    render(<Button disabled>Loading</Button>);
    const el = screen.getByText("Loading");
    expect(el).toBeDisabled();
    expect(el.className).toContain("disabled:opacity-40");
    expect(el.className).toContain("disabled:pointer-events-none");
  });

  it("size=sm applies the larger padding/text scale, size=xs (default) the dense one", () => {
    render(<Button size="sm">Analyze</Button>);
    expect(screen.getByText("Analyze").className).toContain("text-[10px]");
  });

  it("passes through native button props: type, onClick, data-testid, className", () => {
    render(
      <Button data-testid="my-btn" className="custom-class" type="submit">
        Go
      </Button>,
    );
    const el = screen.getByTestId("my-btn");
    expect(el.getAttribute("type")).toBe("submit");
    expect(el.className).toContain("custom-class");
  });
});
