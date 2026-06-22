/**
 * computeAnalytics use-case — RED scaffold (Phase 6, Plan 06-01 Task 3).
 *
 * `makeComputeAnalyticsUseCase` is NOT YET IMPLEMENTED — 06-04 (term-structure half) and 06-05
 * (skew/RR half) turn this green. This test RUNS and FAILS for the RIGHT reason (the factory does
 * not exist), seeding the dependency surface the use-case must accept.
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
// RED: this import resolves to a factory that does not exist yet (06-04/06-05 implement it).
import { makeComputeAnalyticsUseCase } from "./computeAnalytics.ts";
import type {
  ForReadingSmileSource,
  ForReadingCalendarSnapshotsForCycle,
  ForWritingSkewObservations,
  ForWritingRiskReversalObservations,
  ForWritingTermStructureObservations,
  ForReadingRiskReversalHistory,
} from "./ports.ts";

// Stub deps — plain functions per the function-type port convention (no mocking framework).
const readSmile: ForReadingSmileSource = async () => ok([]);
const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () => ok([]);
const writeSkew: ForWritingSkewObservations = async () => ok(undefined);
const writeRr: ForWritingRiskReversalObservations = async () => ok(undefined);
const writeTerm: ForWritingTermStructureObservations = async () => ok(undefined);
const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

describe("makeComputeAnalyticsUseCase", () => {
  it("is callable with the full stub dependency surface and returns a runnable use-case", () => {
    const useCase = makeComputeAnalyticsUseCase({
      readSmile,
      readSnapshots,
      writeSkew,
      writeRr,
      writeTerm,
      readRrHistory,
    });
    expect(typeof useCase).toBe("function");
  });
});
