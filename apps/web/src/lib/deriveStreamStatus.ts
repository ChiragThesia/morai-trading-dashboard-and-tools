/**
 * deriveStreamStatus — pure WATCH-01 stream-status derivation (D-01/D-02/D-11).
 *
 * Unified grace-then-escalate timer (RESEARCH Pattern 1): a single elapsed-time
 * model tracks "time since the last valid tick, or connection-attempt start if
 * none yet" and combines it with the server-pushed `isRth` flag. There is no
 * separate "just disconnected" state — disconnection just stops the tick clock,
 * and the same stall threshold covers both "ticks frozen" and "reconnecting with
 * no tick yet".
 *
 * Branch order (locked, do not reorder):
 *   1. isRth === false  -> "quiet"      (market closed — benign, always wins)
 *   2. isRth === null   -> "connecting" (no ping received yet)
 *   3. elapsed < threshold -> "live" (first tick seen) or "connecting" (cold-start grace)
 *   4. elapsed >= threshold -> "stalled" (boundary: exactly == threshold IS stalled)
 *
 * Purity: caller passes `msSinceLastTickOrConnect` — this function MUST NOT call
 * Date.now() internally (mirrors packages/core/src/journal/domain/rth-window.ts's
 * "caller passes now" idiom). No React import — lives in lib/, not hooks/, so it
 * is unit-testable without a DOM/React environment.
 */

export type DerivedStatus = "live" | "quiet" | "connecting" | "stalled";

export function deriveStreamStatus(input: {
  readonly hasReceivedFirstTick: boolean;
  readonly msSinceLastTickOrConnect: number;
  readonly isRth: boolean | null;
  readonly stallThresholdMs: number;
}): DerivedStatus {
  if (input.isRth === false) return "quiet";
  if (input.isRth === null) return "connecting";
  if (input.msSinceLastTickOrConnect < input.stallThresholdMs) {
    return input.hasReceivedFirstTick ? "live" : "connecting";
  }
  return "stalled";
}
