import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingVvixQuote, MacroObservationRow, FetchError } from "@morai/core";

// CBOE VVIX delayed-quotes endpoint (D-15, verified live). Same
// {timestamp, data: {current_price, close, prev_day_close}} shape as the existing
// SPX chain adapter (cboe.ts) — reuse its spot-resolution + UTC-timestamp conventions.
const CBOE_VVIX_URL =
  "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VVIX.json";

// ─── Zod schema (adapter-local, not in contracts) ─────────────────────────────

const CboeVvixDataSchema = z
  .object({
    current_price: z.number().nullable().optional(),
    close: z.number().nullable().optional(),
    prev_day_close: z.number().nullable().optional(),
  })
  .passthrough();

const CboeVvixResponseSchema = z.object({
  timestamp: z.string(), // "YYYY-MM-DD HH:MM:SS" UTC — same convention as cboe.ts
  data: CboeVvixDataSchema,
});

// ─── Adapter factory ─────────────────────────────────────────────────────────

/**
 * makeCboeVvixAdapter — CBOE VVIX index-quote driven adapter implementing
 * ForFetchingVvixQuote (MAC-01, D-03, D-15).
 *
 * Spot resolution: current_price ?? close ?? prev_day_close (cboe.ts precedent).
 * date is derived from the top-level UTC timestamp — NOT last_trade_time, whose
 * timezone is unverified (RESEARCH Pitfall 6) — converted to the America/New_York
 * calendar day so late-evening ET runs label the row with the correct trading day
 * (review WR-02: 20:00–24:00 ET is already tomorrow in UTC).
 * Returns the RAW value (no /100, D-14). No fallback — any failure returns err.
 */
export function makeCboeVvixAdapter(deps: {
  readonly fetch: typeof globalThis.fetch;
  readonly userAgent: string;
}): ForFetchingVvixQuote {
  return async (): Promise<Result<MacroObservationRow, FetchError>> => {
    let rawBody: unknown;
    try {
      const response = await deps.fetch(CBOE_VVIX_URL, {
        headers: { "User-Agent": deps.userAgent },
      });
      if (!response.ok) {
        return err({
          kind: "fetch-error",
          message: `CBOE VVIX returned HTTP ${response.status}`,
        });
      }
      rawBody = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    const parsed = CboeVvixResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      return err({
        kind: "fetch-error",
        message: `CBOE VVIX payload parse error: ${parsed.error.message}`,
      });
    }

    const payload = parsed.data;

    // Spot resolution: current_price ?? close ?? prev_day_close (cboe.ts precedent)
    const spot =
      payload.data.current_price ??
      payload.data.close ??
      payload.data.prev_day_close ??
      null;

    if (spot === null || spot === 0) {
      return err({
        kind: "fetch-error",
        message: "CBOE VVIX payload missing spot price",
      });
    }

    // CBOE timestamp is UTC (production-verified convention, cboe.ts precedent).
    // Derive date from the UTC instant — do NOT read last_trade_time (Pitfall 6).
    const observedAt = new Date(payload.timestamp.replace(" ", "T") + "Z");
    if (Number.isNaN(observedAt.getTime())) {
      return err({
        kind: "fetch-error",
        message: `CBOE VVIX payload unparseable timestamp: ${payload.timestamp}`,
      });
    }

    // Review WR-02: label the row with the ET trading day, not the UTC calendar day.
    // Between 20:00 ET and midnight ET the UTC date is already tomorrow — a UTC slice
    // would store the session's VVIX under the next day. en-CA formats as "YYYY-MM-DD".
    const etDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(observedAt);

    return ok({
      seriesId: "VVIX",
      date: etDate,
      value: spot,
      source: "cboe",
    });
  };
}
