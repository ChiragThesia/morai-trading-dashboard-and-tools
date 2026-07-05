/**
 * LiveStatusBadge.test.tsx — TDD suite for the WATCH-01 3-state badge
 * (20-UI-SPEC.md Color/Copywriting Contract, D-01/D-11/D-17/D-20).
 *
 * Behaviors under test:
 *   1. LIVE / QUIET / STALLED render the exact labels + tokens from 20-UI-SPEC.md.
 *   2. CONNECTING is a copy-only condition (status==='quiet' AND isRth===true AND
 *      !hasReceivedFirstTick) — same visual classes as QUIET, label/tooltip differ.
 *   3. The force-reconnect button renders ONLY in STALLED, calls onReconnect, and
 *      disables + relabels "Reconnecting…" while isReconnecting is true.
 *   4. A malformed/unrecognized status value holds the last-known-good render.
 *   5. Tooltip copy matches the Copywriting Contract per state.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { LiveStatusBadge } from "./LiveStatusBadge.tsx";

afterEach(() => {
  cleanup();
});

type Props = ComponentProps<typeof LiveStatusBadge>;

/** Default props for a well-formed LIVE badge — tests override only what they need. */
function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    status: "live",
    lastTickAt: new Date("2026-07-05T14:31:00Z"),
    isRth: true,
    hasReceivedFirstTick: true,
    isReconnecting: false,
    onReconnect: vi.fn(),
    ...overrides,
  };
}

describe("LiveStatusBadge", () => {
  // ── 1. Three states render the exact labels + tokens ─────────────────────

  it("renders LIVE with the text-up token and a pulsing dot", () => {
    const { container } = render(<LiveStatusBadge {...baseProps({ status: "live" })} />);
    expect(screen.getByText("LIVE")).toBeDefined();
    expect(container.querySelector(".text-up")).not.toBeNull();
    expect(container.querySelector(".live-dot")).not.toBeNull();
  });

  it("renders QUIET with the text-dim token and no dot, when no ping has ever arrived (isRth null)", () => {
    const { container } = render(
      <LiveStatusBadge
        {...baseProps({
          status: "quiet",
          isRth: null,
          hasReceivedFirstTick: false,
          lastTickAt: null,
        })}
      />,
    );
    expect(screen.getByText("QUIET")).toBeDefined();
    expect(container.querySelector(".text-dim")).not.toBeNull();
    expect(container.querySelector(".live-dot")).toBeNull();
  });

  it("renders QUIET with the text-dim token when the market is confirmed closed (isRth false)", () => {
    render(
      <LiveStatusBadge
        {...baseProps({ status: "quiet", isRth: false, hasReceivedFirstTick: false })}
      />,
    );
    expect(screen.getByText("QUIET")).toBeDefined();
  });

  it("renders STALLED with the down/red alarm token (D-20) — never the retired amber token", () => {
    const { container } = render(
      <LiveStatusBadge {...baseProps({ status: "stalled", isRth: true, hasReceivedFirstTick: true })} />,
    );
    expect(screen.getByText("STALLED")).toBeDefined();
    expect(container.querySelector(".text-down")).not.toBeNull();
    expect(container.querySelector(".bg-downd")).not.toBeNull();
    expect(container.querySelector(".ring-down\\/40")).not.toBeNull();
    expect(container.querySelector(".text-amber")).toBeNull();
    expect(container.querySelector(".bg-amber")).toBeNull();
    expect(container.querySelector(".live-dot")).toBeNull();
  });

  // ── 2. CONNECTING copy-only condition (D-11, D-01) ────────────────────────

  it("shows CONNECTING copy under (status==='quiet', isRth===true, !hasReceivedFirstTick) — same classes as QUIET", () => {
    const { container } = render(
      <LiveStatusBadge
        {...baseProps({
          status: "quiet",
          isRth: true,
          hasReceivedFirstTick: false,
          lastTickAt: null,
        })}
      />,
    );
    expect(screen.getByText("CONNECTING")).toBeDefined();
    expect(screen.queryByText("QUIET")).toBeNull();
    // Same visual token as QUIET — CONNECTING is a copy-only distinction, not a 4th
    // status/visual state (D-01).
    expect(container.querySelector(".text-dim")).not.toBeNull();
  });

  it("does NOT show CONNECTING copy when isRth is null (true cold start, before any ping)", () => {
    render(
      <LiveStatusBadge
        {...baseProps({
          status: "quiet",
          isRth: null,
          hasReceivedFirstTick: false,
          lastTickAt: null,
        })}
      />,
    );
    expect(screen.getByText("QUIET")).toBeDefined();
    expect(screen.queryByText("CONNECTING")).toBeNull();
  });

  it("does NOT show CONNECTING copy once a tick has been received (hasReceivedFirstTick true)", () => {
    render(
      <LiveStatusBadge
        {...baseProps({ status: "quiet", isRth: true, hasReceivedFirstTick: true })}
      />,
    );
    expect(screen.getByText("QUIET")).toBeDefined();
    expect(screen.queryByText("CONNECTING")).toBeNull();
  });

  // ── 3. Force-reconnect button (D-17) ───────────────────────────────────────

  it("renders the 'Reconnect now' button only when STALLED, and calls onReconnect on click", () => {
    const onReconnect = vi.fn();
    render(<LiveStatusBadge {...baseProps({ status: "stalled", onReconnect })} />);
    const button = screen.getByRole("button", { name: "Reconnect now" });
    button.click();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("hides the force-reconnect button in every non-STALLED state", () => {
    render(<LiveStatusBadge {...baseProps({ status: "live" })} />);
    expect(screen.queryByRole("button", { name: /reconnect/i })).toBeNull();

    cleanup();
    render(
      <LiveStatusBadge {...baseProps({ status: "quiet", isRth: false, hasReceivedFirstTick: false })} />,
    );
    expect(screen.queryByRole("button", { name: /reconnect/i })).toBeNull();
  });

  it("disables the force-reconnect button and relabels it 'Reconnecting…' while a manual reconnect is in flight", () => {
    render(<LiveStatusBadge {...baseProps({ status: "stalled", isReconnecting: true })} />);
    const button = screen.getByRole("button", { name: "Reconnecting…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Reconnect now")).toBeNull();
  });

  // ── 4. Last-known-good hold on a malformed status value ───────────────────

  it("holds the last-known-good render when an invalid status value is passed", () => {
    const { rerender } = render(<LiveStatusBadge {...baseProps({ status: "live" })} />);
    expect(screen.getByText("LIVE")).toBeDefined();

    rerender(
      <LiveStatusBadge
        // @ts-expect-error intentionally testing runtime defense against a malformed status value
        {...baseProps({ status: "bogus" })}
      />,
    );

    // Holds LIVE — never renders a blank/undefined label.
    expect(screen.getByText("LIVE")).toBeDefined();
  });

  // ── 5. Tooltip copy (20-UI-SPEC.md Copywriting Contract) ──────────────────
  // The base-ui Tooltip only mounts its Popup content once open (hover/focus) — so
  // these tests hover the trigger first and await the portal-mounted content.

  it("STALLED tooltip reads 'No ticks for 20s — your data may be frozen.'", async () => {
    const user = userEvent.setup();
    render(<LiveStatusBadge {...baseProps({ status: "stalled" })} />);
    await user.hover(screen.getByText("STALLED"));
    expect(
      await screen.findByText("No ticks for 20s — your data may be frozen."),
    ).toBeDefined();
  });

  it("CONNECTING tooltip reads 'Waiting for first tick…'", async () => {
    const user = userEvent.setup();
    render(
      <LiveStatusBadge
        {...baseProps({ status: "quiet", isRth: true, hasReceivedFirstTick: false, lastTickAt: null })}
      />,
    );
    await user.hover(screen.getByText("CONNECTING"));
    expect(await screen.findByText("Waiting for first tick…")).toBeDefined();
  });

  it("QUIET tooltip reads 'Market closed — outside regular trading hours.'", async () => {
    const user = userEvent.setup();
    render(
      <LiveStatusBadge
        {...baseProps({ status: "quiet", isRth: false, hasReceivedFirstTick: false, lastTickAt: null })}
      />,
    );
    await user.hover(screen.getByText("QUIET"));
    expect(
      await screen.findByText("Market closed — outside regular trading hours."),
    ).toBeDefined();
  });

  it("LIVE tooltip reads 'Last update: {HH:mm:ss}' (unchanged format)", async () => {
    const user = userEvent.setup();
    render(<LiveStatusBadge {...baseProps({ status: "live", lastTickAt: new Date("2026-07-05T14:31:05Z") })} />);
    await user.hover(screen.getByText("LIVE"));
    // Exact wall-clock text depends on the test runner's local timezone, so assert the
    // stable prefix rather than the full formatted time (matches the existing convention).
    expect(await screen.findByText(/^Last update: \d{2}:\d{2}:\d{2}$/)).toBeDefined();
  });
});
