/**
 * AuthExpiredBanner tests — UI-02 behavior validation.
 *
 * RED-first: written before AuthExpiredBanner.tsx exists.
 * Tests the two required behaviors:
 *   1. Banner renders when tokenFreshness === "AUTH_EXPIRED"
 *   2. Banner renders nothing when tokenFreshness is any non-expired value
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthExpiredBanner } from "./AuthExpiredBanner.tsx";

// Mock the useStatus hook — AuthExpiredBanner consumes it for tokenFreshness
vi.mock("../hooks/useStatus.ts", () => ({
  useStatus: vi.fn(),
}));

import { useStatus } from "../hooks/useStatus.ts";

// Helper: create a mock status data object with tokenFreshness in the trader slot
function makeStatusData(freshness: "AUTH_EXPIRED" | "fresh" | "stale" | "none_yet") {
  return {
    db: "ok" as const,
    tokenFreshness: {
      trader: {
        status: freshness,
        expiresAt: null,
        refreshIssuedAt: null,
        lastRefreshError: null,
      },
      market: {
        status: "fresh" as const,
        expiresAt: null,
        refreshIssuedAt: null,
        lastRefreshError: null,
      },
    },
    lastJobRuns: "none yet" as const,
    version: "0.0.1",
    uptime: 42,
  };
}

describe("AuthExpiredBanner", () => {
  const mockUseStatus = vi.mocked(useStatus);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders the locked banner copy when tokenFreshness is AUTH_EXPIRED", () => {
    mockUseStatus.mockReturnValue({
      data: makeStatusData("AUTH_EXPIRED"),
      isPending: false,
      isError: false,
      error: null,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      status: "success",
      fetchStatus: "idle",
    } as ReturnType<typeof useStatus>);

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
    mockUseStatus.mockReturnValue({
      data: makeStatusData("fresh"),
      isPending: false,
      isError: false,
      error: null,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      status: "success",
      fetchStatus: "idle",
    } as ReturnType<typeof useStatus>);

    const { container } = render(<AuthExpiredBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is still loading (data undefined)", () => {
    mockUseStatus.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      isSuccess: false,
      isLoading: true,
      isFetching: true,
      isRefetching: false,
      status: "pending",
      fetchStatus: "fetching",
    } as ReturnType<typeof useStatus>);

    const { container } = render(<AuthExpiredBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when tokenFreshness is 'none yet' string (pre-setup)", () => {
    mockUseStatus.mockReturnValue({
      data: {
        db: "ok" as const,
        tokenFreshness: "none yet" as const,
        lastJobRuns: "none yet" as const,
        version: "0.0.1",
        uptime: 42,
      },
      isPending: false,
      isError: false,
      error: null,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      status: "success",
      fetchStatus: "idle",
    } as ReturnType<typeof useStatus>);

    const { container } = render(<AuthExpiredBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders no dismiss/close button", () => {
    mockUseStatus.mockReturnValue({
      data: makeStatusData("AUTH_EXPIRED"),
      isPending: false,
      isError: false,
      error: null,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      status: "success",
      fetchStatus: "idle",
    } as ReturnType<typeof useStatus>);

    render(<AuthExpiredBanner />);
    // No close/dismiss button exists per spec
    expect(screen.queryByRole("button")).toBeNull();
  });
});
