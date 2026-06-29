/**
 * positions-reconciler.test.ts — TDD tests for makeSidecarPositionReconciler
 *
 * RED scaffold: imports from ./positions-reconciler.ts which does not exist yet.
 * Must fail on the unresolved import (TDD red-first, JRNL-02 / STRM-05).
 *
 * Behaviors under test:
 *   - 200 response with valid positions body → ok(ReadonlyArray<ReconciledPosition>)
 *   - 503 AUTH_EXPIRED → err({ kind: "AuthExpired" })
 *   - Non-200 status → err({ kind: "NetworkError" })
 *   - Network error / thrown → err({ kind: "NetworkError" })
 *   - 200 with invalid/unparseable body → err({ kind: "ParseError", detail: ... })
 *   - marketValue can be null (optional field)
 *
 * Pattern: fake fetch injection (mirrors chain-adapter.test.ts — no live sidecar).
 */
import { describe, it, expect } from "vitest";
import { makeSidecarPositionReconciler } from "./positions-reconciler.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_OCC = "SPX   260620C05900000";
const VALID_OCC_2 = "SPX   260620P05900000";

const VALID_POSITIONS_BODY = {
  positions: [
    {
      occSymbol: VALID_OCC,
      longQty: 0,
      shortQty: 2,
      underlyingSymbol: "SPX",
      marketValue: -1800.0,
    },
  ],
  asOf: "2026-06-28T19:00:00.000Z",
};

const MULTI_POSITIONS_BODY = {
  positions: [
    {
      occSymbol: VALID_OCC,
      longQty: 0,
      shortQty: 2,
      underlyingSymbol: "SPX",
      marketValue: -1800.0,
    },
    {
      occSymbol: VALID_OCC_2,
      longQty: 1,
      shortQty: 0,
      underlyingSymbol: "SPX",
      marketValue: null,
    },
  ],
  asOf: "2026-06-28T19:00:00.000Z",
};

// ─── Fake fetch helpers ───────────────────────────────────────────────────────

function makeFakeFetch(body: unknown, status: number): typeof globalThis.fetch {
  return async (_input, _init) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

const networkErrorFetch: typeof globalThis.fetch = async () => {
  throw new Error("ECONNREFUSED: connection refused");
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeSidecarPositionReconciler", () => {
  it("returns ok with a ReadonlyArray of ReconciledPosition on a 200 response", async () => {
    const reconcile = makeSidecarPositionReconciler({
      fetch: makeFakeFetch(VALID_POSITIONS_BODY, 200),
      baseUrl: "http://sidecar.test.internal:8000",
    });

    const result = await reconcile();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");

    expect(result.value).toHaveLength(1);
    const pos = result.value[0];
    expect(pos).toBeDefined();
    if (!pos) throw new Error("Expected at least one position");
    expect(pos.occSymbol).toBe(VALID_OCC);
    expect(pos.longQty).toBe(0);
    expect(pos.shortQty).toBe(2);
    expect(pos.underlyingSymbol).toBe("SPX");
    expect(pos.marketValue).toBe(-1800.0);
  });

  it("handles multiple positions including a null marketValue", async () => {
    const reconcile = makeSidecarPositionReconciler({
      fetch: makeFakeFetch(MULTI_POSITIONS_BODY, 200),
      baseUrl: "http://sidecar.test.internal:8000",
    });

    const result = await reconcile();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");
    expect(result.value).toHaveLength(2);
    const second = result.value[1];
    expect(second?.marketValue).toBeNull();
    expect(second?.longQty).toBe(1);
  });

  it("returns err({ kind: 'AuthExpired' }) on 503 response (AUTH_EXPIRED)", async () => {
    const reconcile = makeSidecarPositionReconciler({
      fetch: makeFakeFetch({ error: "AUTH_EXPIRED" }, 503),
      baseUrl: "http://sidecar.test.internal:8000",
    });

    const result = await reconcile();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err result");
    expect(result.error.kind).toBe("AuthExpired");
  });

  it("returns err({ kind: 'NetworkError' }) on a non-200/non-503 status", async () => {
    const reconcile = makeSidecarPositionReconciler({
      fetch: makeFakeFetch({ detail: "internal server error" }, 500),
      baseUrl: "http://sidecar.test.internal:8000",
    });

    const result = await reconcile();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err result");
    expect(result.error.kind).toBe("NetworkError");
  });

  it("returns err({ kind: 'NetworkError' }) when the fetch throws (connection refused)", async () => {
    const reconcile = makeSidecarPositionReconciler({
      fetch: networkErrorFetch,
      baseUrl: "http://sidecar.test.internal:8000",
    });

    const result = await reconcile();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err result");
    expect(result.error.kind).toBe("NetworkError");
  });

  it("returns err({ kind: 'ParseError' }) when the 200 body does not match the positions schema", async () => {
    const reconcile = makeSidecarPositionReconciler({
      fetch: makeFakeFetch({ unexpected: "shape" }, 200),
      baseUrl: "http://sidecar.test.internal:8000",
    });

    const result = await reconcile();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err result");
    expect(result.error.kind).toBe("ParseError");
  });

  it("calls GET /sidecar/positions (not any other path)", async () => {
    let capturedUrl = "";
    const captureFetch: typeof globalThis.fetch = async (input, _init) => {
      capturedUrl = typeof input === "string" ? input : (input as Request).url;
      return new Response(JSON.stringify(VALID_POSITIONS_BODY), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const reconcile = makeSidecarPositionReconciler({
      fetch: captureFetch,
      baseUrl: "http://sidecar.test.internal:8000",
    });

    await reconcile();
    expect(capturedUrl).toBe("http://sidecar.test.internal:8000/sidecar/positions");
  });
});
