# Topic Map

Complete index of all documentation. Update this file when adding, moving, or removing
any doc. See [docs-on-docs/documentation-organization.md](docs-on-docs/documentation-organization.md).

## Architecture (`docs/architecture/`)

Read in order. Source of truth for how Morai works.

| Doc | Contents |
|---|---|
| [overview.md](architecture/overview.md) | Vision, system context diagram, hard rules, doc map |
| [stack-decisions.md](architecture/stack-decisions.md) | Every tooling decision: why, swap cost, revisit trigger (ADR-lite) |
| [hexagonal-ddd.md](architecture/hexagonal-ddd.md) | Layers, ports/adapters, naming conventions, bounded contexts, enforcement |
| [monorepo-layout.md](architecture/monorepo-layout.md) | Bun workspaces, dependency graph, composition roots |
| [data-model.md](architecture/data-model.md) | Journal schema, snapshots, Postgres-vs-Timescale math |
| [jobs.md](architecture/jobs.md) | Job catalog, schedules, pg-boss patterns, JobQueue port |
| [picker-rules.md](architecture/picker-rules.md) | Calendar-picker rule table: gates, weighted scores, experimental rules, refuted list, how to add a rule |
| [exit-rules.md](architecture/exit-rules.md) | Exit advisor rule ladder: the seven exit rules, precedence order, hysteresis bands, P&L basis, read-only boundary, how to add a rule |
| [regime-board.md](architecture/regime-board.md) | Regime & breadth board — admitted indicators, thresholds, provenance |
| [playbook-gates.md](architecture/playbook-gates.md) | Market-level entry gate — shared VIX ladder, penalty bands + hysteresis, GATE BLIND fail-closed, anti-criteria brakes (max-open, loss-cooldown, deferred sustained-trend), sizing tiers |
| [api-design.md](architecture/api-design.md) | Hono RPC, Zod contracts, error model, service/DAO vocabulary |
| [mcp-and-plugins.md](architecture/mcp-and-plugins.md) | MCP server as inbound adapter, tool surface, plugin shape |
| [testing-tdd.md](architecture/testing-tdd.md) | Red→green loop, test pyramid, calibration gates |
| [deployment.md](architecture/deployment.md) | Railway topology, config, token persistence, observability |
| [streaming-fanout.md](architecture/streaming-fanout.md) | SSE fan-out pipeline, opaque ticket auth (D-01), BSM recompute (D-02), STRM-04 display-only invariant, Z-suffix timestamp contract |
| [backtest-harness.md](architecture/backtest-harness.md) | Operator-CLI backtest: three replay paths (leakage oracle, 13-trade exit reproduction, hypothetical entry+exit), point-in-time discipline, reuse-the-live-engine rule, n=13 honesty rule, never-writes-weights boundary |
| [rule-overrides.md](architecture/rule-overrides.md) | Runtime rule overrides: JSONB layer merged over compile-time constants at consumption time |

## Operations (`docs/operations/`)

Operator-facing runbooks for manual, non-automatable procedures.

| Doc | Contents |
|---|---|
| [schwab-reauth-runbook.md](operations/schwab-reauth-runbook.md) | Weekly Schwab re-auth: the in-app Reconnect wizard (primary path), the CLI OAuth exchange + sidecar restart (fallback), Railway deploy prerequisites, post-recovery verification |

## Docs on Docs (`docs/docs-on-docs/`)

How to write and maintain documentation.

| Doc | Contents |
|---|---|
| [content-principles.md](docs-on-docs/content-principles.md) | Single source of truth, current-state-not-history, code in docs, stable refs, micro-modular sizing |
| [documentation-organization.md](docs-on-docs/documentation-organization.md) | Directory structure, what belongs where, naming, index maintenance |
| [hemingway-style.md](docs-on-docs/hemingway-style.md) | Writing style for all prose |
| [documentation-cleanup-sweep.md](docs-on-docs/documentation-cleanup-sweep.md) | Quarterly drift-prevention process |

## Rules (`.claude/rules/`)

Path-loaded requirements. See [.claude/rules/README.md](../.claude/rules/README.md).

| Rule | Loads for | Enforces |
|---|---|---|
| architecture-boundaries.md | `packages/**`, `apps/**` TS | Dependency law, layer laws, swap discipline |
| tdd.md | All TS source + tests | Red→green TDD, required test kinds |
| typescript.md | All TS/TSX | No any/as/!, strict compiler + lint |
| workflow.md | Everything | Docs-first, verification, change hygiene |
| docs.md | All markdown | Documentation structure and maintenance |

## Other

| Doc | Contents |
|---|---|
| [trade-advisor-inventory.md](trade-advisor-inventory.md) | Inventory of the trade-advisor plugin system |
| [iv-engine-discrepancy-and-solver.md](iv-engine-discrepancy-and-solver.md) | Why Schwab API IV differs from TOS (~2 pts on SPX), verified root cause, own BSM-solver decision + calibration plan |
| [tos-studies-learnings.md](tos-studies-learnings.md) | Learnings from retired TOS thinkScript studies: fragility composite spec, regime thresholds, GEX taxonomy + put-sign bug, thinkScript gotchas |
| `knowledge-base/` | Synthesized trading knowledge + old-system lessons (read-only; not indexed here) |
