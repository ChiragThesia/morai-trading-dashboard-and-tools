/**
 * MobileHero tests (35.1-02, D-03) — J3/J4 from 35.1-VALIDATION.md.
 * Pure presentational component: BOOK P&L focal number (32px, sign-colored) +
 * SPX/VIX/regime context line. No mocks needed beyond props.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { signedUsd } from "../../lib/position-format.ts";
import { MobileHero } from "./MobileHero.tsx";

afterEach(cleanup);

const BASE = {
  bookPnl: 1204,
  hasPositions: true,
  spot: 6842.1,
  vix: 14.32,
  regime: "DAMPEN" as const,
  liveStatus: "quiet" as const,
};

describe("MobileHero — hero-first BOOK P&L (D-03, J3/J4)", () => {
  it("J3a: positive book P&L renders signedUsd(bookPnl) with text-up", () => {
    render(<MobileHero {...BASE} />);
    const value = screen.getByTestId("mobile-hero-value");
    expect(value.textContent).toBe(signedUsd(1204));
    expect(value.className).toContain("text-up");
  });

  it("J3b: negative book P&L renders with text-down", () => {
    render(<MobileHero {...BASE} bookPnl={-350} />);
    const value = screen.getByTestId("mobile-hero-value");
    expect(value.textContent).toBe(signedUsd(-350));
    expect(value.className).toContain("text-down");
  });

  it("J3c: no positions renders — in text-txt with neither sign class", () => {
    render(<MobileHero {...BASE} hasPositions={false} />);
    const value = screen.getByTestId("mobile-hero-value");
    expect(value.textContent).toBe("—");
    expect(value.className).toContain("text-txt");
    expect(value.className).not.toContain("text-up");
    expect(value.className).not.toContain("text-down");
  });

  it("J4a: context line shows SPX 6842.1, VIX 14.32 and a γ DAMPEN segment in text-up", () => {
    render(<MobileHero {...BASE} />);
    const hero = screen.getByTestId("mobile-hero");
    expect(hero.textContent).toContain("SPX 6842.1");
    expect(hero.textContent).toContain("VIX 14.32");
    const regimeSegment = screen.getByText("γ DAMPEN");
    expect(regimeSegment.className).toContain("text-up");
  });

  it("J4a: AMPLIFY regime segment renders in text-down", () => {
    render(<MobileHero {...BASE} regime="AMPLIFY" />);
    const regimeSegment = screen.getByText("γ AMPLIFY");
    expect(regimeSegment.className).toContain("text-down");
  });

  it("J4b: null spot and null vix render — for their segments", () => {
    render(<MobileHero {...BASE} spot={null} vix={null} />);
    const hero = screen.getByTestId("mobile-hero");
    expect(hero.textContent).toContain("SPX —");
    expect(hero.textContent).toContain("VIX —");
  });

  it("LIVE-04: the SPX segment tints text-blue while liveStatus is live (catch #26 honest badge)", () => {
    render(<MobileHero {...BASE} liveStatus="live" />);
    const spotValue = screen.getByText("6842.1");
    expect(spotValue.className).toContain("text-blue");
  });

  it("LIVE-04: the SPX segment stays EOD-styled (text-dim, no live tint) while liveStatus is quiet", () => {
    render(<MobileHero {...BASE} liveStatus="quiet" />);
    const spotValue = screen.getByText("6842.1");
    expect(spotValue.className).toContain("text-dim");
    expect(spotValue.className).not.toContain("text-blue");
  });

  it("J4b: null regime omits the regime segment entirely, including its · separator", () => {
    render(<MobileHero {...BASE} regime={null} />);
    const hero = screen.getByTestId("mobile-hero");
    expect(hero.textContent).not.toContain("γ");
    // Only the single SPX·VIX separator remains — the regime's own · is gone with it.
    const separators = hero.textContent?.match(/·/g) ?? [];
    expect(separators).toHaveLength(1);
  });
});
