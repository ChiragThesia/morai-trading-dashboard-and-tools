import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { analyzeAdHocCalendarRequest, analyzeAdHocCalendarResponse, pickerSnapshotResponse } from "@morai/contracts";
import type { ForAnalyzingAdHocCalendar, ForRunningGetPicker } from "@morai/core";

/**
 * pickerRoutes — factory returning a Hono router for GET /picker/candidates and
 * POST /picker/analyze.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here.
 * Pattern: call use-case → map Result → parse through contract schema → respond.
 *
 * PICK-02: GET /picker/candidates returns the latest stored picker snapshot (never
 *   recomputed per-request — D-04).
 *
 * D-02 (30-05): POST /picker/analyze scores ONE user-pasted PUT calendar synchronously —
 *   bounded reads (snapshot + gex + events + trailing history), no chain scan, and does NOT
 *   recompute or persist the snapshot (distinct from the GET route's own no-recompute rule,
 *   T-19-17). The request body never carries a client-supplied spot — the use-case derives
 *   spot from the latest stored snapshot.
 *
 * Threat mitigations:
 *   T-19-16 / T-30-16: errors mapped to flat {error:"internal"} — no DB internals.
 *   T-19-17: GET never recomputes — the latest row is the sole source of truth.
 *   T-30-14: analyzeAdHocCalendarRequest is `.strict()` with finite/positive/int checks —
 *     zValidator rejects a malformed body with 400 before this handler runs.
 *   T-30-15: analyzeAdHocCalendarRequest has no `spot` field — a client-supplied spot key
 *     fails `.strict()` parsing (400), never reaches the use-case.
 *
 * MCP-02: pickerSnapshotResponse / analyzeAdHocCalendarRequest / analyzeAdHocCalendarResponse
 *   are the single schema sources shared by these routes and the get_picker_candidates /
 *   analyze_ad_hoc_calendar MCP tools. A one-sided field change fails `bun run typecheck`.
 *
 * D-05: the picker_snapshot row stores the whole response as a JSONB blob, so GET mapping is
 *   a direct pickerSnapshotResponse.parse(row.snapshot), not a field-by-field reassembly.
 *
 * Mount: in main.ts inside the authenticated apiRouter (same Bearer-token group as
 *   /api/analytics/gex), so the effective paths are GET/POST /api/picker/candidates|analyze.
 */
export function pickerRoutes(
  getPicker: ForRunningGetPicker,
  analyzeAdHocCalendar: ForAnalyzingAdHocCalendar,
) {
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

  router.post("/picker/analyze", zValidator("json", analyzeAdHocCalendarRequest), async (c) => {
    const body = c.req.valid("json");
    const result = await analyzeAdHocCalendar(body);

    if (!result.ok) {
      // T-30-16: flat error — never expose DB internals (storage-error message hidden).
      return c.json({ error: "internal" }, 500);
    }

    // Binding #2: both scored:true and scored:false are a 200 — context-unavailable is a
    // documented degradation, never a hard error for the paste flow.
    const analysis = result.value;
    const payload = analysis.scored
      ? { scored: true as const, candidate: analysis.candidate, reason: null }
      : { scored: false as const, candidate: null, reason: analysis.reason };
    return c.json(analyzeAdHocCalendarResponse.parse(payload));
  });

  return router;
}
