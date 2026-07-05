/**
 * wipeDerivedFills.test.ts — TDD RED→GREEN for the account-wide fills-side-correction
 * follow-up (journal-pnl-opennetdebit-units debug session, round 3).
 *
 * Regression context: already-backfilled calendars carry fills.side rows written by the
 * OLD (positionEffect-derived) logic, wrong for any sold-to-open/bought-to-close leg. The
 * fills table stores no raw broker JSON, so the true sign is unrecoverable from stored fills
 * alone. Correcting this requires deleting the derived fills/calendar_events/orphan_fills
 * rows so a subsequent backfill-transactions re-ingest (with the fixed adapter) writes fresh,
 * correctly-signed fills instead of no-op'ing against the existing wrong-side rows
 * (writeFills is onConflictDoNothing on the fill id PK).
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { ForWipingDerivedFills, StorageError } from "./ports.ts";
import { makeWipeDerivedFillsUseCase } from "./wipeDerivedFills.ts";

describe("makeWipeDerivedFillsUseCase", () => {
  it("delegates to the wipeDerivedFills port and returns its counts", async () => {
    const wipeDerivedFills: ForWipingDerivedFills = async () =>
      ok({ fillsDeleted: 12, eventsDeleted: 5, orphansDeleted: 2 });

    const useCase = makeWipeDerivedFillsUseCase({ wipeDerivedFills });
    const result = await useCase();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ fillsDeleted: 12, eventsDeleted: 5, orphansDeleted: 2 });
  });

  it("propagates a storage error from the port", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "delete failed" };
    const wipeDerivedFills: ForWipingDerivedFills = async () => err(storageError);

    const useCase = makeWipeDerivedFillsUseCase({ wipeDerivedFills });
    const result = await useCase();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(storageError);
  });

  it("takes no arguments — account-wide, not calendar-scoped (occSymbols are shared across calendars)", async () => {
    let callCount = 0;
    const wipeDerivedFills: ForWipingDerivedFills = async () => {
      callCount += 1;
      return ok({ fillsDeleted: 0, eventsDeleted: 0, orphansDeleted: 0 });
    };

    const useCase = makeWipeDerivedFillsUseCase({ wipeDerivedFills });
    await useCase();

    expect(callCount).toBe(1);
  });
});
