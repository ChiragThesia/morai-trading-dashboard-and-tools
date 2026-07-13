/**
 * ReauthWizard.test.tsx — TDD suite for the Phase 37-06 sequential re-auth wizard modal.
 *
 * useReauth is mocked (its own behavior is covered by useReauth.test.ts). consumeCapturedRedirect
 * is also mocked so each test can control whether a "returned from Schwab" auto-resume fires,
 * without touching real browser history/location.
 *
 * Behaviors under test:
 *   1. No captured redirect -> dialog closed by default, opens on the Reconnect trigger, shows
 *      the trader idle step.
 *   2. Auto-resume: a captured redirect + a trader-success exchange auto-advances to the Market
 *      idle step (and the Trader chip stays filled).
 *   3. A per-app failure shows the scoped failure copy + Retry; Retry re-enters that app's idle
 *      step only.
 *   4. Both apps succeeding (sequential mounts, tracked via sessionStorage) reaches the Done
 *      state with both chips filled.
 *   5. No rendered text ever contains the code/state/redirect string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const { mockStartReauth, mockExchangeReauth, mockConsumeCapturedRedirect } = vi.hoisted(() => ({
  mockStartReauth: vi.fn(),
  mockExchangeReauth: vi.fn(),
  mockConsumeCapturedRedirect: vi.fn(),
}));

vi.mock("../hooks/useReauth.ts", () => ({
  useReauth: () => ({ startReauth: mockStartReauth, exchangeReauth: mockExchangeReauth }),
}));

vi.mock("../lib/reauth-callback.ts", () => ({
  consumeCapturedRedirect: mockConsumeCapturedRedirect,
}));

import { ReauthWizard } from "./ReauthWizard.tsx";

const FAKE_REDIRECT = "https://morai.wtf/?code=SECRETCODE123&state=SECRETSTATE456";

describe("ReauthWizard", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockConsumeCapturedRedirect.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("stays closed by default and opens the trader idle step from the Reconnect trigger", () => {
    render(<ReauthWizard />);

    expect(screen.queryByText(/Click Authorize with Schwab/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(screen.getByText("Click Authorize with Schwab to reconnect the trader app.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Authorize with Schwab" })).toBeDefined();
  });

  it("auto-resumes and advances from trader success to the Market idle step, keeping the Trader chip filled", async () => {
    mockConsumeCapturedRedirect.mockReturnValueOnce(FAKE_REDIRECT);
    mockExchangeReauth.mockResolvedValueOnce({ app: "trader", ok: true });

    render(<ReauthWizard />);

    expect(mockExchangeReauth).toHaveBeenCalledWith(FAKE_REDIRECT);

    await waitFor(() => {
      expect(screen.getByText("Click Authorize with Schwab to reconnect the market app.")).toBeDefined();
    });

    const traderChip = screen.getByTestId("reauth-step-chip-trader");
    expect(traderChip.className).toContain("bg-violet");
  });

  it("shows a scoped per-app failure + Retry that re-enters only that app's idle step", async () => {
    mockConsumeCapturedRedirect.mockReturnValueOnce(FAKE_REDIRECT);
    mockExchangeReauth.mockResolvedValueOnce({ app: "trader", ok: false });

    render(<ReauthWizard />);

    await waitFor(() => {
      expect(
        screen.getByText("Trader reconnect failed — Schwab didn't confirm a fresh token."),
      ).toBeDefined();
    });
    const retryButton = screen.getByRole("button", { name: "Retry" });

    fireEvent.click(retryButton);

    expect(screen.getByText("Click Authorize with Schwab to reconnect the trader app.")).toBeDefined();
    expect(screen.queryByText(/reconnect failed/)).toBeNull();
  });

  it("surfaces a failed /start as the inline failure state + Retry, never a silent dead button (WR-01)", async () => {
    mockStartReauth.mockRejectedValueOnce(new Error("start failed"));

    render(<ReauthWizard />);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize with Schwab" }));

    await waitFor(() => {
      expect(
        screen.getByText("Trader reconnect failed — Schwab didn't confirm a fresh token."),
      ).toBeDefined();
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });

  it("reaches the Done state (both chips filled) once market succeeds after trader already completed", async () => {
    // Simulate the cross-redirect persistence: trader already succeeded on a prior page load.
    sessionStorage.setItem("reauth-completed-apps", JSON.stringify(["trader"]));
    mockConsumeCapturedRedirect.mockReturnValueOnce(FAKE_REDIRECT);
    mockExchangeReauth.mockResolvedValueOnce({ app: "market", ok: true });

    render(<ReauthWizard />);

    await waitFor(() => {
      expect(screen.getByText("Reconnected. Live data resumes on the next status check.")).toBeDefined();
    });
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
    expect(screen.getByTestId("reauth-step-chip-trader").className).toContain("bg-violet");
    expect(screen.getByTestId("reauth-step-chip-market").className).toContain("bg-violet");
  });

  it("never renders the code, state, or redirect URL anywhere", async () => {
    mockConsumeCapturedRedirect.mockReturnValueOnce(FAKE_REDIRECT);
    mockExchangeReauth.mockResolvedValueOnce({ app: "trader", ok: true });

    const { container } = render(<ReauthWizard />);

    await waitFor(() => {
      expect(screen.getByText("Click Authorize with Schwab to reconnect the market app.")).toBeDefined();
    });

    expect(container.textContent).not.toContain("SECRETCODE123");
    expect(container.textContent).not.toContain("SECRETSTATE456");
    expect(container.textContent).not.toContain(FAKE_REDIRECT);
  });
});
