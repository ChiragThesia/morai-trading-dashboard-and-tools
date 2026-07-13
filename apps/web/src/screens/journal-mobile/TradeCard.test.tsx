/**
 * TradeCard.test.tsx — J11 coverage for the dedicated mobile trade card (36 D-11).
 *
 * The card kills the desktop TradeRow's triple affordance (OPEN badge + "open"/P&L
 * status text + history/entry-exit chip). Fully controlled — rendered directly with
 * TradeSummary fixtures; no hooks, no provider.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

import { TradeCard } from "./TradeCard.tsx";
import { fmtDate } from "./useJournalModel.tsx";
import type { TradeSummary } from "./useJournalModel.tsx";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Open trade — closedAt null, realizedPnl "" (nothing realized yet), has snapshots. */
function openTrade(): TradeSummary {
  return {
    id: "trade-open",
    calendarId: "cal-open",
    strike: 7400,
    name: "SPXW 7400P Cal",
    openedAt: "2026-06-20T14:00:00.000Z",
    closedAt: null,
    realizedPnl: "",
    hasSnapshots: true,
  };
}

/** Closed history trade — +395.00, opened/closed on/after Jun-12, has snapshots. */
function closedHistoryTrade(): TradeSummary {
  return {
    id: "trade-hist",
    calendarId: "cal-hist",
    strike: 7350,
    name: "SPXW 7350P Cal",
    openedAt: "2026-06-12T14:00:00.000Z",
    closedAt: "2026-06-27T20:00:00.000Z",
    realizedPnl: "395.00",
    hasSnapshots: true,
  };
}

/** Closed pre-Jun-12 trade — no snapshots, opened+closed before chain start. */
function closedPreJun12Trade(): TradeSummary {
  return {
    id: "trade-pre",
    calendarId: "cal-pre",
    strike: 7375,
    name: "SPXW 7375P Cal",
    openedAt: "2026-05-01T14:00:00.000Z",
    closedAt: "2026-06-01T20:00:00.000Z",
    realizedPnl: "-101.00",
    hasSnapshots: false,
  };
}

/** Closed trade whose realized P&L endpoint gave "" — the em-dash case. */
function closedNoPnlTrade(): TradeSummary {
  return {
    id: "trade-nopnl",
    calendarId: "cal-nopnl",
    strike: 7350,
    name: "SPXW 7350P Cal",
    openedAt: "2026-06-12T14:00:00.000Z",
    closedAt: "2026-06-27T20:00:00.000Z",
    realizedPnl: "",
    hasSnapshots: true,
  };
}

const noop = (): void => undefined;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("TradeCard — J11 (36 D-11)", () => {
  it("J11a open: renders only the OPEN badge — no P&L, no 'open' status text, no history chip", () => {
    render(<TradeCard trade={openTrade()} isSelected={false} tagLabels={[]} onSelect={noop} />);

    const card = screen.getByTestId("trade-card-trade-open");
    const badge = within(card).getByText("OPEN");
    expect(badge.className).toContain("border-cyan/30");
    expect(badge.className).toContain("text-cyan");

    // No focal P&L (no dollar sign anywhere), no standalone "open" status word, no chip.
    expect(within(card).queryByText(/\$/)).toBeNull();
    expect(within(card).queryByText("open")).toBeNull();
    expect(within(card).queryByText("history")).toBeNull();
    expect(within(card).queryByText("entry/exit")).toBeNull();
  });

  it("J11b closed: focal P&L is 16px mono bold sign-colored; negative flips down; '' → em-dash dim", () => {
    const { rerender } = render(
      <TradeCard trade={closedHistoryTrade()} isSelected={false} tagLabels={[]} onSelect={noop} />,
    );
    const pos = screen.getByText("+$395");
    expect(pos.className).toContain("font-mono");
    expect(pos.className).toContain("text-base");
    expect(pos.className).toContain("font-bold");
    expect(pos.className).toContain("tabular-nums");
    expect(pos.className).toContain("text-up");

    rerender(<TradeCard trade={closedPreJun12Trade()} isSelected={false} tagLabels={[]} onSelect={noop} />);
    const neg = screen.getByText("−$101");
    expect(neg.className).toContain("text-down");

    rerender(<TradeCard trade={closedNoPnlTrade()} isSelected={false} tagLabels={[]} onSelect={noop} />);
    const dash = screen.getByText("—");
    expect(dash.className).toContain("text-dim");
  });

  it("J11c meta: closed shows the date range; open shows '· open'; only non-history appends '· entry/exit only'", () => {
    const closed = closedHistoryTrade();
    const { rerender } = render(
      <TradeCard trade={closed} isSelected={false} tagLabels={[]} onSelect={noop} />,
    );
    expect(
      screen.getByText(`${fmtDate(closed.openedAt)} → ${fmtDate(closed.closedAt ?? "")}`),
    ).toBeDefined();
    // history trade does NOT append the suffix
    expect(screen.queryByText(/entry\/exit only/)).toBeNull();

    const open = openTrade();
    rerender(<TradeCard trade={open} isSelected={false} tagLabels={[]} onSelect={noop} />);
    expect(screen.getByText(`${fmtDate(open.openedAt)} · open`)).toBeDefined();

    const pre = closedPreJun12Trade();
    rerender(<TradeCard trade={pre} isSelected={false} tagLabels={[]} onSelect={noop} />);
    expect(
      screen.getByText(
        `${fmtDate(pre.openedAt)} → ${fmtDate(pre.closedAt ?? "")} · entry/exit only`,
      ),
    ).toBeDefined();
  });

  it("J11d select: click / Enter / Space fire onSelect — never gated on hasSnapshots (catch #23)", () => {
    const onSelect = vi.fn();
    render(<TradeCard trade={closedPreJun12Trade()} isSelected={false} tagLabels={[]} onSelect={onSelect} />);

    const card = screen.getByTestId("trade-card-trade-pre");
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });

    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenCalledWith("trade-pre");
  });

  it("J11e selected vs unselected surface classes", () => {
    const { rerender } = render(
      <TradeCard trade={closedHistoryTrade()} isSelected={true} tagLabels={[]} onSelect={noop} />,
    );
    let card = screen.getByTestId("trade-card-trade-hist");
    expect(card.className).toContain("ring-violet");
    expect(card.className).toContain("bg-violetd");

    rerender(<TradeCard trade={closedHistoryTrade()} isSelected={false} tagLabels={[]} onSelect={noop} />);
    card = screen.getByTestId("trade-card-trade-hist");
    expect(card.className).toContain("ring-line");
    expect(card.className).toContain("bg-raise/30");
  });

  it("J11f tags: rule-tags-pill shows only when selected with non-empty labels, comma-joined + title", () => {
    const { rerender } = render(
      <TradeCard
        trade={closedHistoryTrade()}
        isSelected={true}
        tagLabels={["IV skew favorable", "Profit target"]}
        onSelect={noop}
      />,
    );
    const pill = screen.getByTestId("rule-tags-pill");
    expect(pill.textContent).toBe("IV skew favorable, Profit target");
    expect(pill.getAttribute("title")).toBe("IV skew favorable, Profit target");

    // Empty labels → absent even when selected.
    rerender(<TradeCard trade={closedHistoryTrade()} isSelected={true} tagLabels={[]} onSelect={noop} />);
    expect(screen.queryByTestId("rule-tags-pill")).toBeNull();
  });
});
