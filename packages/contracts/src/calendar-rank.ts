import { z } from "zod";

// Calendar-engine contracts (docs/calendar-engine/spec.mdx §11) — ONE schema source for
// GET /api/calendars/ranked + the rank_calendars MCP tool. A one-sided field change fails
// `bun run typecheck` at apps/server/src/adapters/calendar-rank-dto.ts, which types the
// mapped body as RankedCalendarResponse before parsing it.
//
// A NEW schema, deliberately not a widened pickerCandidate: picker.ts's
// `breakdownEntry.criterion` is a CLOSED enum that blocks new criteria by design, and this
// engine's two terms (fwdEdge / deltaBalance) are not that enum's members.
//
// STRIKE CONVENTION: points, e.g. 7400 — NOT the ×1000 integer chainResponse carries. The
// engine converts once, in domain/cohort.ts, and nothing downstream of it sees ×1000.
//
// CARRY IS AN ENGINE INVARIANT, NOT A RESPONSE FIELD. Every leg in every candidate is priced on
// ONE (r, q) — the carry the stored bsm_iv was inverted at. This response used to carry a
// per-leg `carrySource` and a `defaultCarryExpiries` list, from the days when a solved
// per-expiry carry priced some legs and a flat fallback priced the rest. That is exactly the
// defect that was fixed (domain/cohort.ts scar 4): the two legs of one calendar came out on
// different carry, which moved the delta-neutral strike. With one carry both fields would read
// the same value on every response forever, and a field that cannot vary is not information.
//
// NULL-HONESTY: every field the engine can fail to measure is `.nullable()` here. That is not
// defensive padding — `domain/candidate.ts` returns null rather than a fabricated zero for
// ffStrike, thetaCarry and both vertical skews, and `domain/score.ts` drops a whole term to
// null raw/percentile when the snapshot cannot measure it. A required field here would parse
// every hand-written fixture and throw on the first real snapshot.

// ─── Score breakdown ───────────────────────────────────────────────────────────

/**
 * calendarScoreTerm — one of the three cross-sectionally-ranked terms.
 *
 * `raw` is the metric in its own units so the reader can judge it absolutely; `percentile` is
 * its rank inside this snapshot. Both null when the term was unmeasurable for this candidate
 * or inactive for the whole snapshot — in which case `weight` is 0 and the surviving terms
 * renormalise to 100.
 */
export const calendarScoreTerm = z.object({
  raw: z.number().nullable(),
  percentile: z.number().nullable(),
  weight: z.number(),
  contribution: z.number(),
});

export type CalendarScoreTerm = z.infer<typeof calendarScoreTerm>;

// ─── Per-leg quote ─────────────────────────────────────────────────────────────

/**
 * calendarRankLeg — one priced leg (front or back) as the cohort measured it.
 *
 * `tradeable` rides along rather than being filtered out silently: a candidate only exists
 * when both legs are tradeable, so this field documents the gate rather than gating again.
 */
export const calendarRankLeg = z.object({
  /** Index points, not ×1000. */
  strike: z.number(),
  /** Solved implied vol, decimal. */
  iv: z.number(),
  bid: z.number(),
  ask: z.number(),
  mid: z.number(),
  openInterest: z.number().int(),
  /** Value at the mid above intrinsic — the denominator for normalised theta. */
  extrinsic: z.number(),
  delta: z.number(),
  gamma: z.number(),
  theta: z.number(),
  vega: z.number(),
  tradeable: z.boolean(),
});

export type CalendarRankLeg = z.infer<typeof calendarRankLeg>;

// ─── Ranked candidate ──────────────────────────────────────────────────────────

/**
 * rankedCalendar — one fully-measured, scored calendar.
 *
 * The breakdown is not decoration: a score you cannot decompose is a score you cannot argue
 * with, so every term ships its raw value, its percentile, the weight actually applied and the
 * resulting contribution. The contributions sum to `score`.
 */
export const rankedCalendar = z.object({
  /** SPX = AM-settled third-Friday monthlies, SPXW = PM-settled. Never mixed in one calendar. */
  root: z.enum(["SPX", "SPXW"]),
  /** Index points. */
  strike: z.number(),
  frontExpiration: z.string(),
  backExpiration: z.string(),
  frontDte: z.number().int(),
  backDte: z.number().int(),
  gapDays: z.number().int(),

  score: z.number().min(0).max(100),
  breakdown: z.object({
    fwdEdge: calendarScoreTerm,
    deltaBalance: calendarScoreTerm,
  }),

  // ── Term structure, from each cohort's 50-delta reference IVs ──
  /** Forward vol between the two expiries: what a calendar actually pays for. */
  fwdIv: z.number(),
  /** `backRefIv − fwdIv`, decimal vol — the loss condition's cushion. */
  cushion: z.number(),
  /** `frontRefIv / fwdIv − 1`. The scored signal. */
  ffAtm: z.number(),
  /** `(backRefIv − frontRefIv) / (t_back − t_front)`. Reported, not scored. */
  slope: z.number(),
  frontRefIv: z.number(),
  backRefIv: z.number(),

  // ── At the traded strike. Reported, never scored (skew-contaminated by construction). ──
  /** Per-strike forward factor; null when that strike's own term structure is inverted. */
  ffStrike: z.number().nullable(),
  /** `frontIv − backIv` at this strike: horizontal skew. */
  hSkew: z.number(),
  /** `frontIv − frontAtmIv`; null when the front cohort's ATM strike never solved. */
  vSkewFront: z.number().nullable(),
  /** `backIv − backAtmIv`; null when the back cohort's ATM strike never solved. */
  vSkewBack: z.number().nullable(),
  frontIv: z.number(),
  backIv: z.number(),

  // ── Risk and cost ──
  /** Back minus front, per contract, unscaled: a calendar is short gamma and long vega. */
  net: z.object({
    delta: z.number(),
    gamma: z.number(),
    theta: z.number(),
    vega: z.number(),
  }),
  /** Front's fractional daily decay minus the back's; null when either leg has no extrinsic. */
  thetaCarry: z.number().nullable(),
  /** Entry debit in index points at the fill haircut — never at mid. */
  debit: z.number(),
  /** One-way cost of crossing both legs' spreads, index points. */
  spreadCost: z.number(),

  frontLeg: calendarRankLeg,
  backLeg: calendarRankLeg,
});

export type RankedCalendar = z.infer<typeof rankedCalendar>;

// ─── Response envelope ─────────────────────────────────────────────────────────

/**
 * calendarRankDrops — why would-be candidates never became one, so an empty ranking is
 * explainable rather than mysterious. Mirrors core's `DropReason` union exactly; a new reason
 * has to be added here too, which is the intended friction.
 */
export const calendarRankDrops = z.object({
  "front-dte-floor": z.number().int(),
  "front-dte-ceiling": z.number().int(),
  "back-dte-ceiling": z.number().int(),
  "gap-floor": z.number().int(),
  "root-mismatch": z.number().int(),
  "not-tradeable": z.number().int(),
  "no-iv-legs": z.number().int(),
  "term-inverted": z.number().int(),
  "no-atm-reference": z.number().int(),
});

export type CalendarRankDrops = z.infer<typeof calendarRankDrops>;

/**
 * rankedCalendarResponse — the GET /api/calendars/ranked + rank_calendars response.
 *
 * `asOf` is the newest observation instant the ranked cohort actually carries, not the clock:
 * the result says which snapshot it describes, and the clock is not that.
 */
export const rankedCalendarResponse = z.object({
  /** Full ISO 8601 instant of the chain cohort this ranking was computed from. */
  asOf: z.string().datetime(),
  /**
   * One spot for the whole snapshot; null when no quote carried a usable underlying price.
   * Nullable per this file's NULL-HONESTY rule — `domain/cohort.ts`'s `snapshotSpot` returns
   * null for a gap cycle, and a required field here forced the engine to fabricate a 0.
   */
  spot: z.number().nullable(),
  /** Ranked best-first, capped by the request's limit. */
  candidates: z.array(rankedCalendar),
  /** How many candidates survived every gate, BEFORE the limit was applied. */
  totalCandidates: z.number().int(),
  /** Distinct (root, front, back) expiry pairs that produced at least one candidate. */
  expiryPairs: z.number().int(),
  drops: calendarRankDrops,
  /** Realized vol the VRP term used; null when it could not be computed (term drops out). */
  realizedVol: z.number().nullable(),
  /** Front-leg DTE ceiling actually applied. The 15-day floors are constants, never reported. */
  frontDteMax: z.number().int(),
});

export type RankedCalendarResponse = z.infer<typeof rankedCalendarResponse>;

// ─── Request ───────────────────────────────────────────────────────────────────

/**
 * rankCalendarsQuery — the optional GET /api/calendars/ranked query params, shared by the
 * rank_calendars MCP tool's inputSchema.
 *
 * Every field is optional so the use-case's own defaults (front ceiling 60, limit 25, puts)
 * stay the single source of those numbers. `z.coerce` because HTTP delivers strings.
 *
 * The bounds are trust-boundary validation, not preferences: nothing past 90 DTE is ingested,
 * so a larger ceiling could only mislead, and the limit is capped because a snapshot holds
 * ~2,500 candidates and an unbounded page is an unbounded response.
 *
 * There is deliberately NO field that lowers the 15-day front/gap floors — those are the
 * trader's rule, and a floor a caller can lower is not a rule, it is a default.
 */
export const rankCalendarsQuery = z.object({
  frontDteMax: z.coerce.number().int().positive().max(90).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  contractType: z.enum(["C", "P"]).optional(),
});

export type RankCalendarsQuery = z.infer<typeof rankCalendarsQuery>;
