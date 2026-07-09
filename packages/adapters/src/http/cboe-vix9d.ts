import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingVix9dQuote, MacroObservationRow, FetchError } from "@morai/core";

// CBOE VIX9D delayed-quotes endpoint (Phase 24, MACRO-02/03, 24-RESEARCH.md verified live).
// Same {timestamp, data: {current_price, close, prev_day_close}} shape as the VVIX adapter
// (cboe-vvix.ts) — FRED does not publish VIX9D (VIX9DCLS 404s), so this clones the VVIX
// adapter with only the URL and seriesId swapped (research Anti-Pattern: CBOE serves only
// 2 series, not worth a parameterized generic fetcher).
const CBOE_VIX9D_URL =
  "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX9D.json";

// ─── Zod schema (adapter-local, not in contracts) ─────────────────────────────

const CboeVix9dDataSchema = z
  .object({
    current_price: z.number().nullable().optional(),
    close: z.number().nullable().optional(),
    prev_day_close: z.number().nullable().optional(),
  })
  .passthrough();

const CboeVix9dResponseSchema = z.object({
  timestamp: z.string(), // "YYYY-MM-DD HH:MM:SS" UTC — same convention as cboe-vvix.ts
  data: CboeVix9dDataSchema,
});

// ─── Adapter factory ─────────────────────────────────────────────────────────

/**
 * makeCboeVix9dAdapter — CBOE VIX9D index-quote driven adapter implementing
 * ForFetchingVix9dQuote (Phase 24, MACRO-02/03).
 *
 * Spot resolution: current_price ?? close ?? prev_day_close (cboe-vvix.ts precedent).
 * date is derived from the top-level UTC timestamp — NOT last_trade_time, whose
 * timezone is unverified (RESEARCH Pitfall 6) — converted to the America/New_York
 * calendar day so late-evening ET runs label the row with the correct trading day
 * (review WR-02: 20:00–24:00 ET is already tomorrow in UTC).
 * Returns the RAW value (no /100, D-14). No fallback — any failure returns err.
 */
export function makeCboeVix9dAdapter(deps: {
  readonly fetch: typeof globalThis.fetch;
  readonly userAgent: string;
}): ForFetchingVix9dQuote {
  return async (): Promise<Result<MacroObservationRow, FetchError>> => {
    let rawBody: unknown;
    try {
      const response = await deps.fetch(CBOE_VIX9D_URL, {
        headers: { "User-Agent": deps.userAgent },
      });
      if (!response.ok) {
        return err({
          kind: "fetch-error",
          message: `CBOE VIX9D returned HTTP ${response.status}`,
        });
      }
      rawBody = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    const parsed = CboeVix9dResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      return err({
        kind: "fetch-error",
        message: `CBOE VIX9D payload parse error: ${parsed.error.message}`,
      });
    }

    const payload = parsed.data;

    // Spot resolution: current_price ?? close ?? prev_day_close (cboe-vvix.ts precedent)
    const spot =
      payload.data.current_price ??
      payload.data.close ??
      payload.data.prev_day_close ??
      null;

    if (spot === null || spot === 0) {
      return err({
        kind: "fetch-error",
        message: "CBOE VIX9D payload missing spot price",
      });
    }

    // CBOE timestamp is UTC (production-verified convention, cboe-vvix.ts precedent).
    // Derive date from the UTC instant — do NOT read last_trade_time (Pitfall 6).
    const observedAt = new Date(payload.timestamp.replace(" ", "T") + "Z");
    if (Number.isNaN(observedAt.getTime())) {
      return err({
        kind: "fetch-error",
        message: `CBOE VIX9D payload unparseable timestamp: ${payload.timestamp}`,
      });
    }

    // Review WR-02: label the row with the ET trading day, not the UTC calendar day.
    // Between 20:00 ET and midnight ET the UTC date is already tomorrow — a UTC slice
    // would store the session's VIX9D under the next day. en-CA formats as "YYYY-MM-DD".
    const etDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(observedAt);

    return ok({
      seriesId: "VIX9D",
      date: etDate,
      value: spot,
      source: "cboe",
    });
  };
}
