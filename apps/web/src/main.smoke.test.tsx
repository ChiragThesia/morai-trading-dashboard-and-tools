/**
 * RTL smoke test — harness check for jsdom + React Testing Library pipeline.
 * Proves the jsdom environment, React, and @testing-library/react all wire up correctly.
 * This is NOT a product behavior test — it is a test-infra verification.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Probe() {
  return <div data-testid="probe">Morai smoke test</div>;
}

describe("jsdom + RTL smoke", () => {
  it("renders a React element into jsdom and asserts presence", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toBeDefined();
    expect(screen.getByTestId("probe").textContent).toBe("Morai smoke test");
  });
});
