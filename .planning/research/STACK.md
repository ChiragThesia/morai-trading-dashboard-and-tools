# Technology Stack — v1.2 Additions

**Project:** Morai Trading Dashboard & Tools — v1.2 Trade Picker & Dashboard Redesign
**Researched:** 2026-07-03
**Scope:** ONLY new capabilities for v1.2. Existing locked stack (Bun/Hono/Supabase/Drizzle/
pg-boss/Vitest/Railway, schwab-py sidecar, React/Vite/Tailwind/shadcn) is unchanged and not
re-researched — see `docs/architecture/stack-decisions.md`. (This file supersedes the v1.1
STACK.md that previously lived here — v1.1's sidecar/COT/FRED research is now implemented and
covered by `docs/architecture/stack-decisions.md` + the shipped adapters; nothing here
duplicates or contradicts that.)

**Verdict up front: zero new npm/pip dependencies required for any of the six v1.2 features.**
Every unknown resolves to reusing an existing library, an existing in-house module, or a small
static/config addition.

## Recommended Stack — New Capabilities

### 1. Economic-events adapter (FOMC / CPI / NFP dates)

| Source | Purpose | Why |
|--------|---------|-----|
| FRED `fred/releases/dates` endpoint (`api.stlouisfed.org`) | CPI + NFP (Employment Situation) scheduled release dates, including **future** dates | Already-integrated API — `FRED_API_KEY` is live in prod since Phase 14 (MAC-01/02). JSON, versioned, no scraping. Pass `include_release_dates_with_no_data=true` to get unpublished future dates (default `false` excludes them — the one non-obvious param). `release_id=10` = Consumer Price Index (confirmed). Employment Situation's release_id was not nailed down by web search in this pass — resolve it once via `fred/releases?search_text=Employment+Situation` and hardcode the id as a named constant, same as `DGS3MO`/`VIXCLS` today. |
| Static seed table (checked-in TS/JSON const) | FOMC meeting calendar | The Federal Reserve Board publishes FOMC dates only as an HTML page (`federalreserve.gov/monetarypolicy/fomccalendars.htm`) — **no JSON/ICS feed exists**. FOMC meets 8x/year, dates are announced 12+ months ahead and essentially never move. Scraping HTML for something that changes once a year is worse engineering than an 8-row static table refreshed by hand when the Fed publishes next year's calendar (matches the "static-ish" conclusion `calendar-selection-criteria.md` already reached). |

**Why not X:**
- **A scraper for federalreserve.gov or bls.gov** — fragile (HTML structure risk), and the
  payoff (auto-refresh) doesn't matter for something announced 12+ months in advance. It's
  also worse on failure: BLS delayed/cancelled its Oct 2025 CPI/Employment releases during a
  government shutdown — a scraper would silently break the same week the calendar mattered
  most, while the FRED API surfaces this as a normal "no data yet" case.
- **A paid economic-calendar API/MCP** (Trading Economics, ForexFactory scrapers, Apify
  economic-calendar actors — all surfaced in the research pass) — unnecessary: FRED already
  covers the two release-tracked events (CPI, NFP) for free with a key we already have, and
  FOMC doesn't need a live feed at all.
- **`node-ical` / `ics` parsing libraries** — no ICS feed exists for any of the three events,
  so there's nothing to parse.

**Integration point (mirrors the existing FRED adapter, zero new pattern):**
- `packages/adapters/src/http/fred.ts` already implements `fetchFredSeries` against
  `fred/series/observations` with Zod parsing, `.`-sentinel filtering, and the
  no-key-means-fallback/err split (`makeFredRateAdapter` has a fallback; `makeFredSeriesAdapter`
  does not, per D-09). The new economic-events adapter is the same shape: a new
  `fetchFredReleaseDates` helper hitting `fred/releases/dates`, a new
  `ForFetchingEconomicEvents` port in `packages/core`, an HTTP adapter
  (`packages/adapters/src/http/economic-events.ts`) that calls it for CPI + NFP release ids
  and merges in the static FOMC table, and an in-memory twin
  (`packages/adapters/src/memory/economic-events.ts`) per the mandatory-twin rule.
- **Persistence:** reuse the Drizzle + Postgres migration pattern already used for
  `macro_observations` (`packages/adapters/src/postgres/migrations/0013_macro_observations.sql`)
  — a small `economic_events` table (date, kind: FOMC|CPI|NFP, source). Fetch on a
  low-frequency pg-boss cron (daily is plenty; these dates don't change intraday), the same
  job-scheduling mechanism as `fetch-cot`/`fetch-rates`. No new job infra.
- **No auth needed beyond the existing `FRED_API_KEY`.**

### 2. Charting for redesigned payoff / term-structure / candidate-card UI

**Verdict: no new charting library. `apps/web/package.json` already carries three.**

| Existing library | Version | Already used for |
|---|---|---|
| `@visx/*` (axis, curve, event, gradient, group, scale, shape, tooltip) | ^4.0.0 | Low-level composable SVG charts (React-native, D3 scales under the hood) |
| `echarts` + `echarts-for-react` | ^6.1.0 / ^3.0.6 | Declarative charts (candlestick-style, term structure) |
| `uplot` + `uplot-react` | ^1.6.32 / ^1.2.4 | High-density time-series line charts |

The decided mockups (`mockups/playground-v4.html`, `mockups/overview-v2.html`) render every
chart — payoff diagram, gamma profile, GEX-by-strike bars, term-structure curve with event
markers, breakeven/expected-move overlays — as **hand-rolled inline SVG**
(`document.createElementNS` helpers: `svgEl`, `path`, `txt`), with no charting library at all.
That is direct evidence the redesign's visual complexity does not require a new dependency:
the real build can either (a) port the mockup's SVG-builder functions near-verbatim into React
components (cheapest, matches the approved design pixel-for-pixel), or (b) reimplement the
same shapes with `@visx/shape` + `@visx/scale` (more idiomatic React, same visual output). Both
are zero-new-dependency paths. Candidate-card score bars and breakdown bars (slope / fwd-edge /
GEX-fit / event-adj in playground-v4) are plain CSS width-percentage divs — no library, just
Tailwind, matching the mockup exactly. `@base-ui/react`, `shadcn`, `lucide-react`,
`class-variance-authority`, `tailwind-merge` already cover the component/UI-kit needs (cards,
pills, tags, tabs) the redesign uses.

**Why not X:**
- **Recharts / Chart.js / bare d3 / Highcharts / Nivo** — would be a 4th-5th charting
  dependency for a use case the existing 3 (or plain SVG) already cover; pure bloat.
- **TradingView Lightweight Charts** — attractive for candlestick/OHLC, but v1.2's new charts
  (payoff diagrams, GEX bars, term-structure with event markers) are not OHLC time-series; the
  mockup's plain-SVG approach is simpler and already validated.

### 3. Scenario-engine per-position IV calibration (bisection to live mark)

**Verdict: reuse in-house code, not a new library.**

`packages/core/src/journal/domain/iv-inversion.ts` already implements bisection to invert an
observed option price into an implied vol (used by the journal/BSM pipeline today). The
scenario-engine's "calibrate model IV to the live mark" requirement (visible in
`mockups/overview-v2.html`'s `ivScale` bisection loop: 48 iterations, `lo=0.15/hi=2.5` bracket)
is the same numerical problem — bisect a scale/vol parameter until `modelValue(spot) ==
liveMark` — applied per-position instead of per-chain-quote. Extend or call the existing
`iv-inversion.ts` bisection with a position-level objective function; do not add a numerical
library (e.g. `mathjs`, a root-finding package) for a well-understood monotone bisection that's
already implemented once in this codebase and works.

### 4. Strategy-rules engine (L4) persistence

**Verdict: reuse Drizzle + Postgres, zero new dependency.**

Recording enter/exit/roll rules and which rule fired (attach point `entry_thesis`, D-07 per
PROJECT.md) is a straight append-only audit-table problem, structurally identical to the
existing `macro_observations` / COT tables: a Drizzle migration adding `strategy_rules` (rule
definitions) and `rule_firings` (rule id, calendar id, timestamp, trigger snapshot) under
`packages/adapters/postgres/migrations/`, contract-tested the same way as
`macro-observations.contract.test.ts`. No JSON-rules-engine library (e.g. `json-rules-engine`,
`nools`) is needed — the rule set is small, author-defined, and versioned in TypeScript/SQL,
consistent with the "no hand-edited journal, everything typed and testable" discipline already
in place. A generic rules DSL library would add indirection without buying anything at this
scale (single trader, tens of rules).

### 5. Live-stream stall watchdog

**Verdict: no dependency — a heartbeat comparison against the existing SSE stream.**

The existing live-stream infrastructure (Phase 11-12: `apps/web` SSE client + `apps/server` SSE
fan-out) already ticks on every LEVELONE_OPTION/ACCT_ACTIVITY message. A watchdog is: track
`lastMessageAt`, compare against `Date.now()` on a `setInterval` (or in the `useEffect` that
already owns the `EventSource`), and flip a `STALLED` UI state past a threshold (e.g. 60s with
no tick during RTH). This is a standard-library `setInterval`/timestamp comparison, not a
package. (Memory: "open minor gap: no silent-stall watchdog" from Phase 12 — this is exactly
the gap being closed; no new tooling was flagged as needed there either.)

### 6. Event-triggered supplemental snapshot

**Verdict: reuse the existing pg-boss job pattern, zero new dependency.**

The 30-min RTH snapshot job already exists as a pg-boss job handler in `apps/worker`. An
event-triggered supplemental snapshot is the same job handler enqueued on-demand (e.g. when the
new economic-events fetch detects an unscheduled/surprise event, or a price-move threshold
fires) instead of only on the cron schedule. pg-boss already supports ad-hoc `send()` alongside
`schedule()` (established in Phase 14, CR-01: same-name `boss.schedule()` upserts on
`(name,key)` — the ad-hoc path is a distinct, already-supported pg-boss call, not new
infrastructure).

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Economic events (CPI/NFP) | FRED `releases/dates` API | ForexFactory/Trading-Economics/Apify economic-calendar scrapers | Already have a working, keyed, free FRED integration; scrapers add fragility and (for paid ones) cost for data FRED already exposes |
| Economic events (FOMC) | Static checked-in table, hand-refreshed ~1x/yr | HTML scrape of federalreserve.gov | No structured feed exists; scraping a page that changes once a year is worse than a config file |
| Redesign charts | Existing `@visx/*` / `echarts` / `uplot`, or plain SVG matching the mockups | New library (Recharts, d3, Highcharts, TradingView Lightweight Charts) | Three chart libraries already installed with idle capacity; mockups proved plain SVG suffices |
| IV calibration | Extend `packages/core/.../iv-inversion.ts` bisection | New numerical/root-finding package (`mathjs`, etc.) | Bisection is already implemented in-house and is the right algorithm for a monotone 1-D calibration |
| Rules-engine persistence | New Drizzle tables + migration | Generic rules-engine library (`json-rules-engine`) | Rule set is small and author-defined; a DSL engine adds indirection with no benefit at this scale |
| Stall watchdog | `setInterval` + timestamp diff in existing SSE client | Heartbeat/reconnection library | Trivial with the platform primitive already wrapping the existing `EventSource` |
| Supplemental snapshot | Ad-hoc pg-boss `send()` reusing the existing job handler | New scheduler/queue | pg-boss already installed and already runs this exact handler on a cron |

## Installation

No new packages. If the FOMC static table needs review, it lives as a plain TS/JSON file
inside the new `economic-events` adapter directory — no install step. All other additions are
Drizzle migrations (`bun run migrate`, already a project script) and code in existing packages.

## Sources

- FRED API docs: `fred/releases/dates` (release dates incl. future, via
  `include_release_dates_with_no_data=true`) — https://fred.stlouisfed.org/docs/api/fred/releases_dates.html
- FRED release id 10 = Consumer Price Index — https://fred.stlouisfed.org/release?rid=10
- Federal Reserve Board FOMC meeting calendars (HTML only, no feed) —
  https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- BLS schedule of releases (HTML only, no feed; subject to delay, e.g. Oct 2025 shutdown) —
  https://www.bls.gov/schedule/
- In-repo: `packages/adapters/src/http/fred.ts` (existing FRED adapter pattern to mirror),
  `packages/core/src/journal/domain/iv-inversion.ts` (existing bisection to reuse),
  `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` (migration pattern
  to mirror), `apps/web/package.json` (confirmed existing chart/UI deps),
  `mockups/playground-v4.html`, `mockups/overview-v2.html` (decided designs; confirm SVG-only
  chart implementation and bisection-based IV calibration precedent)

---

*Stack research for: Morai v1.2 — economic-events adapter, dashboard redesign, scenario-engine
IV calibration, strategy-rules engine, stall watchdog, event-triggered snapshot*
*Researched: 2026-07-03*
