/**
 * positions-reconciler.ts — Real ForReconcilingPositions over GET /sidecar/positions
 *
 * Implements the ForReconcilingPositions port from @morai/core/streaming.
 * Called on stream connect and reconnect (STRM-05) to send the reconcile event
 * that gives browsers a cold-start baseline.
 *
 * Pattern: mirrors chain-adapter.ts (JRNL-02, D-08):
 *   - fetch-based HTTP adapter (not Drizzle, not Postgres)
 *   - Zod safeParse at the boundary
 *   - AUTH_EXPIRED (503) → err({ kind: "AuthExpired" })
 *   - Non-200/non-503 → err({ kind: "NetworkError" })
 *   - Network throw → err({ kind: "NetworkError" })
 *   - Parse failure → err({ kind: "ParseError", detail })
 *   - 200 success → ok(ReadonlyArray<ReconciledPosition>)
 *
 * The sidecar's trader token is kept fresh by the Phase 11 _trader_token_keepalive
 * background task, so AUTH_EXPIRED should be rare in production.
 *
 * T-12-05-01: no token values logged — only error type names.
 * STRM-04: no Postgres access.
 * Architecture: packages/adapters imports core ports, never the reverse.
 */

import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReconcilingPositions,
  ReconciledPosition,
  StreamReconcileError,
} from "@morai/core";

// ─── Response schema ──────────────────────────────────────────────────────────

const sidecarPositionItemSchema = z.object({
  occSymbol: z.string(),
  longQty: z.number(),
  shortQty: z.number(),
  underlyingSymbol: z.string(),
  marketValue: z.number().nullable(),
});

const sidecarPositionsResponseSchema = z.object({
  positions: z.array(sidecarPositionItemSchema),
  /** asOf ISO-8601 timestamp (must end in "Z" per chain_proxy.py lesson). */
  asOf: z.string().datetime(),
});

// ─── Adapter type + factory ───────────────────────────────────────────────────

export type SidecarPositionReconcilerDeps = {
  /** Base URL of the sidecar service (e.g. http://sidecar.railway.internal:8000). */
  readonly baseUrl: string;
  /** Injectable fetch — defaults to globalThis.fetch; tests inject a fake. */
  readonly fetch: typeof globalThis.fetch;
};

/**
 * makeSidecarPositionReconciler — factory returning a real ForReconcilingPositions
 * implementation backed by GET {baseUrl}/sidecar/positions.
 *
 * @param deps.baseUrl - Sidecar base URL from config.SIDECAR_URL.
 * @param deps.fetch   - Injectable fetch for testing (always inject; never use globalThis directly).
 * @returns ForReconcilingPositions — async function returning Result<ReadonlyArray<ReconciledPosition>, StreamReconcileError>
 */
export function makeSidecarPositionReconciler(
  deps: SidecarPositionReconcilerDeps,
): ForReconcilingPositions {
  return async (): Promise<
    Result<ReadonlyArray<ReconciledPosition>, StreamReconcileError>
  > => {
    let resp: Response;
    try {
      resp = await deps.fetch(`${deps.baseUrl}/sidecar/positions`);
    } catch (e) {
      // Network error (connection refused, DNS failure, etc.)
      // Log type name only — never log error.message (T-12-05-01 / V6 constraint).
      const errName = e instanceof Error ? e.constructor.name : "UnknownError";
      console.error(
        `positions-reconciler: fetch failed — ${errName} (message redacted)`,
      );
      return err({ kind: "NetworkError" });
    }

    if (resp.status === 503) {
      return err({ kind: "AuthExpired" });
    }

    if (!resp.ok) {
      console.error(
        `positions-reconciler: sidecar returned ${resp.status} (body redacted)`,
      );
      return err({ kind: "NetworkError" });
    }

    let rawBody: unknown;
    try {
      rawBody = await resp.json();
    } catch (e) {
      const errName = e instanceof Error ? e.constructor.name : "UnknownError";
      console.error(
        `positions-reconciler: body read failed — ${errName} (message redacted)`,
      );
      return err({ kind: "ParseError", detail: "body read failed" });
    }

    // Zod safeParse at the trust boundary (parse-don't-cast, typescript.md)
    const parsed = sidecarPositionsResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      return err({
        kind: "ParseError",
        detail: `sidecar positions parse error: ${parsed.error.message}`,
      });
    }

    // Map to ReconciledPosition — type flows from z.infer, no as/!/any
    const positions: ReadonlyArray<ReconciledPosition> = parsed.data.positions.map(
      (item) => ({
        occSymbol: item.occSymbol,
        longQty: item.longQty,
        shortQty: item.shortQty,
        underlyingSymbol: item.underlyingSymbol,
        marketValue: item.marketValue,
      }),
    );

    return ok(positions);
  };
}
