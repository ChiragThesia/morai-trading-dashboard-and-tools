/**
 * ChipRail.test.tsx — TDD RED→GREEN for the shared scroll-snap chip rail primitive.
 *
 * Native CSS scroll-snap below `lg:`, byte-for-byte `flex-wrap` revert at `lg:` — no JS
 * carousel. Behaviors under test: role/aria-label contract, children pass-through, the
 * mobile scroll-snap classes + the four `lg:` revert tokens, and className merge.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChipRail } from "./ChipRail.tsx";

afterEach(() => cleanup());

describe("ChipRail — shared scroll-snap chip rail", () => {
  it("renders a role=group container with the given accessible name", () => {
    render(
      <ChipRail ariaLabel="test rail">
        <span>chip A</span>
        <span>chip B</span>
      </ChipRail>,
    );
    expect(screen.getByRole("group", { name: "test rail" })).toBeDefined();
  });

  it("renders all passed children", () => {
    render(
      <ChipRail ariaLabel="test rail">
        <span>chip A</span>
        <span>chip B</span>
      </ChipRail>,
    );
    expect(screen.getByText("chip A")).toBeDefined();
    expect(screen.getByText("chip B")).toBeDefined();
  });

  it("carries the mobile scroll-snap classes and the lg: flex-wrap revert triplet", () => {
    render(
      <ChipRail ariaLabel="test rail">
        <span>chip A</span>
      </ChipRail>,
    );
    const el = screen.getByRole("group", { name: "test rail" });
    expect(el.className).toContain("snap-x");
    expect(el.className).toContain("overflow-x-auto");
    expect(el.className).toContain("pr-6");
    expect(el.className).toContain("lg:flex-wrap");
    expect(el.className).toContain("lg:overflow-visible");
    expect(el.className).toContain("lg:snap-none");
    expect(el.className).toContain("lg:pr-0");
  });

  it("merges a caller-passed className after the base classes", () => {
    render(
      <ChipRail ariaLabel="test rail" className="lg:hidden">
        <span>chip A</span>
      </ChipRail>,
    );
    const el = screen.getByRole("group", { name: "test rail" });
    expect(el.className).toContain("lg:hidden");
    expect(el.className).toContain("snap-x");
  });
});
