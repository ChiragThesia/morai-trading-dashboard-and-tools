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

// ReauthWizard's own machinery (Dialog, useReauth, sessionStorage) is covered by
// ReauthWizard.test.tsx — here we only need its Reconnect trigger button to exist.
vi.mock("./ReauthWizard.tsx", () => ({
  ReauthWizard: () => <button type="button">Reconnect</button>,
}));

import { useStatus } from "../hooks/useStatus.ts";

const mockUseStatus = vi.mocked(useStatus);

// Helper: set up the mock to return a specific data value.
// Only `.data` is read by AuthExpiredBanner; all other fields are irrelevant.
function setStatusData(data: StatusResponse | undefined) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUseStatus.mockReturnValue({ data } as ReturnType<typeof useStatus>);
}

// Helper: create a mock status data object with tokenFreshness in the trader slot.
// refreshExpiresIn is parametrized per-app (both default to null) so amber-state
// tests can drive trader and/or market into the near-expiry window independently.
// marketStatus is parametrized (default "fresh") so market-expiry tests can drive
// the market app to AUTH_EXPIRED independently of trader.
function makeStatusData(
  freshness: "AUTH_EXPIRED" | "fresh" | "stale" | "none_yet",
  refreshExpiresIn: { trader?: number | null; market?: number | null } = {},
  marketStatus: "AUTH_EXPIRED" | "fresh" | "stale" | "none_yet" = "fresh",
): StatusResponse {
  return {
    db: "ok",
    tokenFreshness: {
      trader: {
        status: freshness,
        expiresAt: null,
        refreshIssuedAt: null,
        lastRefreshError: null,
        refreshExpiresIn: refreshExpiresIn.trader ?? null,
      },
      market: {
        status: marketStatus,
        expiresAt: null,
        refreshIssuedAt: null,
        lastRefreshError: null,
        refreshExpiresIn: refreshExpiresIn.market ?? null,
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

  it("renders the locked banner copy + Reconnect button when tokenFreshness is AUTH_EXPIRED", () => {
    setStatusData(makeStatusData("AUTH_EXPIRED"));

    render(<AuthExpiredBanner />);

    // The banner must contain the locked AUTH_EXPIRED copy
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Schwab auth expired. Live data may be stale.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDefined();
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

  it("renders only the Reconnect control, no separate dismiss/close button", () => {
    setStatusData(makeStatusData("AUTH_EXPIRED"));

    render(<AuthExpiredBanner />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Reconnect");
  });

  it("clears the iOS home-indicator safe area on the red branch", () => {
    setStatusData(makeStatusData("AUTH_EXPIRED"));

    render(<AuthExpiredBanner />);

    const style = screen.getByRole("alert").style;
    expect(style.paddingBottom).toContain("env(safe-area-inset-bottom)");
    expect(style.paddingTop).toBe("8px");
    expect(style.paddingLeft).toBe("16px");
    expect(style.paddingRight).toBe("16px");
  });
});

describe("AuthExpiredBanner amber pre-expiry state (AUTH-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders an amber alert + Reconnect button when trader is near-expiry and no app is AUTH_EXPIRED", () => {
    setStatusData(makeStatusData("fresh", { trader: 3600 }));

    render(<AuthExpiredBanner />);

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/expires soon/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDefined();
  });

  it("renders an amber alert for market-only near-expiry (trader fresh)", () => {
    setStatusData(makeStatusData("fresh", { market: 3600 }));

    render(<AuthExpiredBanner />);

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/expires soon/i)).toBeDefined();
  });

  it("renders the red banner (precedence) when AUTH_EXPIRED and near-expiry are both true", () => {
    setStatusData(makeStatusData("AUTH_EXPIRED", { trader: 3600 }));

    render(<AuthExpiredBanner />);

    // Red copy wins — no amber "expires soon" text present.
    expect(screen.getByText(/Schwab auth expired/)).toBeDefined();
    expect(screen.queryByText(/expires soon/i)).toBeNull();
  });

  it("renders nothing when both apps are fresh with refreshExpiresIn null", () => {
    setStatusData(makeStatusData("fresh"));

    const { container } = render(<AuthExpiredBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders only the Reconnect control, no separate dismiss/close button in the amber state", () => {
    setStatusData(makeStatusData("fresh", { trader: 3600 }));

    render(<AuthExpiredBanner />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Reconnect");
  });

  it("clears the iOS home-indicator safe area on the amber branch", () => {
    setStatusData(makeStatusData("fresh", { trader: 3600 }));

    render(<AuthExpiredBanner />);

    const style = screen.getByRole("alert").style;
    expect(style.paddingBottom).toContain("env(safe-area-inset-bottom)");
    expect(style.paddingTop).toBe("8px");
    expect(style.paddingLeft).toBe("16px");
    expect(style.paddingRight).toBe("16px");
  });

  it("shows a banner when market is AUTH_EXPIRED and trader is fresh", () => {
    setStatusData(makeStatusData("fresh", {}, "AUTH_EXPIRED"));

    render(<AuthExpiredBanner />);

    // A market-only expiry must NOT go silent (review WR-02) — the amber
    // surface stays up with market-expiry copy + a Reconnect entry point.
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/market app auth expired/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDefined();
  });

  it("renders the red banner (precedence) when trader and market are both AUTH_EXPIRED", () => {
    setStatusData(makeStatusData("AUTH_EXPIRED", {}, "AUTH_EXPIRED"));

    render(<AuthExpiredBanner />);

    expect(screen.getByText(/Schwab auth expired/)).toBeDefined();
    expect(screen.queryByText(/market app auth expired/i)).toBeNull();
  });
});
