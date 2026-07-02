import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import type { ForGettingStatus, StatusPayload } from "@morai/core";
import { withRefreshExpiryWarning } from "./refresh-expiry-warner.ts";

// Helper: build a StatusPayload with a given trader/market refreshExpiresIn pair.
function payloadFor(
  trader: number | null,
  market: number | null,
): StatusPayload {
  return {
    db: "ok",
    tokenFreshness: {
      trader: {
        status: "fresh",
        expiresAt: null,
        refreshIssuedAt: null,
        lastRefreshError: null,
        refreshExpiresIn: trader,
      },
      market: {
        status: "fresh",
        expiresAt: null,
        refreshIssuedAt: null,
        lastRefreshError: null,
        refreshExpiresIn: market,
      },
    },
    lastJobRuns: "none yet",
    version: "0.0.1",
    uptime: 42,
  };
}

// Builds a scripted fake getStatus that returns the next payload in `sequence`
// on each call, and a fake warn spy that records every call.
function buildHarness(sequence: readonly StatusPayload[]) {
  let call = 0;
  const messages: string[] = [];
  const warn = (msg: string) => {
    messages.push(msg);
  };
  const fakeGetStatus: ForGettingStatus = async () => {
    const payload = sequence[call];
    call += 1;
    if (payload === undefined) {
      throw new Error("test harness exhausted scripted sequence");
    }
    return ok(payload);
  };
  return { fakeGetStatus, warn, messages };
}

describe("withRefreshExpiryWarning", () => {
  it("warns once on null->non-null, not again while latched, again after re-arm (trader)", async () => {
    const sequence = [
      payloadFor(null, null),
      payloadFor(43200, null),
      payloadFor(40000, null),
      payloadFor(null, null),
      payloadFor(30000, null),
    ];
    const { fakeGetStatus, warn, messages } = buildHarness(sequence);
    const wrapped = withRefreshExpiryWarning(fakeGetStatus, { warn });

    for (const _ of sequence) {
      await wrapped();
    }

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("43200");
    expect(messages[1]).toContain("30000");
  });

  it("tracks trader and market independently — trader crossing does not suppress market", async () => {
    const sequence = [payloadFor(null, null), payloadFor(43200, null), payloadFor(43200, 20000)];
    const { fakeGetStatus, warn, messages } = buildHarness(sequence);
    const wrapped = withRefreshExpiryWarning(fakeGetStatus, { warn });

    for (const _ of sequence) {
      await wrapped();
    }

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("trader");
    expect(messages[0]).toContain("43200");
    expect(messages[1]).toContain("market");
    expect(messages[1]).toContain("20000");
  });

  it("never warns when tokenFreshness is 'none yet'", async () => {
    const noneYetPayload: StatusPayload = {
      db: "ok",
      tokenFreshness: "none yet",
      lastJobRuns: "none yet",
      version: "0.0.1",
      uptime: 1,
    };
    const { fakeGetStatus, warn, messages } = buildHarness([
      noneYetPayload,
      noneYetPayload,
    ]);
    const wrapped = withRefreshExpiryWarning(fakeGetStatus, { warn });

    await wrapped();
    await wrapped();

    expect(messages).toHaveLength(0);
  });

  it("warn message contains appId and seconds, never token/refresh_token material", async () => {
    const { fakeGetStatus, warn, messages } = buildHarness([
      payloadFor(null, null),
      payloadFor(3600, null),
    ]);
    const wrapped = withRefreshExpiryWarning(fakeGetStatus, { warn });

    await wrapped();
    await wrapped();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("trader");
    expect(messages[0]).toContain("3600");
    expect(messages[0]?.toLowerCase()).not.toContain("token");
    expect(messages[0]?.toLowerCase()).not.toContain("refresh_token");
  });

  it("returns the same StatusPayload it received (pure passthrough)", async () => {
    const payload = payloadFor(43200, null);
    const { fakeGetStatus, warn } = buildHarness([payload]);
    const wrapped = withRefreshExpiryWarning(fakeGetStatus, { warn });

    const result = await wrapped();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(payload);
    }
  });

  it("never throws even when the warn callback throws", async () => {
    const sequence = [payloadFor(null, null), payloadFor(3600, null)];
    let call = 0;
    const throwingGetStatus: ForGettingStatus = async () => {
      const payload = sequence[call];
      call += 1;
      if (payload === undefined) {
        throw new Error("exhausted");
      }
      return ok(payload);
    };
    const throwingWarn = () => {
      throw new Error("warn sink is down");
    };
    const wrapped = withRefreshExpiryWarning(throwingGetStatus, {
      warn: throwingWarn,
    });

    await expect(wrapped()).resolves.toBeDefined();
    await expect(wrapped()).resolves.toBeDefined();
  });

  it("defaults to console.warn when no warn dep is injected", async () => {
    const { fakeGetStatus } = buildHarness([payloadFor(43200, null)]);
    const wrapped = withRefreshExpiryWarning(fakeGetStatus);

    await expect(wrapped()).resolves.toBeDefined();
  });
});
