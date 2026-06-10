# MCP Server + Claude Code Plugins

Claude Code is a **first-class client** of Morai — everything the UI shows, Claude can query;
journal analysis, snapshot review, trade context all available in-session.

## MCP Server = Inbound Adapter

The MCP server is *not* a separate system. It is a second driving adapter over the same
application use-cases as HTTP:

```
Claude Code ──(MCP / streamable HTTP)──▶ apps/server/src/adapters/mcp/ ──▶ use-cases (core)
Browser ─────(HTTP / Hono RPC)─────────▶ apps/server/src/adapters/http/ ─▶ same use-cases
```

- Transport: **streamable HTTP** (`@modelcontextprotocol/sdk`), mounted on the same Hono server
  at `/mcp`. One Railway service serves UI + API + MCP.
- Tool handlers follow the same law as routes: Zod-parse args → call use-case → format result.
  **Zero business logic in tool handlers.**
- Tool input schemas derive from `packages/contracts` — one schema source for HTTP and MCP.

## Tool Surface (initial — mirrors API routes)

| MCP tool | Mirrors |
|---|---|
| `get_status` | `GET /api/status` |
| `list_calendars` | `GET /api/calendars` |
| `get_journal` | `GET /api/journal/:id` — snapshot series, the core analysis tool |
| `get_live_greeks` | `GET /api/greeks` |
| `get_term_structure` / `get_skew` | analytics routes |
| `trigger_job` | `POST /api/jobs/:name/trigger` |

Rule: **new use-case ⇒ both adapters in the same PR** (HTTP route + MCP tool), unless explicitly
scoped otherwise. Keeps Claude's capability surface from drifting behind the UI.

## Auth

- MCP endpoint protected by bearer token (env-configured) — it's exposed on the public internet
  via Railway. Same middleware guards `/api` once anything sensitive is served.
- Schwab credentials never transit MCP; they live server-side only.

## Claude Code Plugin

A thin plugin lives in this repo (eventually installable):

```
.claude-plugin/  (later — not yet)
├── plugin.json           # name: morai
├── .mcp.json             # points at the deployed MCP endpoint
└── skills/
    ├── journal-review/   # "review my 7100 calendar journal" → get_journal + analysis framing
    └── morai-status/     # "is morai healthy" → get_status
```

- Skills are *reasoning instructions*; all data access goes through MCP tools.
- The existing `trade-advisor` plugin remains separate (live Schwab analysis); Morai's plugin is
  about the *collected/historical* data. They may merge later — decision deferred.

## Local Dev

- `bun run dev` serves MCP at `http://localhost:3000/mcp`; register in Claude Code via
  `claude mcp add --transport http morai http://localhost:3000/mcp`.
- In-memory adapters make the MCP surface testable without Schwab creds.
