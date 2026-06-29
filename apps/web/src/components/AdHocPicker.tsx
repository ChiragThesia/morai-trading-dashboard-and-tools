/**
 * AdHocPicker — input + AD HOC row for streaming live greeks for any OCC symbol.
 *
 * Lives on the Analyzer screen (Surface 4). Validates via parseOccSymbol before any POST
 * (client-side gate, T-12-06-02). On valid submit: calls subscribeAdHoc
 * (POST /api/stream/subscribe — not a no-op, SC6). The AD HOC row renders live BSM values
 * from liveGreeks once ticks arrive (D-05). Only one ad-hoc symbol active at a time; × clears.
 */
import { useState } from "react";
import { parseOccSymbol } from "@morai/shared";
import { Input } from "./ui/input.tsx";
import { Button } from "./ui/button.tsx";
import { SectionLabel } from "./system/index.tsx";
import { cn } from "@/lib/utils";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";
import type { StreamLiveGreekEvent } from "@morai/contracts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse OCC to a human-readable leg label (e.g. "7400P 06/20/26"). */
function legLabel(occSymbol: string): string {
  const r = parseOccSymbol(occSymbol);
  if (!r.ok) return occSymbol.trim();
  const { strike, type, expiry } = r.value;
  const mo = String(expiry.getMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getDate()).padStart(2, "0");
  const yy = String(expiry.getFullYear()).slice(2);
  return `${strike}${type} ${mo}/${dd}/${yy}`;
}

/** Days to expiry (floor, negative = expired). */
function dteDays(occSymbol: string): number {
  const r = parseOccSymbol(occSymbol);
  if (!r.ok) return 0;
  return Math.floor((r.value.expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** Format a greek value to 4 decimal places with sign. */
function fmtGreek(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(4)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdHocPicker({
  subscribeAdHoc,
  liveGreeks,
  liveStatus,
  adHocSymbol,
  onSetAdHocSymbol,
  onClearAdHoc,
}: {
  subscribeAdHoc: (symbol: string) => Promise<void>;
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  liveStatus: LiveStreamStatus;
  adHocSymbol: string | null;
  onSetAdHocSymbol: (sym: string) => void;
  onClearAdHoc: () => void;
}): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clearHovered, setClearHovered] = useState(false);

  const isStale = liveStatus === "stale" || liveStatus === "reconnecting";

  // Live tick for the subscribed ad-hoc symbol (undefined until first tick arrives)
  const adHocTick = adHocSymbol !== null ? liveGreeks.get(adHocSymbol) : undefined;
  // Key changes each tick → React key trick → re-triggers .live-cell-flash animation
  const adHocTickKey = adHocTick?.ts ?? "";

  const handleSubmit = async (): Promise<void> => {
    const trimmed = inputValue.trim();
    if (trimmed === "") return;

    // Client-side OCC format validation (T-12-06-02 — server re-validates authoritatively)
    const parsed = parseOccSymbol(trimmed);
    if (!parsed.ok) {
      setValidationError(
        "Invalid OCC format — use 21-char Schwab format (e.g. SPX   260620C05000000)",
      );
      return;
    }

    setValidationError(null);
    setSubscribeError(null);
    setIsSubmitting(true);

    try {
      // POST /api/stream/subscribe (SC6 — NOT a no-op; ticks arrive over existing EventSource)
      await subscribeAdHoc(trimmed);
      onSetAdHocSymbol(trimmed);
    } catch {
      // subscribeAdHoc throws StreamSubscribeError on non-2xx
      setSubscribeError("Stream unavailable. Check server status.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClear = (): void => {
    setInputValue("");
    setValidationError(null);
    setSubscribeError(null);
    onClearAdHoc();
  };

  return (
    <div>
      <SectionLabel className="mb-2">Ad-hoc lookup</SectionLabel>

      {/* Input row: OCC text field + "Stream Greeks" submit button */}
      <div className="mb-1.5 flex gap-1.5">
        <div className="relative flex-1">
          <Input
            value={inputValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setInputValue(e.target.value);
              setValidationError(null);
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") { void handleSubmit(); }
            }}
            placeholder="SPX   260620C05000000"
            className={inputValue.length > 0 ? "pr-8" : undefined}
          />
          {inputValue.length > 0 && (
            <button
              onClick={handleClear}
              aria-label="Clear ad-hoc symbol"
              onMouseEnter={() => { setClearHovered(true); }}
              onMouseLeave={() => { setClearHovered(false); }}
              className={cn(
                "absolute top-1/2 right-1 flex min-h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-sm leading-none",
                clearHovered ? "text-txt" : "text-muted-foreground",
              )}
            >
              ×
            </button>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { void handleSubmit(); }}
          disabled={isSubmitting}
          className="min-h-11 self-start"
        >
          Stream Greeks
        </Button>
      </div>

      {/* Validation error (Surface 4 — --color-down, 12px mono, no red border on input) */}
      {validationError !== null && (
        <p className="mt-0.5 mb-1.5 font-mono text-xs leading-[1.4] text-down">
          {validationError}
        </p>
      )}

      {/* Subscribe error */}
      {subscribeError !== null && (
        <p className="mt-0.5 mb-1.5 font-mono text-xs leading-[1.4] text-down">
          {subscribeError}
        </p>
      )}

      {/* Empty state — no ad-hoc symbol active, no error */}
      {adHocSymbol === null && validationError === null && subscribeError === null && (
        <p className="m-0 font-mono text-[10px] text-dim">
          Enter any OCC symbol to stream live greeks.
        </p>
      )}

      {/* AD HOC row — distinct from owned positions (Surface 4) */}
      {adHocSymbol !== null && (
        <div className="mt-1 flex items-start justify-between rounded-[4px] border border-transparent bg-transparent px-2 py-1.5">
          <div className="min-w-0 flex-1">
            {/* Leg label */}
            <div className="mb-0.5 font-mono text-[10px] text-txt">
              {legLabel(adHocSymbol)}
            </div>

            {/* DTE only — no P&L (no position basis for ad-hoc) */}
            <div className="mb-0.5 font-mono text-[10px] text-dim">
              DTE: {dteDays(adHocSymbol)}
            </div>

            {/* Live BSM values from stream — key changes each tick → .live-cell-flash re-triggers */}
            {adHocTick !== undefined ? (
              <div
                key={`adhoc-vals-${adHocTickKey}`}
                className={cn(
                  "live-cell-flash live-cell flex flex-wrap gap-1.5 font-mono text-[10px] tabular-nums",
                  isStale && "stale",
                )}
              >
                <span className={adHocTick.bsmDelta >= 0 ? "text-up" : "text-down"}>
                  Δ {fmtGreek(adHocTick.bsmDelta)}
                </span>
                <span className="text-txt">
                  IV {(adHocTick.bsmIv * 100).toFixed(1)}%
                </span>
                <span className="text-txt">
                  ${adHocTick.mark.toFixed(2)}
                </span>
              </div>
            ) : (
              <div className="font-mono text-[10px] text-dim">
                Waiting for stream data…
              </div>
            )}
          </div>

          {/* AD HOC badge — visually distinct from owned positions (Surface 4) */}
          <span className="mt-0.5 ml-2 shrink-0 rounded-[3px] border border-line bg-raise px-[5px] py-px font-mono text-[10px] text-dim uppercase">
            AD HOC
          </span>
        </div>
      )}
    </div>
  );
}
