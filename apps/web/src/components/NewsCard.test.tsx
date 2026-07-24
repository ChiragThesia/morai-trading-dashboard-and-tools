/**
 * NewsCard.test.tsx — TDD suite for the Market News card (D28).
 *
 * Behaviors under test:
 *   1. No data → empty state with the operator hint (news-empty).
 *   2. Empty array → same empty state.
 *   3. Data → one row per headline (news-row-<id>), headline links out with
 *      target=_blank, null-url rows render plain text, symbols render as tags.
 *   4. At most 15 rows render even when the API returns 50.
 *
 * Mirrors CotCard.test.tsx: the data hook is mocked; no network.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

const { mockUseNews } = vi.hoisted(() => ({ mockUseNews: vi.fn() }));

vi.mock("../hooks/useNews.ts", () => ({ useNews: mockUseNews }));

import { NewsCard } from "./NewsCard.tsx";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ITEM_TAGGED = {
  id: "24843171",
  headline: "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates",
  summary: "Markets retreated after hawkish commentary.",
  source: "benzinga",
  url: "https://www.benzinga.com/markets/24843171",
  symbols: ["SPY", "QQQ"],
  publishedAt: "2026-07-24T13:05:00.000Z",
};

const ITEM_PLAIN = {
  id: "24843200",
  headline: "Crude Rallies On Surprise Inventory Draw",
  summary: "",
  source: "benzinga",
  url: null,
  symbols: [],
  publishedAt: "2026-07-24T13:10:00.000Z",
};

describe("NewsCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the empty state when the hook has no data yet", () => {
    mockUseNews.mockReturnValue({ data: undefined });
    render(<NewsCard />);
    expect(screen.getByTestId("news-empty")).toBeDefined();
  });

  it("renders the empty state when the API returns an empty array", () => {
    mockUseNews.mockReturnValue({ data: [] });
    render(<NewsCard />);
    expect(screen.getByTestId("news-empty")).toBeDefined();
  });

  it("renders one row per headline; tagged row links out in a new tab", () => {
    mockUseNews.mockReturnValue({ data: [ITEM_PLAIN, ITEM_TAGGED] });
    render(<NewsCard />);

    expect(screen.getByTestId("news-card")).toBeDefined();
    expect(screen.getByTestId(`news-row-${ITEM_PLAIN.id}`)).toBeDefined();

    const link: HTMLAnchorElement = screen.getByRole("link", {
      name: ITEM_TAGGED.headline,
    });
    expect(link.href).toBe(ITEM_TAGGED.url);
    expect(link.target).toBe("_blank");

    // Null-url row renders as plain text, not a link.
    expect(
      screen.queryByRole("link", { name: ITEM_PLAIN.headline }),
    ).toBeNull();
    expect(screen.getByText(ITEM_PLAIN.headline)).toBeDefined();

    // Symbol tags render for the tagged row.
    expect(screen.getByText("SPY")).toBeDefined();
    expect(screen.getByText("QQQ")).toBeDefined();
  });

  it("caps the list at 15 rows", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      ...ITEM_PLAIN,
      id: String(i),
      headline: `Headline ${i}`,
    }));
    mockUseNews.mockReturnValue({ data: many });
    render(<NewsCard />);

    const rows = screen.getAllByTestId(/^news-row-/);
    expect(rows).toHaveLength(15);
  });
});
