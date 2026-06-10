# Trade-Advisor Plugin — Full Inventory (Absolute Paths)

> Source: `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/`
> Version: 0.3.4 · Generated: 2026-06-05
> Self-contained SPX options analysis plugin — Schwab MCP data layer + reasoning skills + subagents + web dashboard.

---

## 1. Plugin Root

| File | Absolute Path | Purpose |
|---|---|---|
| Plugin manifest | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.claude-plugin/plugin.json` | Name `trade-advisor`, v0.3.4 |
| MCP registration | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.mcp.json` | Registers MCP server: `bun run ${CLAUDE_PLUGIN_ROOT}/mcp-server/src/index.ts` |
| README | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/README.md` | Architecture diagram, tools table, skills table |
| Setup guide | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/SETUP.md` | Schwab dev account → OAuth → verify, troubleshooting |
| Contributing | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/CONTRIBUTING.md` | Dev loop, PR rules (no string interpretation in tools, Zod required) |
| Env template | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.env.example` | Key names: SCHWAB_TRADER_APP_KEY/SECRET, SCHWAB_MARKET_APP_KEY/SECRET, SCHWAB_ACCOUNT_HASH, SCHWAB_CALLBACK_URL, FINNHUB_API_KEY, FRED_API_KEY |
| Live env (secret) | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.env` | 0600, gitignored — never commit |
| Gitignore | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.gitignore` | Excludes .env, tokens/, .dashboard.pid, node_modules |

### State / Data Files

| File | Absolute Path | Purpose |
|---|---|---|
| Trade journal | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/trade-journal.jsonl` | JSONL, rebuilt from Schwab fills only — never hand-edited. ~11 events |
| Journal backup 1 | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/trade-journal.jsonl.bak.1778173351749` | Auto-backup from rebuild |
| Journal backup 2 | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/trade-journal.jsonl.bak.1778259813269` | Auto-backup from rebuild |
| Dashboard state | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.dashboard-state.json` | 4-tab state (check/scan/exit/news), current+prior per tab, restored on server restart |
| Dashboard PID | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.dashboard.pid` | Running server PID for lifecycle control |
| Keepalive log | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.keepalive.log` | Token refresh history from cron (12h cadence) |

### OAuth Tokens (secret, 0600, gitignored)

| File | Absolute Path |
|---|---|
| Trader token | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/tokens/schwab_trader_token.json` |
| Market token | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/tokens/schwab_market_token.json` |

---

## 2. MCP Server (data layer, ~5,344 lines TS)

Root: `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/`

| File | Absolute Path | Lines | Purpose |
|---|---|---|---|
| Entry point | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/index.ts` | ~700 | MCP server entry, tool dispatch |
| All tools | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/tools.ts` | 3,788 | All 35 MCP tool implementations + hardcoded EVENT_CALENDAR |
| Schwab init | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/schwab-init.ts` | 114 | Loads .env + token files → SchwabContext |
| BSM pricing | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/bsm.ts` | 126 | Black-Scholes (r=4.5%, q=1.3%), IV bisection, calendar tent curves, today-BE solver |
| CBOE feed | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/cboe.ts` | 130 | Free 15-min delayed chain, OSI parsing, 5-min cache |
| News feeds | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/news.ts` | 540 | GDELT, Finnhub, StockTwits, ApeWisdom WSB, Yahoo RSS, Truth Social mirror, Fed speeches, GDPNow, Treasury auctions. Stale-cache fallback |
| Schwab facade | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/schwab/index.ts` | 151 | Trader+market clients, proactive refresh 60s pre-expiry, reactive on 401 |
| OAuth refresh | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/schwab/auth.ts` | 58 | POST api.schwabapi.com/v1/oauth/token, disk persist 0600 |
| HTTP layer | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/schwab/http.ts` | 128 | Exponential backoff + jitter, Retry-After, max 5 retries |
| Trader client | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/schwab/trader-client.ts` | 110 | accounts, positions, orders, transactions |
| Market client | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/schwab/market-client.ts` | 114 | option chain, quotes, price history, market hours |
| Zod schemas | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/schwab/schemas.ts` | 199 | Validators for all Schwab responses |
| Package | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/package.json` | — | Deps: @modelcontextprotocol/sdk, zod. Runtime: Bun ≥1.1 |

### 35 MCP Tools (all in tools.ts)

**Position/account:** `get_positions`, `get_account_balance`, `compute_position_greeks`, `get_calendar_pnl`, `get_quote`, `get_option_greeks`

**Calendar engine:** `find_calendar_candidates`, `analyze_calendar_candidate`, `analyze_roll`, `compute_profit_zone`, `compute_profit_zone_card`, `compute_theta_kickin`, `loss_cause_scan`, `compute_expected_move`, `range_stay_probability`, `build_order_ticket`

**Regime/vol:** `get_vol_regime`, `get_realized_vol`, `compute_gex_levels` (SPX OI=0 quirk → SPY proxy scaled ~10.048×), `get_breadth`, `get_intermarket`

**News/sentiment:** `get_news_feed`, `get_news_macro`, `get_news_sentiment`, `get_news_signals`, `get_social_sentiment`, `get_trump_posts`, `get_macro_signals`, `get_sentiment_badge`

**Events/journal/auth/dashboard:** `get_upcoming_events`, `get_earnings_calendar`, `log_trade`, `check_token_status`, `refresh_tokens`, `push_dashboard`

Design rule: no LLM in data path — tools = pure fetch + math + Zod. Reasoning lives in skills/agents.

---

## 3. Scripts (877 lines total)

Root: `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/scripts/`

| Script | Absolute Path | Lines | Invocation |
|---|---|---|---|
| OAuth lifecycle | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/scripts/auth.ts` | 377 | `bun run scripts/auth.ts setup\|refresh\|status\|doctor\|keepalive` |
| Journal rebuild | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/scripts/rebuild-journal.ts` | 394 | `bun run scripts/rebuild-journal.ts --days 90 [--out FILE]` |
| Journal replay | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/scripts/replay-journal.ts` | 75 | `bun run scripts/replay-journal.ts` — verdict audit on last closes |
| Symbol probe | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/scripts/probe-symbols.ts` | 31 | `bun run scripts/probe-symbols.ts` — Schwab symbol coverage |

---

## 4. Dashboard (web UI, port 7777)

Root: `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/`

| File | Absolute Path | Purpose |
|---|---|---|
| Server | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/server.ts` | Bun HTTP + SSE, 4-tab state machine, restores `.dashboard-state.json`, SIGTERM cleanup |
| Client (legacy) | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/client.ts` | One-shot state push CLI, auto-spawns server if 7777 down |
| Kill script | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/kill.sh` | Process cleanup |
| Check template | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/templates/check.ts` | 31 KB — P&L tent, Greeks, 23-signal card, exit ladder. STRICT schema, rejects missing profit_zone |
| Scan template | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/templates/scan.ts` | Entry candidates + vol_rank pill |
| Exit template | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/templates/exit.ts` | Close/roll decision + ladder |
| News template | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/templates/news.ts` | Macro + sentiment + Trump posts |
| App shell | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/public/index.html` | Single-page shell |
| Frontend JS | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/public/app.js` | Tab routing, SSE listener |
| Styles | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/dashboard/public/styles.css` | 24 KB dark theme |

URL: `http://localhost:7777` · Auto-spawns on first `/scan` `/check` `/exit` · Manual: `/dashboard up|down`

---

## 5. Skills (9 active, 10 retired)

Root: `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/`

### Active

| Skill | Absolute Path | Triggers → Dispatch |
|---|---|---|
| scan | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/scan/SKILL.md` | "find me a calendar", "scan for trades" → check-orchestrator `mode=scan` → entry-analyst |
| check | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/check/SKILL.md` | "daily check", "should I hold" → check-orchestrator `mode=check` → 4 analysts parallel |
| exit | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/exit/SKILL.md` | "should I close", "take profit" → check-orchestrator `mode=exit` → exit_ladder |
| auth | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/auth/SKILL.md` | "tokens expired", "schwab broken" → auth-specialist |
| review-trades | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/review-trades/SKILL.md` | "win rate", "weekly review" → trade-journalist (fork) |
| journal | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/journal/SKILL.md` | "log this trade", "trade history" → log_trade MCP (rejects manual OPEN/CLOSE) |
| events | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/events/SKILL.md` | "next FOMC", "events this week" → get_upcoming_events |
| dashboard | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/dashboard/SKILL.md` | "dashboard up/down" → daemon control |
| calendar-playbook | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/calendar-playbook/SKILL.md` | Auto-loads on calendar questions. Single source of truth: entry gates (hard 5 + soft 8, ≥75 enter), DTE rules (front 25-40, gap 25-30), exit tiers, roll mechanics, SPX quirks, 16 rules of thumb. Reason codes: OK/WAIT/TGT/STP/GAMMA/BWD/DRIFT/EVT/TERM/DELTA/VOL/CAUTION |

### Retired (delete after 2026-05-24)

Dir: `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/skills/_retired/`

`daily-check` `enter-trade` `advise` `greeks` `gex` `status` `regime` `adjust-trade` `pnl-explain` `order-ticket` — all stubs redirect to /scan /check /exit.

---

## 6. Agents (12 active, 1 retired)

Root: `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/`
Memory (all, user-scope): `~/.claude/agent-memory/<agent-name>/MEMORY.md`

| Agent | Absolute Path | Role |
|---|---|---|
| check-orchestrator | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/check-orchestrator.md` | Single driver for scan/check/exit. Mode×position matrix. 23-signal 5-row card. Mandatory push_dashboard. Pre-trade hard gate (anti-7175): sizing caps, anti-disposition flag, binding commitment block |
| entry-analyst | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/entry-analyst.md` | IVR(1y)≥50 hard kill, candidate scoring 0-100 (prob_in_zone×60 + theta kickin + H4 + delta band + IVR bonus) |
| mean-rev-analyst | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/mean-rev-analyst.md` | GEX/walls/VVIX/skew/RV-IV → MEAN-REV / TRENDING / BREAKDOWN |
| greeks-analyst | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/greeks-analyst.md` | Net Δ/Γ/Θ/V + drift vs entry (from memory), theta kick-in |
| threat-monitor | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/threat-monitor.md` | 7 threat signals: events, wall breach, skew flip, VVIX>105, RV>IV, news heat, retail extreme |
| auth-specialist | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/auth-specialist.md` | Token diagnosis, refresh, re-auth walkthrough. Outcomes: HEALTHY/REFRESHED/NEEDS_REAUTH |
| event-monitor | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/event-monitor.md` | Tier-1 event pre/post reaction stats (FOMC/CPI/NFP/PCE/OpEx/QuadWitch/JacksonHole) |
| gex-historian | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/gex-historian.md` | Daily GEX snapshots, wall persistence, pin probability |
| roll-historian | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/roll-historian.md` | Roll condition→outcome win rates by DTE/distance/P&L buckets |
| earnings-tracker | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/earnings-tracker.md` | Mega-cap (NVDA/AAPL/MSFT/...) IV crush history, SPX correlation |
| trade-journalist | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/trade-journalist.md` | Trade autopsies, win rate/expectancy, behavioral flags (revenge/FOMO/premature exit/size creep), agent accuracy audit |
| calibration-auditor | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/calibration-auditor.md` | Weekly meta-audit, threshold drift. Phase 3 deprecation → merging into trade-journalist |
| daily-orchestrator (RETIRED) | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/agents/_retired/daily-orchestrator.md` | Consolidated into check-orchestrator 2026-05-11 |

### Plugin-local .claude

| Dir | Absolute Path | Note |
|---|---|---|
| Agent memory stubs | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/.claude/agent-memory/` | Empty stubs: calendar-expert/, devils-advocate/, market-psychologist/. Real memories live in `~/.claude/agent-memory/` |

---

## 7. Related Repo-Level Files (outside plugin, consumed by it)

| File | Absolute Path | Purpose |
|---|---|---|
| Pre-trade protocol | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/.claude/memory/pre-trade-protocol.md` | MANDATORY read before any /scan /check /exit recommendation. Anti-7175 rules |
| Trader profile | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/.claude/memory/trader-profile.md` | Account size, risk tolerance — onboarding gate |
| Routing rules | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/.claude/rules/trading-routing.md` | 5-tier agent flow, request classification |
| Cross-agent memory | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/.claude/rules/cross-agent-memory.md` | Shared state producers, namespaces, read permissions |
| Memory conventions | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/.claude/rules/memory-conventions.md` | 200-line cap, tags, prune rules, ISO dates |
| Project CLAUDE.md | `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/CLAUDE.md` | Repo-level instructions incl. trade-advisor section |

---

## 8. Quick Reference

```bash
# Plugin root
cd /Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor

# Auth lifecycle (one script, 5 subcommands)
bun run scripts/auth.ts setup      # first-time interactive OAuth (both apps)
bun run scripts/auth.ts refresh    # daily refresh (idempotent, cron this 12h)
bun run scripts/auth.ts status     # token health
bun run scripts/auth.ts doctor     # diagnose
bun run scripts/auth.ts keepalive  # loop forever, refresh every 12h

# Journal (Schwab is source of truth)
bun run scripts/rebuild-journal.ts --days 90

# MCP server (normally launched by Claude Code via .mcp.json)
cd mcp-server && bun run src/index.ts

# Dashboard
bun run dashboard/server.ts        # manual start → http://localhost:7777
```

### Flow

```
/scan|/check|/exit → check-orchestrator
  flat + scan  → entry-analyst → IVR gate → score → pre-trade hard check → ENTER|WAIT
  held         → mean-rev + greeks + threat analysts ∥ → 23-signal card → HOLD|WATCH|REDUCE|HEDGE|CLOSE
  always       → push_dashboard → http://localhost:7777
```
