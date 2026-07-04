import { Hono } from "hono";
import { pickerSnapshotResponse } from "@morai/contracts";
import type { ForRunningGetPicker } from "@morai/core";

/**
 * pickerRoutes — factory returning a Hono router for GET /picker/candidates.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here.
 * Pattern: call use-case → map Result → parse through contract schema → respond.
 *
 * PICK-02: Returns the latest stored picker snapshot (never recomputed per-request — D-04).
 *
 * Threat mitigations:
 *   T-19-16: errors mapped to flat {error:"internal"} — no DB internals.
 *   T-19-17: no recompute call here — the latest row is the sole source of truth.
 *
 * MCP-02: pickerSnapshotResponse is the single schema source shared by this route and the
 *   get_picker_candidates MCP tool. A one-sided field change fails `bun run typecheck`.
 *
 * D-05: the picker_snapshot row stores the whole response as a JSONB blob, so mapping is a
 *   direct pickerSnapshotResponse.parse(row.snapshot), not a field-by-field reassembly.
 *
 * Mount: in main.ts inside the authenticated apiRouter (same Bearer-token group as
 *   /api/analytics/gex), so the effective path is GET /api/picker/candidates.
 */
export function pickerRoutes(getPicker: ForRunningGetPicker) {
  const router = new Hono();

  router.get("/picker/candidates", async (c) => {
    const result = await getPicker();

    if (!result.ok) {
      // T-19-16: flat error — never expose DB internals (storage-error message hidden).
      return c.json({ error: "internal" }, 500);
    }

    if (result.value === null) {
      // No snapshot computed yet — clean no-data response (D-04/D-18).
      return c.json({ error: "no-snapshot" }, 404);
    }

    // Direct blob parse (D-05) — the row stores the whole response shape already.
    const row = result.value;
    return c.json(pickerSnapshotResponse.parse(row.snapshot));
  });

  return router;
}
