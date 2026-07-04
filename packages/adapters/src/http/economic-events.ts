// economic-events.ts — FRED CPI/NFP `release/dates` client + FOMC seed union (PICK-03, D-12/D-13).
//
// Wave-0 shape spike (Task 1, RESEARCH.md Pitfall 4): before finalizing the Zod schema below,
// this session checked the execution environment for FRED_API_KEY (.env, .env.local,
// .env.example, process.env) — ABSENT in all of them. A live confirmation call to
// `https://api.stlouisfed.org/fred/release/dates` could therefore NOT be issued this session.
// Proceeding on RESEARCH.md's A3 assumed shape (cross-checked via secondary sources, not a live
// response) as the documented fallback:
//
//   GET https://api.stlouisfed.org/fred/release/dates
//     ?release_id=10   (CPI,  RESEARCH.md A1)
//     ?release_id=50   (NFP,  RESEARCH.md A1)
//     &file_type=json&include_release_dates_with_no_data=true&api_key=...
//   Response shape (A3): { release_dates: [{ release_id: number, release_name?: string, date: string }] }
//   — DIFFERENT from series/observations's { observations: [{ date, value }] } shape (fred.ts);
//     a NEW schema is required (Pitfall 4), never a reuse of fred.ts's FredResponseSchema.
//
// If this assumed shape is wrong, the Zod safeParse below fails LOUDLY (→ err, D-17) on the
// first live call rather than silently corrupting data — see 19-04-SUMMARY.md's human-check
// note: the first live cron run must be watched for a parse failure.
