---
phase: 9
slug: web-dashboard-frontend-react-spa-on-hono-rpc
status: approved
shadcn_initialized: false
preset: none
created: 2026-06-23
updated: 2026-06-24
reviewed_at: 2026-06-24
---

# Phase 9 — UI Design Contract

> Visual and interaction contract for the Morai web dashboard (apps/web). Generated from
> five user-approved HTML mockups in `mockups/`. Every design decision below is LOCKED —
> grounded in what the user iterated to and approved. Do not re-litigate palette,
> typography, chart library, or layout choices.
>
> **Update 2026-06-24:** Added Login screen contract (Supabase Auth gate), AUTH_EXPIRED
> status banner, and TanStack Query polling intervals. Fixed heading (was "Phase 8").
> Backend Data Gaps updated to reflect Phase 8 as the delivery vehicle.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui (to be initialized at apps/web scaffold time) |
| Preset | None yet — run `npx shadcn init` inside `apps/web` at scaffold; use shadcn CLI to add components individually |
| Component library | Radix UI primitives (via shadcn) |
| Icon library | lucide-react (shadcn default; no Heroicons, no FontAwesome) |
| Font: display | Space Grotesk (Google Fonts, weights 400/500/600/700) |
| Font: data/mono | JetBrains Mono (Google Fonts, weights 400/500/600/700) |

**Chart library assignments (non-negotiable):**

| Chart type | Library | Rationale |
|------------|---------|-----------|
| Payoff / risk profile | visx (`@visx/shape`, `@visx/gradient`, `@visx/event`) | Multi-curve, gradient fills, crosshair, stable y-axis |
| Greek strips (Δ/Γ/Θ/Vega vs spot) | uPlot | Synced, minimal, high-perf small multiples |
| GEX by-strike bars | Apache ECharts (`echarts-for-react`) | Horizontal bar chart + toggle GEX/OI/Volume |
| P&L heatmap (spot × date) | Apache ECharts | Color-coded grid cells |
| Net dealer gamma profile curve | visx | Gradient fills above/below zero line |
| GEX by-expiry bars | Apache ECharts | Vertical bar chart |
| Equity curve (Journal) | visx | P&L line with area fill |
| Term structure + skew mini | visx | Small chart panels on Overview |

shadcn/ui handles all non-chart chrome: cards, tabs, sliders (`Slider`), segmented buttons
(`ToggleGroup`), `Dialog`, `Input`, `Textarea`, `Badge`, `Tooltip`, `Skeleton`.

---

## Spacing Scale

Declared values (multiples of 4, extracted from mockup CSS):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge padding, inline element gaps |
| sm | 8px | Table cell padding, strip padding, tag padding (2px×6px) |
| md | 16px | Card padding (13px rounded to 16px in Tailwind), gap between market-strip stats |
| lg | 24px | Section row gaps in 12-col grid |
| xl | 32px | Major layout column gaps |
| 2xl | 48px | Page-level wrap padding |
| 3xl | 64px | Not used at this phase |

**Exceptions:** all shipped values are multiples of 4. The mockups use a few odd-pixel
values (11–13px); these round to the nearest grid token below — the grid token is what ships.

- Card internal padding: ships as `p-3` (12px). Mockup's 13px rounds down to 12px.
- Market strip stat pill: ships as `py-1.5 px-3` (6px / 12px). Note: 6px is the one permitted half-step on pills only.
- Header padding: ships as `py-2 px-4` (8px / 16px). Single grid-aligned value, no alternatives.
- Analyzer 3-column gutters: ships as `gap-3` (12px). Mockup's 11px rounds up to 12px.
- Touch targets: minimum 44×44px for all interactive controls (sliders, buttons, checkboxes in position list).

---

## Typography

Exactly **4 shipped size tokens.** The mockups use a spread of raw pixel values
(9–26px); every one rounds to the nearest token below, and the token is what ships.
All interaction-contract references use these token names, never raw px.

| Token | Family | Size | Weight | Line Height | Maps every use of |
|-------|--------|------|--------|-------------|-------------------|
| `label` | JetBrains Mono (data) / Space Grotesk (`h3` headings) | 10px | 400 (data) / 600 (`h3`) | 1.2–1.4 | Card `h3` headings (UPPERCASE, tracking 0.9px), column headers, nav tab labels, badges, tags, stub copy, axis tick labels, sub-labels, notes — all 9–11px mockup uses |
| `body` | JetBrains Mono | 12px | 400 | 1.45 | Table cells, data body text, key-value rows, regime chip values, callout blocks — all 12–13px mockup uses |
| `subhead` | Space Grotesk | 16px | 700 | 1.1 | KPI values, market-strip values, brand logotype, trade headers, position card titles — all 14–18px mockup uses |
| `display` | Space Grotesk | 24px | 700 | 1.0 | Combined P&L readout, realized P&L figure, large regime label — all 22–26px mockup uses |

Two weights only: 400 (regular) and 600/700 (semibold/bold — the heading/display weight).

**Typographic rules:**
- `font-variant-numeric: tabular-nums` on every numeric cell, KPI value, and price display. Use Tailwind `tabular-nums` class globally on `body` and per-element.
- Card section headings: `label` token — `text-[10px] font-semibold uppercase tracking-[0.9px] text-muted`. This is a locked pattern — every `h3` follows it.
- Compact number display: values ≥ $1M render as "$1.2M"; ≥ $1B as "$3.4B"; ≤ $999 as "$47". Never raw large integers in display.
- Signed values: prefix "+" for positive, "−" (U+2212 true minus) or "-" for negative. Color confirms sign.

---

## Color

All colors extracted directly from the mockup `:root` CSS variables (source of truth):

| Token | Hex | CSS var | Role |
|-------|-----|---------|------|
| bg | `#0a0e14` | `--bg` | Page background (60% dominant) |
| panel | `#0f1521` | `--panel` | Card top gradient stop |
| panel2 | `#0c111a` | `--panel2` | Card bottom gradient stop, table row alt |
| raise | `#161d2b` | `--raise` | Active nav tab, hovered elements |
| line | `#1b2433` | `--line` | Card borders, primary dividers |
| line2 | `#27313f` | `--line2` | Secondary dividers, input borders, tag borders |
| faint | `#3a4453` | `--faint` | Waterfall midpoint line |
| txt | `#d6dbe4` | `--txt` | Primary text |
| muted | `#7b8696` | `--muted` | Secondary text, card heading labels |
| dim | `#566273` | `--dim` | Tertiary text, axis labels, notes |
| up (profit/long) | `#26a69a` | `--up` | Profit values, long legs, call side GEX/OI, positive gamma zone bg |
| down (loss/short) | `#ef5350` | `--down` | Loss values, short legs, put side GEX/OI, negative gamma zone bg, destructive |
| violet (accent) | `#a78bfa` | `--violet` | T+0 P&L curve, selected position border, BE·T0 line, vega attribution bar, VI text |
| amber | `#f0b429` | `--amber` | γ-flip level, roll overlay curve, days-forward slider, time attribution bar |
| blue | `#5b9cf6` | `--blue` | Spot price line, spot slider, spot attribution bar |
| cyan | `#22d3ee` | `--cyan` | Net Γ strip curve, term structure mini chart |
| up-dark | `#0e3b36` | `--upd` | Background tint for long/profit zones |
| down-dark | `#3e1f23` | `--downd` | Background tint for loss/short zones |
| violet-dark | `#241d40` | `--violetd` | Selected position background, active segment tint |

**60/30/10 breakdown:**
- 60% dominant: `#0a0e14` (page background) + `#0f1521`/`#0c111a` (card gradient) — the entire canvas
- 30% secondary: `#161d2b` (raised elements, active states), `#1b2433`/`#27313f` (borders, dividers) — structural chrome
- 10% accent: violet (`#a78bfa`) as the primary interactive accent — selected states, T+0 curve, active tab highlights, focus rings; semantic colors (up/down/amber/blue/cyan) reserved for data meaning only

**Accent reserved for:** active tab indicator, selected position row border, T+0 payoff curve, BE·T0 breakeven lines, selected row highlight (journal/positions), focus rings on inputs and sliders, the "+" add position button hover state, "open analyzer →" link text.

**Semantic color rules (data-meaning only, not decorative):**
- `#26a69a` (teal): profit/gain/long/call/positive-gamma — never used for non-data chrome
- `#ef5350` (coral): loss/risk/short/put/negative-gamma/destructive — never used for non-data chrome
- `#f0b429` (amber): γ-flip level, roll simulator overlay, days-forward slider thumb
- `#5b9cf6` (blue): spot price always and only
- `#22d3ee` (cyan): Γ strip curve, term structure sparkline

**Special treatments from mockup:**
- Negative gamma regime stat pill: `border-color: #5a2b2e; background: #180f10` — a blood-dark semantic state, not a general destructive color
- Background radial gradient: `radial-gradient(1100px 560px at 80% -10%, #141b29 0%, rgba(10,14,20,0) 58%), #0a0e14` — apply to `body`, not individual cards
- Card gradient: `linear-gradient(180deg, #0f1521, #0c111a)` on all cards
- Header gradient: `linear-gradient(180deg, rgba(22,29,43,0.55), rgba(10,14,20,0))` — frosted glass effect on sticky header

**Tailwind config tokens:** Map all CSS variables to Tailwind's `theme.colors` and `theme.extend.colors`. Use `bg-panel`, `border-line`, `text-muted`, etc. as utility classes throughout.

---

## Copywriting Contract

### Global elements

| Element | Copy |
|---------|------|
| Brand logotype | MOR**AI** (bold "AI" in violet; exact capitalization) |
| Nav tabs (in order) | Overview · Analyzer · Positions · Journal · Market |
| Market strip: SPX label | SPX |
| Market strip: gamma label | net γ /1% |
| Market strip: flip label | γ flip |
| Market strip: P&L label | book P&L |

### Login screen

| Element | Copy |
|---------|------|
| Page title | Morai |
| Heading | Sign in |
| Sub-heading | Trading dashboard — access restricted to authorized users |
| Email label | Email |
| Email placeholder | you@example.com |
| Password label | Password |
| Submit button | Sign in |
| Error: invalid credentials | Invalid email or password. |
| Error: network failure | Could not reach the server. Check your connection. |

### AUTH_EXPIRED status banner

| Element | Copy |
|---------|------|
| Banner text | Schwab auth expired. Run `auth setup` to reconnect. Live data may be stale. |
| Banner dismiss | — (no dismiss; banner persists until AUTH_EXPIRED clears) |

### Overview screen

| Element | Copy |
|---------|------|
| Open positions card heading | Open positions |
| Open positions action link | open analyzer → |
| Net greeks card heading | Net greeks |
| P&L card heading | P&L |
| P&L card badge | realized YTD |
| Market regime heading | Market regime |
| Market regime badge | dealer gamma |
| Your strike card heading | Your strike vs key levels |
| Volatility heading | Volatility |
| Volatility badge | SPX · live |
| Catalysts heading | Catalysts |
| Catalysts stub badge | ○ needs feed |
| Catalysts stub body | Event calendar not wired — FOMC · CPI · OPEX · jobs — add an economic-calendar feed |
| System health heading | System health |
| System health badge | live |
| Recent activity heading | Recent activity |
| Data range note | Data from 2026-06-12 forward (chain history start). Older trades = entry/exit only. |

### Analyzer screen

| Element | Copy |
|---------|------|
| Positions panel heading | Positions |
| Positions badge | check to combine |
| Paste input placeholder | Paste TOS order… |
| Add from paste button | + add from paste |
| Add blank button | + blank calendar |
| Parse success prefix | Added: {und} {strike}{type}, front {date} ({n}d) / back {date} ({n}d), ×{qty}{debit info} |
| Parse error copy | Could not parse — need 2 expiries, a strike, and PUT/CALL. |
| Scenario panel heading | Scenario |
| Scenario badge | applies to book |
| Spot slider label | SPX spot |
| Days slider label | Days forward |
| Days slider expiry suffix (capped) | · AT front expiry (calendar done) |
| Days slider expiry suffix (normal) | · → front expiry {n}d |
| IV slider label | IV shift (all) |
| Reset button | Reset scenario |
| Roll simulator heading | Roll simulator |
| Roll badge (dynamic) | on {position name} |
| Roll front label | Front out |
| Roll strike label | Roll strike |
| Roll strike options | −100 · same · +100 |
| Roll days options | none · +7 · +14 · +21 |
| Roll status (inactive) | Amber overlay = book with the selected position rolled. |
| Roll status (active) | Rolling {name}: front +{n}d, K {±n}. Amber = book after roll. |
| Chart title | Risk profile |
| Legend: today curve | today |
| Legend: fan curves | +Nd |
| Legend: expiration curve | each@exp |
| Legend: roll overlay | rolled |
| Legend: GEX walls | walls |
| Legend: expiry breakeven | BE exp |
| Legend: T+0 breakeven | BE T+0 |
| P&L readout sub-label | combined · at spot/as-of |
| Heatmap heading | P&L heatmap |
| Heatmap badge format | step {n} · spot×date |
| Heatmap step options | 10s · 25s · 50s · 100s |
| Fit Y button | fit Y |
| Toggle +7/14/21d | +7/14/21d |
| Toggle expiration | expiration |
| Toggle GEX walls | GEX walls |
| Toggle profit zone | profit zone |
| What's moving SPX heading | What's moving SPX |
| GEX bars toggle options | GEX · OI wall · Volume |
| Attribution heading | Why it moves |
| Attribution badge | Δ from now |
| Attribution note | Vega split front/back is the calendar driver. Book combines all checked positions. |
| Book greeks heading | Book greeks |
| Book greeks badge | selected |
| Live position protected tooltip | live position — protected from removal |
| Live position indicator | ●live (teal text) |
| Demo/example position label | ex (dim text) |

### Positions screen

| Element | Copy |
|---------|------|
| Open positions heading | Open |
| Open badge | closed → Journal |
| Why it's moving heading | Why it's moving |
| Why it's moving badge | P&L since yesterday |
| Attribution body text | For a calendar the headline is **vega split** + **theta**, not spot. Net vega can read flat while front and back legs each swing. |
| Position card heading | Position |
| Position badge | per spread |
| KPI labels | Mark · Debit · Unreal · DTE |
| Greeks vs spot heading | Greeks vs spot |
| Greeks vs spot badge | net · current spot marked |
| Strike structure heading | Your strike vs structure |

### Journal screen

| Element | Copy |
|---------|------|
| Trades panel heading | Trades |
| Trades badge | SPXW put calendars |
| Header stats | realized YTD · trades · win rate |
| History available badge (teal) | history |
| Entry/exit only badge (dim) | entry/exit |
| Open trade badge (teal) | OPEN |
| Lifecycle tabs | Running P&L · Price & spot · Greeks |
| Snapshot table heading | Lifecycle |
| Snapshot badge | per snapshot |
| Notes heading | Notes |
| Notes badge | thesis · review |
| Notes placeholder | Entry thesis, management, post-mortem… |
| Pre-history note | no day-by-day (pre Jun-12) |
| Day separator label | {Mon DD} (e.g., "Jun 12") |
| Why it moved heading | Why it moved |

### Market screen

| Element | Copy |
|---------|------|
| Net dealer gamma heading | Net dealer gamma profile |
| Profile badge | full chain · $Bn / 1% vs spot |
| GEX by strike heading | GEX by strike |
| GEX badge | ±260 · live |
| Key levels heading | Key levels |
| Key levels badge | distance to spot |
| GEX by expiry heading | GEX by expiration |
| GEX expiry badge | $Bn · live |
| Regime strip labels | SPX spot · net γ /1% · γ flip (zero-γ) · regime |
| Regime AMPLIFY label | ▼ AMPLIFY |
| Charm/Vanna stub heading | Charm / Vanna |
| Charm/Vanna badge | ○ next |
| Charm/Vanna stub title | Charm & Vanna by strike |
| Charm/Vanna stub body | computable from chain (Δ-drift from time & IV) — same per-strike bar pattern as GEX |
| Intraday flow stub heading | Intraday flow |
| Intraday flow badge | ○ needs denser snapshots |
| Intraday flow stub title | HIRO-style net delta-flow |
| Intraday flow stub body | Δ(delta-notional) between snapshots — 30-min cadence → coarse; finer feed later |

### Empty / loading / error states

| State | Copy |
|-------|------|
| No open positions | No open positions. Register a calendar via the API or paste a TOS order to analyze a scenario. |
| Journal no data | No journal history yet. Trades before Jun 12 have entry/exit only. |
| Chart skeleton label | Loading risk profile… |
| GEX data unavailable | GEX data unavailable — run fetch-chain to populate. |
| AUTH_EXPIRED banner | Schwab auth expired. Run `auth setup` to reconnect. Data may be stale. |
| API error (generic) | Failed to load {screen} data. Check system health. |
| Destructive: remove position | Remove "{name}" from the analyzer? This does not affect your live position. [Remove] [Cancel] |
| Destructive: rebuild journal confirmation | Rebuild journal for "{calendarId}"? This overwrites all snapshot history. [Rebuild] [Cancel] |

---

## Visual Anchor (Focal Point per Screen)

Each screen has ONE primary visual anchor — the element that earns the most visual weight
(size, contrast, position) and that the eye lands on first. Layout, spacing, and color
emphasis serve this anchor; everything else is secondary.

| Screen | Primary anchor |
|--------|----------------|
| Login | Sign in card (centered, max-width 360px) |
| Overview | Open Positions card (Row A, span 7) — the book at a glance |
| Analyzer | The visx payoff / risk-profile chart (center column, flex:1) |
| Positions | The greek-attribution waterfall ("Why it's moving") |
| Journal | The lifecycle chart (Running-P&L / Price / Greeks tabs) |
| Market | The Net Dealer Gamma Profile chart (span 7) |

---

## Screen-by-Screen Interaction Contracts

### Login screen

The login screen is the **app gate**. It renders instead of the full layout shell when no
valid Supabase Auth session exists. The five-screen nav and market strip are NOT rendered;
only the login card appears.

Layout: full viewport, centered flex column. Background: same body gradient as the main app
(`radial-gradient(1100px 560px at 80% -10%, #141b29 0%, rgba(10,14,20,0) 58%), #0a0e14`).

**Login card:**
- Max-width: 360px. Centered horizontally and vertically (or 40% down from top).
- Background: `linear-gradient(180deg, #0f1521, #0c111a)`. Border: `1px solid #1b2433`. Border-radius: 12px. Padding: 24px.
- Brand: MOR**AI** logotype at top, `subhead` token, violet "AI".
- Heading: "Sign in" — `subhead` token (Space Grotesk 700, 16px).
- Sub-heading: "Trading dashboard — access restricted to authorized users" — `label` token (10px), `color: #566273`.
- Email field: shadcn `Input`, full width. Label above: `label` token, `text-muted`.
- Password field: shadcn `Input` (type=password), full width. Label above: `label` token.
- Submit button: shadcn `Button` (default variant), full width, `bg-violet text-bg`. Text: "Sign in".
- Inline error: coral `#ef5350`, `label` token, below the password field. Appears on invalid credentials or network failure.
- Loading state: button text becomes "Signing in…"; button disabled; no spinner overlay.
- On success: redirect to Overview. Session stored in Supabase Auth cookie/storage (handled by `@supabase/ssr`).
- Focus management: email field auto-focused on mount. Enter in password field submits.
- No "forgot password" or "sign up" links — single-user, closed system.

**Session handling across screens:**
- TanStack Query's `queryClient` stores the auth state. On 401 response from any API call, clear session and redirect to Login.
- Session refresh: `@supabase/ssr` handles token refresh automatically on each request. No manual polling needed for auth.
- Logout: not surfaced in the main UI (single-user tool; reload/clear session via browser is sufficient). May be added to a settings dropdown in a future phase.

### AUTH_EXPIRED status banner

The banner is a fixed-position strip at the bottom of the viewport (`position: fixed; bottom: 0; left: 0; right: 0; z-index: 100`). It renders on all five main screens when `GET /api/status` returns `tokenFreshness: "AUTH_EXPIRED"`.

**Visual spec:**
- Background: `#180f10`. Border-top: `1px solid #5a2b2e` (blood-dark border, same as the regime stat pill). Padding: `8px 16px`.
- Text: "Schwab auth expired. Run `auth setup` to reconnect. Data may be stale." — `body` token (12px JetBrains Mono), `color: #ef5350`.
- The `auth setup` portion is rendered in a `<code>` element: `font-family: inherit; background: #3e1f23; padding: 1px 4px; border-radius: 3px`.
- No close/dismiss button. Banner disappears automatically when the next status poll returns a non-expired state.
- When banner is visible, the page body gains `padding-bottom: 38px` to prevent content overlap.

**Data source:** `GET /api/status` polled by TanStack Query every 30s (see Auto-Poll Intervals below). The `AUTH_EXPIRED` check reads `data.tokenFreshness === "AUTH_EXPIRED"`.

### Auto-Poll Intervals (TanStack Query `refetchInterval`)

| Data | Endpoint | Interval | Stale time | Notes |
|------|----------|----------|------------|-------|
| Status (auth + jobs) | `GET /api/status` | 30s | 20s | Drives AUTH_EXPIRED banner and system health card |
| Market strip (SPX, GEX, P&L) | `GET /api/gex` + `GET /api/positions` | 30s | 20s | Header values update on the same cycle |
| GEX snapshot | `GET /api/gex` | 30s | 20s | Source data is 30-min-fresh; polling is inexpensive (cached row, no recompute) |
| Positions + live greeks | `GET /api/positions` | 30s | 20s | Current P&L, mark, greeks for open positions |
| Journal snapshots | `GET /api/journal/:calendarId` | 60s | 50s | Slower: snapshot job is 30-min cadence; more frequent polling is wasteful |
| Analytics (skew, term-structure) | `GET /api/analytics/skew`, `/term-structure` | 60s | 50s | Same cadence as journal |

**On tab focus:** all queries with `staleTime` exceeded re-fetch immediately on window focus (`refetchOnWindowFocus: true` — TanStack Query default).

**Error retry:** 3 retries with exponential back-off (TanStack default). After 3 failures, display the generic error state for that region; do not crash the full page.

### Global — all screens

- **Sticky header:** 100% viewport width, height ~48px, `z-index: 50`. Contains brand, nav tabs, live market strip.
- **Market strip:** right-aligned pill group. SPX spot (always), net γ /1% (color-coded: teal if positive, coral if negative with blood-dark bg), γ flip (amber), book P&L (sign-colored). Values update on page mount and poll every 30s via TanStack Query.
- **Active nav tab:** `background: #161d2b; color: #d6dbe4`. Inactive: `color: #7b8696`. Hover: `color: #d6dbe4`.
- **Loading states:** skeleton placeholders (not spinners) for every data-dependent region. Skeleton bg: `#1b2433` animated shimmer.
- **Focus rings:** all interactive elements receive a visible `outline: 2px solid #a78bfa; outline-offset: 2px` focus ring. No custom override that removes focus visibility.
- **prefers-reduced-motion:** all CSS transitions and SVG animation effects (gradient shimmer, glow filter) must be wrapped in `@media (prefers-reduced-motion: no-preference)`.
- **Keyboard navigation:** all tabs reachable via `Tab`, all toggles activatable via `Space`/`Enter`, all sliders operable via arrow keys.

### Overview screen

Layout: 12-column card grid. Max width 1480px, centered, padding 14px.

**Row A** (book summary):
- Open positions card (span 7): positions table with columns Position / Structure / DTE / Debit / Mark / Unreal P&L / Δ / Θ/d / Vega. "live" tag in teal on active positions. Net row in bold with top border. Clicking row → navigates to Analyzer with that position selected.
- Net greeks card (span 2): key/value pairs Δ / Γ / Θ/d / Vega with sign coloring.
- P&L card (span 3): large realized P&L figure (`#d6dbe4` text, coral if negative), subtitle "{N} closed · {N} winners ({%})". Equity curve SVG below (coral line if negative cumulative). Unrealized P&L kv-pair at bottom.

**Row B** (what's affecting positions):
- Section header card (span 12): "What's affecting your positions" — full-width, no content.
- Market regime card (span 4): large regime label ("Negative γ" or "Positive γ"), subtitle, mini gamma profile curve (visx), callout block with regime interpretation text.
- Your strike card (span 4): level bar showing call wall / γ flip / your strike / spot / put wall. Key-value table with distances. Callout block.
- Volatility card (span 4): two mini charts side by side (term structure cyan line, skew violet line). 25Δ risk-reversal value. Callout block.

**Row C** (system):
- Catalysts card (span 4): stub with dashed border, "Event calendar not wired" message.
- System health card (span 4): job status rows with colored dot indicators (teal=ok, amber=warn, coral=error).
- Recent activity card (span 4): key-value pairs for recent job outcomes.

### Analyzer screen

Layout: `height: 100vh` application shell. `display: grid; grid-template-rows: auto 1fr`.

Three-column dense cockpit: `236px | 1fr | 320px`, gap 11px, padding 11px. Each column is a scrollable flex column.

**Left column (controls):**

*Positions panel:*
- Each position row: checkbox (include/exclude) + name + live indicator + Δ P&L + lock or × button.
- Live positions (from API): show 🔒 icon; × button hidden; checkbox active.
- Non-live positions: show × remove button; click × confirms removal (no dialog for non-live positions, just removes from analyzer state).
- Clicking row (not checkbox, not ×): selects as roll target, updates "Roll simulator" badge.
- Selected row: `border-color: #a78bfa; background: #241d40`.
- Paste TOS input: full-width mono input. On "+ add from paste": parse → success message in teal or error in coral. Parsed positions are non-live (can be removed).
- "+ blank calendar": adds a position at nearest-25 strike to current spot, non-live.

*Scenario panel:*
- Spot slider: range 6900–7900, step 5. Thumb: `#5b9cf6`.
- Days slider: range 0 → front expiry of earliest-included position (cap updates live as positions change). Thumb: `#f0b429`. When at cap, label turns amber and reads "AT front expiry (calendar done)".
- IV shift slider: range −8 to +8 vol points, step 0.5. Thumb: `#a78bfa`. Display as "+2.0" or "−1.5".
- Reset button: resets all three sliders to defaults (spot=live, days=0, IV=0) AND resets roll (none/same) AND resets y-domain lock.

*Roll simulator panel:*
- Segment buttons for front roll (+7/+14/+21d) and strike offset (−100/same/+100). Amber color scheme.
- On any selection: amber overlay curve appears on payoff chart, roll legend item shows.
- Roll status note updates with current selection.
- Badge reads "on {selected position name}" (from selected row).

**Center column (main chart area):**

*Payoff chart (flex:1, min 300px):*
- visx chart, SVG viewport 1000×470 (logical), preserveAspectRatio none.
- Price axis: x-range 6900–7900 (dynamic to active strikes). Strike labels at 7000/7200/7400/7600/7800 on bottom.
- P&L axis: left side. TOS-stable y-axis: computed once from expiration risk profile on position-set change. Zero line anchored at center. "fit Y" button resets y-domain on demand. All curves clamp within viewport without rescaling.
- Grid lines: `#19212e` horizontal at 5 intervals with y-axis labels.
- Zero line: `#46556a`, weight 1.1px.
- Curves rendered bottom to top (z-order):
  1. Profit zone fill (teal 4.5% opacity) where today ≥ 0.
  2. Today T+0 curve: gradient fills (teal above zero, coral below). Line: `#a78bfa` weight 2.6px, glow filter.
  3. Dated fan curves (if +7/14/21d toggle on): 3 curves in shades `#7c6fd6`/`#6f86c9`/`#5f93b8`, weight 1.3px.
  4. Expiration tent (if expiration toggle on): `#7b8696` dashed weight 1.4px.
  5. Roll overlay (if roll active): `#f0b429` weight 2px solid.
  6. GEX wall lines (if walls toggle on): put wall `#ef5350` / call wall `#26a69a` / γ-flip `#f0b429`, dashed, weight 1px.
  7. Expiration breakeven lines: `#7b8696` dashed, labeled "BE {strike}" at bottom.
  8. T+0 breakeven lines: `#a78bfa` dashed, labeled "BE·T0 {strike}" near top.
  9. Spot vertical line: `#5b9cf6` weight 1.1px. Circle dot at T+0 value, fill `#5b9cf6`, `r=4.5`.
- Crosshair: vertical gray line `#8a98ad` opacity 30% on pointermove. Fixed tooltip (not SVG): `background: rgba(8,11,16,0.97); border: 1px solid #27313f; border-radius: 8px`. Shows: P&L value (colored by sign), SPX price, distance to put wall, distance to call wall.
- Combined P&L readout: top-right of chart head. `display` token (Space Grotesk bold), sign-colored.

*Greek strips (4-column, height 104px):*
- Four panels: Net Δ / Net Γ / Net Θ/d / Net Vega.
- Per strip: `label` token uppercase top-left, current value top-right (`label` token, Space Grotesk bold).
- SVG line chart, uPlot implementation. Zero line `#283342`. Spot vertical `#5b9cf6` opacity 45%. Curve colors: Δ=`#5b9cf6`, Γ=`#22d3ee`, Θ=`#f0b429`, Vega=`#26a69a`. Dot at current spot on each curve.

*P&L heatmap:*
- Columns: T+0, +5d, +10d, +15d, +20d, +30d.
- Rows: ±7 strikes from spot at selected step (10/25/50/100 pt steps).
- Color: diverging teal↔coral, symmetric about zero. Positive: `rgb(16+..., 70+..., 60+...)` → teal family. Negative: `rgb(90+..., 40+..., 55+...)` → coral family.
- Each cell shows compact P&L ($47, $1.2k). Cell text `color: #08111a` (dark on colored background), weight 600.
- Step toggle (segmented): 10s / 25s / 50s / 100s. Default 50s.

**Right column (analytics):**

*What's moving SPX panel:*
- Regime strip: 4 chips (SPX spot / net γ /1% / γ flip / regime). Negative gamma chip: blood-dark bg/border. Chip labels `label` token uppercase, chip values `body` token (Space Grotesk bold).
- Net gamma profile curve: visx. 300×130px logical. Same rendering as full Market screen profile, at compact size. Amber flip line + blue spot line.
- Key levels table: call wall / γ flip / spot / put wall. Color-coded first column. Distance column in dim color.
- GEX by-strike bars: Apache ECharts horizontal bars. Toggle GEX/OI/Volume. GEX: teal bars right / coral bars left of center. OI: call teal right / put coral left. Volume: blue bars from left. Wall + spot horizontal dashed lines drawn over bars.
- GEX note text: auto-generated from regime state.

*Book greeks table:*
- Rows per included position + net row. Columns: Pos / Δ / Γ / Θ/d / Vega.
- Net row: top border `#27313f`, font-weight 700.
- Sign coloring on Θ and Vega.

*Attribution waterfall ("Why it moves"):*
- Items: spot Δ / time θ / vega / residual (Analyzer view — combined book).
- Positions: spot Δ / theta / vega front / vega back / residual (Positions deep-dive view — single position, 5 items).
- Each row: label 54px | track bar | signed value 56px.
- Track: `#0c111a` bg, 12px height (Analyzer) or 16px (Positions). Center midpoint line `#3a4453`.
- Fill: extends left or right from center (50%) proportional to magnitude. Color per row (spot=blue, theta=amber, vega/vega-front=coral, vega-back=teal, residual/combined=dim).
- Values: Space Grotesk 600, sign-colored.
- Note text below.

### Positions screen

Layout: 12-column card grid, max-width 1480px.

**Row 1:**
- Open positions list (span 3): compact position rows. Clicking selects for the deep-dive.
- Why it's moving (span 5): 5-item attribution waterfall (spot/theta/vega-front/vega-back/residual). Total row with top border. Callout block.
- Position card (span 4): 4-KPI grid (Mark/Debit/Unreal/DTE) + per-leg greeks table (Leg / Mark / Δ / Γ / Θ/d / Vega / IV).

**Row 2:**
- Greeks vs spot strips (span 8): 4 strips, same uPlot pattern as Analyzer. Strike vertical line (`#46556a` dashed) added alongside spot line.
- Strike vs structure (span 4): level bar + key distances in text + callout.

### Journal screen

Layout: `height: 100vh` shell. Three-column: `250px | 1fr | 290px`, gap 12px, padding 12px.

**Left column — trade list:**
- Sorted newest-open first, then closed reverse-chronological.
- Each row: name / sub-label / realized P&L + history badge.
- History badge: "history" in cyan if chain data available (Jun-12+); "entry/exit" in dim if not.
- Open trade: "OPEN" badge in cyan, P&L shows "open" in blue.
- Selected row: violet border + dark violet bg.

**Center column — lifecycle:**
- Trade header: name (`subhead` token, Space Grotesk bold) + date range (`label` token, dim) + realized P&L (`subhead` token).
- 3 KPIs: Realized / Max favorable / Max adverse.
- Chart with three mode tabs: Running P&L (violet curve + area fill) / Price & spot (blue curve) / Greeks (teal for vega or amber for theta).
- Day separators: vertical dashed lines `#27313f` with date label.
- Scrubber: range input below chart. Shows timestamp left, snapshot values right.
- Scrubber tracks selected point: highlighted circle on curve.
- Pre-history trades (no chain data): show lifecycle section heading + sub-label "no day-by-day (pre Jun-12)" in dim. Chart area replaced with dashed stub.

**Right column — snapshot + notes:**
- Snapshot table: Time / SPX / Net / P&L / Θ / Vega. Selected row via scrubber: `background: rgba(22,32,48,0.27)`.
- "Why it moved" card: callout block with auto-generated narrative.
- Notes textarea: editable. Placeholder: "Entry thesis, management, post-mortem…". Mono `body` token, min-height 60px.

### Market screen

Layout: Regime strip (4 chips, full width) above 12-column card grid.

**Regime strip:**
- 4 chips: SPX spot (blue value) / net γ /1% (coral if negative, with blood-dark bg) / γ flip (amber value) / regime text (coral "▼ AMPLIFY" or teal "▲ DAMPEN").

**Grid:**
- Net dealer gamma profile (span 7): large visx chart 720×230px. Full grid lines + axis labels. Flip + spot vertical lines. Teal/coral area fills above/below zero. Callout block below.
- GEX by strike (span 5): Apache ECharts horizontal bars, 360×260px. Toggle: GEX/OI/Volume. Put wall + call wall + spot horizontal dashed reference lines.
- Key levels table (span 4): color-coded rows with distance from spot.
- GEX by expiry (span 4): Apache ECharts vertical bar chart, 360×200px. All negative bars in coral. Date labels at bottom. Value labels on bars.
- Charm/Vanna (span 4): "coming soon" stub with dashed border, clearly badged "○ next". Do NOT omit — render stub.
- Intraday flow (span 4): "coming soon" stub with dashed border, badged "○ needs denser snapshots". Do NOT omit — render stub.

---

## TOS Calendar Paste Parser Contract

Input: free-text TOS order string, e.g.:
`BUY +1 CALENDAR SPX 100 (Weeklys) 30 NOV 26/20 NOV 26 [AM] 7550 PUT @5.80 LMT GTC`

Parse rules (extracted from mockup implementation):
1. Extract `BUY`/`SELL` and quantity (`+N`/`-N` or bare `N`). Quantity = `Math.abs(N)`, minimum 1.
2. Extract `PUT` or `CALL`. Default `P` if absent.
3. Extract strike: last 3–5 digit number before `PUT`/`CALL`. Round to integer.
4. Extract debit: number after `@`. Optional.
5. Extract two dates: scan for `\d{1,2} [A-Z]{3} \d{2}` patterns (day + 3-letter month + 2-digit year). Sort ascending → front (earlier) and back (later).
6. Compute front DTE and back DTE relative to today's date. Reject if front DTE ≤ 0 or back DTE ≤ front DTE.
7. Extract underlying from `CALENDAR {SYMBOL}`. Default `SPX`.
8. Imply a flat IV: bisect to find `iv` such that `BSM(back, iv) − BSM(front, iv) ≈ debit` at current spot. If no debit provided, default IV = 15%.
9. Call/Put calendars both supported.

On success: add to positions list as non-live. Show green success message with parsed details.
On failure: show coral error "Could not parse — need 2 expiries, a strike, and PUT/CALL."

---

## Backend Data Gaps (Planner Action Items)

Phase 8 delivers the backend; Phase 9 consumes it. The items below are
**Phase 8 delivery targets** — the frontend depends on each being available via the
typed Hono RPC client before the corresponding Phase 9 screen can be wired.

| Gap | Description | Required For | Phase |
|-----|-------------|-------------|-------|
| GEX-01 | Compute `net_gamma_profile` (full chain re-priced across spot grid, $Bn/1%), `flip_level`, `call_wall`/`put_wall`, `gex_by_strike`, `gex_by_expiry` from `leg_observations`. Snapshot-job (not per-request). | Market screen, Analyzer right panel, all header stats | Phase 8 |
| GEX-02 | Zod contract `gexSnapshot` in `packages/contracts/src/gex.ts`: `{ spot, flip, callWall, putWall, netGammaAtSpot, profile: [{strike, gamma}], strikes: [{k, gex, coi, poi, vol}], byExpiry: [{date, gex}] }`. Export from index. | Hono RPC type safety | Phase 8 |
| RPC-01 | `AppType` (Hono app type) exported from `apps/server` for `hc<AppType>()` client in `apps/web`. See stack-decisions.md D4. | All API calls in apps/web | Phase 8 |
| AUTH-01 | Supabase Auth gating on read endpoints; CORS for Vercel origin. Unauthenticated → 401. | Login screen, session refresh | Phase 8 |
| WEB-01 | `apps/web` scaffold: Vite + React + Tailwind v4 + shadcn/ui init + TanStack Query provider + Supabase Auth client (`@supabase/ssr`). | Everything | Phase 9 (first task) |
| JOURNAL-01 | Journal day-by-day only available for trades from Jun-12 forward. UI marks older trades (entry/exit only badge). No error, no blank screen. | Journal screen | Phase 9 |
| REBUILD-01 | Per-calendar rebuild button in Journal wires to `POST /api/jobs/rebuild-journal/trigger` with `calendarId`. Confirmation dialog before trigger. | Journal screen | Phase 9 |
| POSITIONS-01 | Positions screen needs current unrealized P&L and per-position greeks. Confirm whether `GET /api/positions` returns computed greeks or raw (may need read-through-BSM layer). | Positions screen | Phase 8 / 9 |

---

## Coming-Soon Stubs Contract

Three features must render as clearly-badged placeholder panels, never omitted, never as errors:

| Feature | Badge | Stub title | Stub body |
|---------|-------|------------|-----------|
| Charm/Vanna | `○ next` | Charm & Vanna by strike | computable from chain (Δ-drift from time & IV) — same per-strike bar pattern as GEX |
| Intraday delta-flow | `○ needs denser snapshots` | HIRO-style net delta-flow | Δ(delta-notional) between snapshots — 30-min cadence → coarse; finer feed later |
| Economic calendar | `○ needs feed` | Event calendar not wired | FOMC · CPI · OPEX · jobs — add an economic-calendar feed |

**Stub visual spec:** dashed border `#27313f`, border-radius 8px, padding 16px (`md`), centered flex column, icon/title `label` token bold `#d6dbe4` or `#566273`, body text `label` token `#566273`. Height matches adjacent content (Market: 140px minimum; Overview: auto).

---

## Design System

### shadcn Gate

`apps/web` not scaffolded. At scaffold time:
1. Run `npx shadcn init` inside `apps/web` (Vite + React project).
2. Use dark theme with CSS variables matching the locked palette tokens above.
3. Override `--background`, `--card`, `--border`, `--muted`, `--accent`, `--destructive` to match `--bg`, `--panel`, `--line`, `--muted`, `--violet`, `--down` from the design tokens above.
4. Components to add via `npx shadcn add`: `card`, `tabs`, `slider`, `toggle-group`, `dialog`, `input`, `textarea`, `badge`, `tooltip`, `skeleton`, `separator`, `button`.
5. No third-party shadcn registries. All components from shadcn official registry only.

### Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | card, tabs, slider, toggle-group, dialog, input, textarea, badge, tooltip, skeleton, separator, button | not required |

No third-party registry blocks declared. Registry vetting gate not required.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending (updated 2026-06-24 — awaiting re-check after Login screen + AUTH_EXPIRED banner additions)
