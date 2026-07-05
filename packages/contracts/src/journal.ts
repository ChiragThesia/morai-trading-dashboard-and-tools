import { z } from "zod";

// MCP-02: ONE schema source for both GET /api/journal/:calendarId and MCP get_journal tool (plan 07).
// Both adapters import from here; a one-sided change fails typecheck.

export const snapshotResponse = z.object({
  time: z.string().datetime(),
  calendarId: z.string().uuid(),
  spot: z.string(),
  netMark: z.string(),
  frontMark: z.string(),
  backMark: z.string(),
  frontIv: z.string(),
  backIv: z.string(),
  frontIvRaw: z.string(),
  backIvRaw: z.string(),
  netDelta: z.string(),
  netGamma: z.string(),
  netTheta: z.string(),
  netVega: z.string(),
  termSlope: z.string(),
  dteFront: z.number().int(),
  dteBack: z.number().int(),
  pnlOpen: z.string(),
  source: z.enum(["cboe", "schwab_chain", "computed_only"]),
});

export type SnapshotResponse = z.infer<typeof snapshotResponse>;

export const journalResponse = z.object({
  snapshots: z.array(snapshotResponse),
});

export type JournalResponse = z.infer<typeof journalResponse>;

// MCP-02: ONE schema source for both GET /api/journal/:calendarId/lifecycle and the
// get_journal_lifecycle MCP tool (plan 22-03). Additive-only: extends snapshotResponse with
// the JRNL-01 lifecycle-graph computed fields (forward vol + P&L attribution buckets), never
// modifies snapshotResponse/journalResponse above.
export const lifecycleSnapshotResponse = snapshotResponse.extend({
  /** True when this snapshot is a feed gap (spot="0" or any greek/IV NaN) — D-05 honest data. */
  isGap: z.boolean(),
  /** Implied forward vol (D-02/D-07) — the distinct edge series, not the front-back spread. */
  forwardVol: z.number().nullable(),
  /** Guard tag for forwardVol: "ok" = computed normally, "inverted" = radicand < 0 (null). */
  forwardVolGuard: z.enum(["ok", "inverted"]),
  /** Cumulative theta bucket of the P&L attribution decomposition (D-06). */
  cumTheta: z.number().nullable(),
  /** Cumulative vega bucket of the P&L attribution decomposition (D-06). */
  cumVega: z.number().nullable(),
  /** Cumulative delta+gamma bucket of the P&L attribution decomposition (D-06). */
  cumDeltaGamma: z.number().nullable(),
  /** Cumulative unexplained residual of the P&L attribution decomposition — always shown (D-05). */
  cumResidual: z.number().nullable(),
  /** Provenance marker (SNAP-01, D-12) — surfaced additively so BeatsCard (22-04) can flag
   * event-move snapshots without a second round trip (22-RESEARCH.md Open Question 2). */
  trigger: z.enum(["scheduled", "event-move"]).optional(),
});

export type LifecycleSnapshotResponse = z.infer<typeof lifecycleSnapshotResponse>;

export const lifecycleResponse = z.object({
  snapshots: z.array(lifecycleSnapshotResponse),
});

export type LifecycleResponse = z.infer<typeof lifecycleResponse>;
