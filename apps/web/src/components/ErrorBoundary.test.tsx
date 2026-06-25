/**
 * ErrorBoundary.test.tsx — TDD suite for the ErrorBoundary component.
 *
 * Behaviors under test:
 *   1. Renders children when no error occurs.
 *   2. Catches a render error and shows the fallback instead of crashing the tree.
 *   3. Logs the error via console.error.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Component that throws synchronously during render. */
function Bomb({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) {
    throw new Error("test render crash");
  }
  return <div data-testid="child-ok">child rendered</div>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ErrorBoundary", () => {
  // Suppress expected console.error output from React + our boundary
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child-ok")).toBeDefined();
    expect(screen.queryByText(/Something broke/)).toBeNull();
  });

  it("renders the fallback when a child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    // Child must NOT be in DOM
    expect(screen.queryByTestId("child-ok")).toBeNull();
    // Fallback must appear
    expect(screen.getByText(/Something broke on this screen/)).toBeDefined();
  });

  it("logs the error via console.error when a child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    // At least one console.error call should include the thrown error
    const calls = consoleErrorSpy.mock.calls;
    const hasErrorLog = calls.some((args) =>
      args.some((a) => a instanceof Error && a.message === "test render crash"),
    );
    expect(hasErrorLog).toBe(true);
  });
});
