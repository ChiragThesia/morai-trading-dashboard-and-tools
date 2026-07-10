# Phase 29: Runtime Rule Settings - Pattern Map

**Mapped:** 2026-07-09
**Files analyzed:** 17 (new + modified)
**Analogs found:** 17 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/adapters/src/postgres/schema.ts` (+ `ruleOverrides` table) | model | CRUD | `brokerTokens` table, same file, lines 218-241 | exact (singleton-row convention) |
| `packages/adapters/src/postgres/migrations/0022_rule_overrides.sql` | migration | CRUD | `packages/adapters/src/postgres/migrations/0021_*.sql` | exact |
| `packages/adapters/src/postgres/repos/rule-overrides.ts` | service (repo) | CRUD | `packages/adapters/src/postgres/repos/calendar-event-annotations.ts` | exact |
| `packages/adapters/src/memory/rule-overrides.ts` | service (repo, memory twin) | CRUD | `packages/adapters/src/memory/calendar-event-annotations.ts` | exact |
| `packages/contracts/src/rule-settings.ts` | model (Zod contract) | request-response | `packages/contracts/src/journal-rules.ts` (implied by routes.ts usage) | exact |
| `packages/core/src/settings/application/ports.ts` | service (ports) | CRUD | `packages/core/src/journal/application/ports.ts` (`ForReadingAnnotations`) | exact |
| `packages/core/src/settings/application/getRuleSettings.ts` | service (use-case) | request-response | `packages/core/src/journal/application/getCalendarEventsWithRules.ts` | exact |
| `packages/core/src/settings/application/setRuleOverrides.ts` | service (use-case) | CRUD | same file, write-side variant (no direct analog — pattern-match `makeGetCalendarEventsWithRulesUseCase` shape) | role-match |
| `packages/core/src/picker/domain/rule-config.ts` | utility (pure merge) | transform | `packages/core/src/picker/domain/scoring.ts` `weights?` seam (lines 96-101, 116-124) | exact |
| `packages/core/src/exits/domain/rule-config.ts` | utility (pure merge) | transform | same `weights?` seam pattern, applied to `exit-rules.ts` TAKE/STOP rungs | role-match |
| `packages/core/src/analytics/domain/rule-config.ts` | utility (pure merge) | transform | same `weights?` seam pattern, applied to `regime.ts` band constants | role-match |
| `apps/server/src/adapters/http/settings.routes.ts` | route/controller | request-response | `apps/server/src/adapters/http/journal-rules.routes.ts` | exact |
| `apps/server/src/adapters/mcp/tools.ts` (+ `registerGetRuleSettingsTool`/`registerSetRuleOverridesTool`) | controller (MCP) | request-response | existing `get_rule_tags`/`set_rule_tags` MCP registration in `apps/server/src/adapters/mcp/server.ts:158-165` | exact |
| `apps/worker/src/main.ts` (+ `readRuleOverrides` wiring into picker/exit deps) | config (composition root) | request-response | existing `readMacroObservations` wiring (`computePickerSnapshot.ts:439`) | exact |
| `apps/server/src/main.ts` (+ `readRuleOverrides` wiring into regime deps) | config (composition root) | request-response | existing composition-root deps wiring for `getRegimeBoard` | exact |
| `apps/web/src/hooks/useRuleSettings.ts` | hook | request-response | `apps/web/src/hooks/useRuleTags.ts` | exact |
| `apps/web/src/screens/RuleSettingsModal.tsx` | component | request-response | `apps/web/src/screens/ExitRulesPanel.tsx` + `Overview.tsx` Dialog usage (lines 1205-1215) | exact |
| `apps/web/src/components/Shell.tsx` (+ gear icon trigger) | component | request-response | same file, existing `NAV_TABS` header (lines 55-93) | exact |

## Pattern Assignments

### `packages/adapters/src/postgres/schema.ts` (+ `ruleOverrides`) (model, CRUD)

**Analog:** `brokerTokens` table (same file, lines 218-241) — verified single-row-by-natural-key convention:
```typescript
export const brokerTokens = pgTable("broker_tokens", {
  appId: text("app_id").primaryKey(),
  // ...
}).enableRLS();
```
Copy this shape for `ruleOverrides`: fixed literal key (e.g. `id: text("id").primaryKey()` with the app always writing `"default"`), a single `overrides: jsonb("overrides").notNull()` column, `updatedAt`. No DB CHECK constraint — singleton is an app convention, not a DB constraint (matches `broker_tokens` precedent, explicitly called out as the pattern to replicate in RESEARCH.md).

### `packages/adapters/src/postgres/repos/rule-overrides.ts` (service, CRUD)

**Analog:** `packages/adapters/src/postgres/repos/calendar-event-annotations.ts`
```typescript
// upsertAnnotation uses onConflictDoUpdate (mutable, unlike append-only picker_snapshot)
const upsertAnnotation: UpsertAnnotation = async (input) => {
  const rows = await db
    .insert(calendarEventAnnotations)
    .values({ /* ... */ })
    .onConflictDoUpdate({ target: calendarEventAnnotations.fillIdsHash, set: { /* ... */ } })
    .returning();
  // ...
};
```
`rule_overrides` needs the same `onConflictDoUpdate` shape (target = the fixed primary key, not a hash) — settings are editable anytime, not append-history.

### `packages/adapters/src/memory/rule-overrides.ts` (service, CRUD)

**Analog:** `packages/adapters/src/memory/calendar-event-annotations.ts` — `MemoryCalendarEventAnnotationsRepo` class wrapping an in-memory `Map`, mirroring the postgres repo's port interface exactly (architecture rule 8: every adapter needs a memory twin passing the same contract test).

### `packages/core/src/picker/domain/rule-config.ts`, `exits/domain/rule-config.ts`, `analytics/domain/rule-config.ts` (utility, transform)

**Analog:** `packages/core/src/picker/domain/scoring.ts` (verified, lines 96-101 + 116-124) — the ONLY live override-injection precedent in this codebase:
```typescript
export type ScoringParams = {
  readonly r: number;
  readonly q: number;
  readonly realizedVol20?: number | null;
  readonly slopeHistory?: ReadonlyArray<number>;
  readonly weights?: Partial<Record<BreakdownCriterion, number>>;
};
// consumed inside scoreOne():
const wSlope = params.weights?.slope ?? WEIGHT_SLOPE;
const wFwdEdge = params.weights?.fwdEdge ?? WEIGHT_FWD_EDGE;
```
Every new `resolveXConfig(overrides?)` function in the three new `domain/rule-config.ts` files MUST follow this exact `params.override?.field ?? CONSTANT` idiom — never a required param, never a renamed/removed constant (Pitfall 5: omitting the param must reproduce today's output byte-identically, required for the BT-02 backtest leakage oracle). Each file stays inside its own bounded context's `domain/` (no cross-context imports — architecture rule 7).

### `apps/server/src/adapters/http/settings.routes.ts` (route, request-response)

**Analog:** `apps/server/src/adapters/http/journal-rules.routes.ts` — GET/PUT pair, `zValidator("json", requestSchema)` on PUT, `contract.parse()` on every response, mounted inside `apiRouter` under `authReadGroup` JWT middleware (`apps/server/src/main.ts:393-395`). Copy the GET/PUT shape verbatim; add a third semantic (group-reset) as `PUT` with `{ groupName: null }` per RESEARCH.md's recommended wire shape.

### MCP tools (`apps/server/src/adapters/mcp/tools.ts` / `server.ts`)

**Analog:** existing `get_rule_tags`/`set_rule_tags` MCP registration, `apps/server/src/adapters/mcp/server.ts:158-165` — optional-param tool registration, gated by `if (x !== undefined) registerXTool(server, x)`. Register `get_rule_settings`/`set_rule_overrides` the same way, sharing the same contract as the HTTP route.

### `apps/worker/src/main.ts` / composition-root wiring (config, request-response)

**Analog:** the existing `readMacroObservations` fresh-per-call pattern inside `computePickerSnapshot.ts:439`:
```typescript
const macroResult = await deps.readMacroObservations();   // existing pattern
// NEW, same shape:
const overridesResult = await deps.readRuleOverrides();
const config = resolvePickerRuleConfig(overridesResult.ok ? overridesResult.value.picker : undefined);
```
Wire `readRuleOverrides` into `ComputePickerSnapshotDeps` AND `ComputeExitAdviceDeps` (both worker-job use-cases — see RESEARCH.md Pitfall 2: exit rungs are NOT server-request-time, they're consumed by `computeExitAdvice.ts` invoked from `apps/worker/src/handlers/compute-picker.ts`'s job chain). Do NOT wire into `GetExitAdviceDeps` (server, HTTP GET path — that use-case re-derives from an already-persisted `ExitVerdictRow`, never calls `evaluateExit` again).

### `apps/server/src/main.ts` (regime board wiring)

Wire `readRuleOverrides` into `GetRegimeBoardDeps` only (server composition root) — `getRegimeBoard.ts` has no worker job, computes live per HTTP/MCP call (RESEARCH.md Pitfall 3).

### `apps/web/src/hooks/useRuleSettings.ts` (hook, request-response)

**Analog:** `apps/web/src/hooks/useRuleTags.ts` (full source read above) — `useQuery` for GET, non-optimistic mutation for PUT (never flips local state before the PUT resolves), `queryClient.invalidateQueries` on success, per-key error map with a `retry` path. Copy this shape 1:1, replacing `fillIdsHash`-keyed errors with group-keyed errors (`picker`/`exits`/`regime`).

### `apps/web/src/screens/RuleSettingsModal.tsx` (component, request-response)

**Analog:** `apps/web/src/screens/ExitRulesPanel.tsx` + the Dialog/DialogContent composition already live in `Overview.tsx:1205-1215` (the "Exit rules ▸" trigger). Use `apps/web/src/components/ui/dialog.tsx`'s `Dialog`/`DialogTrigger`/`DialogContent` — already wraps `@base-ui/react/dialog`. 3 grouped `Panel`s (Entry/Picker · Exit Advisor · Regime Bands), each with a reset-to-defaults button that calls the mutation with `{ groupName: null }`.

### `apps/web/src/components/Shell.tsx` (+ gear icon) (component, request-response)

**Analog:** the file's own existing `NAV_TABS` header block (verified, lines 55-93 above) — sticky frosted-glass header, flex layout, `button` elements styled with `cn(...)` + design-system tokens. Add a gear icon (`lucide-react`, already a dependency) as a `DialogTrigger`-wrapped button in the header's right-hand side (currently empty — header is a two-child flex with only the left brand+nav group), matching the existing button's focus-ring/hover treatment (`text-dim hover:text-txt`, `focus-visible:ring-2 focus-visible:ring-violet`). Use the shared `<Button>` primitive (`apps/web/src/components/system/Button.tsx`, Phase 21) per CONTEXT.md's explicit lock, not a bare `<button>`.

---

## Shared Patterns

### Singleton-row JSONB storage
**Source:** `packages/adapters/src/postgres/schema.ts:218-241` (`brokerTokens`)
**Apply to:** `ruleOverrides` table — fixed natural-key literal, no DB CHECK constraint, `.enableRLS()`.

### Repo pair (postgres + memory twin, contract-tested)
**Source:** `packages/adapters/src/postgres/repos/calendar-event-annotations.ts` + `packages/adapters/src/memory/calendar-event-annotations.ts`
**Apply to:** `rule-overrides.ts` postgres repo and memory twin — `onConflictDoUpdate` on write, both passing the same contract test file.

### Optional-param merge seam
**Source:** `packages/core/src/picker/domain/scoring.ts:96-101, 116-124` (`weights?`)
**Apply to:** every new `resolveXConfig` in `picker/domain/rule-config.ts`, `exits/domain/rule-config.ts`, `analytics/domain/rule-config.ts` — `params.override?.field ?? CONSTANT`, never required, never a fresh literal replacing the named constant (Pitfall 5).

### Fresh-read-per-invocation (no caching across runs)
**Source:** `readMacroObservations()` call inside `computePickerSnapshot.ts:439`
**Apply to:** `readRuleOverrides()` calls inside `computePickerSnapshot.ts`, `computeExitAdvice.ts`, `getRegimeBoard.ts` use-case bodies — never resolved once in the composition-root closure.

### Route + MCP GET/PUT pair
**Source:** `apps/server/src/adapters/http/journal-rules.routes.ts` + `apps/server/src/adapters/mcp/server.ts:158-165`
**Apply to:** `settings.routes.ts` + `get_rule_settings`/`set_rule_overrides` MCP tools — `zValidator` on PUT, `contract.parse()` on every response, mounted under `authReadGroup`.

### Web data hook (query + non-optimistic mutation)
**Source:** `apps/web/src/hooks/useRuleTags.ts` (full source, verified above)
**Apply to:** `useRuleSettings.ts` — identical shape, group-keyed instead of hash-keyed.

### Dialog/modal composition
**Source:** `apps/web/src/components/ui/dialog.tsx` + `Overview.tsx:1205-1215` Dialog usage
**Apply to:** `RuleSettingsModal.tsx` — `Dialog`/`DialogTrigger`/`DialogContent`, triggered from the new `Shell.tsx` gear icon.

## No Analog Found

None — every file in scope has at least a role-match analog already shipped in this repo (RULE-01's rule-tags feature is a near-1:1 precedent for the entire shell; the merge-seam plumbing follows the one existing `weights?` precedent).

## Metadata

**Analog search scope:** `packages/core/src/{picker,exits,analytics,journal,settings}`, `packages/adapters/src/{postgres,memory}`, `apps/server/src/adapters/{http,mcp}`, `apps/worker/src`, `apps/web/src/{hooks,screens,components}`
**Files scanned:** 17 target files + 8 analog files fully read (codegraph_explore verbatim source) + RESEARCH.md's prior verified reads (rules.ts, candidate-selection.ts, entry-gate.ts, brakes.ts, sizing.ts, exit-rules.ts, regime.ts, computePickerSnapshot.ts, compute-picker.ts, journal-rules.routes.ts, schema.ts, calendar-event-annotations repo/memory pair, Shell.tsx, dialog.tsx, useRuleTags.ts, Overview.tsx)
**Pattern extraction date:** 2026-07-09
