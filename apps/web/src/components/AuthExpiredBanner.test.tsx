/**
 * AuthExpiredBanner tests — UI-02 behavior validation.
 *
 * RED-first: written before AuthExpiredBanner.tsx exists.
 * Tests the two required behaviors:
 *   1. Banner renders when tokenFreshness === "AUTH_EXPIRED"
 *   2. Banner renders nothing when tokenFreshness is any non-expired value
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { StatusResponse } from "@morai/contracts";
import { AuthExpiredBanner } from "./AuthExpiredBanner.tsx";

// Mock the useStatus hook — AuthExpiredBanner consumes it for tokenFreshness
vi.mock("../hooks/useStatus.ts", () => ({
  // Using vi.fn() without typed wrapper: useStatus in tests only needs .data read by the component.
  // The full UseQueryResult discriminated union cannot be satisfied without type assertions,
  // so we mock at the vi.fn() level and inject data via mockImplementation at the call site.
  useStatus: vi.fn(),
}));

import { useStatus } from "../hooks/useStatus.ts";

const mockUseStatus = vi.mocked(useStatus);

// Helper: set up the mock to return a specific data value.
// Only `.data` is read by AuthExpiredBanner; all other fields are irrelevant.
function setStatusData(data: StatusResponse | undefined) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUseStatus.mockReturnValue({ data } as ReturnType<typeof useStatus>);
}

// Helper: create a mock status data object with tokenFreshness in the trader slot
function makeStatusData(freshness: "AUTH_EXPIRED" | "fresh" | "stale" | "none_yet"): StatusResponse {
  return {
    db: "ok",
    tokenFreshness: {
      trader: {
        status: freshness,
        expiresAt: null,
        refreshIssuedAt: null,
        lastRefreshError: null,
      },
      market: {
        status: "fresh",
        expiresAt: null,
        refreshIssuedAt: null,
        lastRefreshError: null,
      },
    },
    lastJobRuns: "none yet",
    version: "0.0.1",
    uptime: 42,
  };
}

describe("AuthExpiredBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the locked banner copy when tokenFreshness is AUTH_EXPIRED", () => {
    setStatusData(makeStatusData("AUTH_EXPIRED"));

    render(<AuthExpiredBanner />);

    // The banner must contain the locked AUTH_EXPIRED copy
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/Schwab auth expired/)).toBeDefined();
    expect(screen.getByText(/reconnect/)).toBeDefined();
    // The `auth setup` portion must be in a <code> element
    expect(screen.getByRole("code")).toBeDefined();
    expect(screen.getByRole("code").textContent).toBe("auth setup");
  });

  it("renders nothing (null) when tokenFreshness is fresh", () => {
    setStatusData(makeStatusData("fresh"));

    const { container } = render(<AuthExpiredBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is still loading (data undefined)", () => {
    setStatusData(undefined);

    const { container } = render(<AuthExpiredBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when tokenFreshness is 'none yet' string (pre-setup)", () => {
    setStatusData({
      db: "ok",
      tokenFreshness: "none yet",
      lastJobRuns: "none yet",
      version: "0.0.1",
      uptime: 42,
    });

    const { container } = render(<AuthExpiredBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders no dismiss/close button", () => {
    setStatusData(makeStatusData("AUTH_EXPIRED"));

    render(<AuthExpiredBanner />);
    // No close/dismiss button exists per spec
    expect(screen.queryByRole("button")).toBeNull();
  });
});
