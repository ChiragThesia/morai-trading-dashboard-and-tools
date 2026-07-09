/**
 * backtest.test.ts (Phase 27, Plan 06, Task 2) — unit coverage for the CLI's pure argv
 * parsing (parseBacktestArgs). The rest of backtest.ts is composition-root wiring guarded by
 * import.meta.main and exempt from TDD (tdd.md Scope) — this file only imports the parsing
 * function, so importing it never boots the CLI.
 */

import { describe, it, expect } from "vitest";
import { BACKTEST_MIN_FROM, parseBacktestArgs } from "./backtest.ts";

describe("parseBacktestArgs", () => {
  it("accepts a valid --from/--to range", () => {
    const result = parseBacktestArgs(["--from", "2026-06-12", "--to", "2026-07-09"]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.from).toBe("2026-06-12");
    expect(result.data.to).toBe("2026-07-09");
    expect(result.data.calendar).toBeUndefined();
    expect(result.data.reportOnly).toBe(false);
  });

  it("rejects a malformed calendar date (month rollover)", () => {
    const result = parseBacktestArgs(["--from", "2026-13-40", "--to", "2026-07-09"]);
    expect(result.success).toBe(false);
  });

  it(`rejects a --from earlier than ${BACKTEST_MIN_FROM} (the replayable corpus start)`, () => {
    const result = parseBacktestArgs(["--from", "2026-06-01", "--to", "2026-07-09"]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain(BACKTEST_MIN_FROM);
  });

  it(`accepts --from exactly at ${BACKTEST_MIN_FROM}`, () => {
    const result = parseBacktestArgs(["--from", BACKTEST_MIN_FROM, "--to", "2026-07-09"]);
    expect(result.success).toBe(true);
  });

  it("rejects missing --from/--to entirely", () => {
    const result = parseBacktestArgs([]);
    expect(result.success).toBe(false);
  });

  it("accepts an optional UUID-shaped --calendar and --report-only", () => {
    const result = parseBacktestArgs([
      "--from",
      "2026-06-12",
      "--to",
      "2026-07-09",
      "--calendar",
      "550e8400-e29b-41d4-a716-446655440000",
      "--report-only",
    ]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.calendar).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.data.reportOnly).toBe(true);
  });

  it("rejects a non-UUID-shaped --calendar", () => {
    const result = parseBacktestArgs(["--from", "2026-06-12", "--to", "2026-07-09", "--calendar", "not-a-uuid"]);
    expect(result.success).toBe(false);
  });
});
