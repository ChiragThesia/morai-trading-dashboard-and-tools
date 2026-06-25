# Phase 10: Stack Decisions Doc Update — Research

**Researched:** 2026-06-25
**Domain:** Documentation edit — `docs/architecture/stack-decisions.md` + cross-file consistency
**Confidence:** HIGH (all facts read directly from the codebase and verified research docs)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOC-01 | `docs/architecture/stack-decisions.md` updated before sidecar code — D16 superseded, D17 lifted, new sidecar decision recorded | All three changes fully specified below with exact current text, target text, and consistency-fix scope |

</phase_requirements>

---

## Summary

Phase 10 is a pure documentation edit. No code is touched. Three changes land in
`docs/architecture/stack-decisions.md`, one row updates `docs/TOPIC-MAP.md` (if a new
companion doc is created — recommendation below says no), and two stale cross-references
in `docs/architecture/deployment.md` and `docs/architecture/jobs.md` are reconciled.

The current doc has 21 decisions numbered D1–D21 (with D19 and D20 out of sequence in the
table — D19 appears after D20 in the table but before it in the section list; this is
pre-existing and not in scope to fix). The highest decision number is **D21**. The new
sidecar decision gets **D22**.

The phase has one deliverable per success criterion:

1. D16 section updated: "superseded by D22 — TS OAuth client retired; schwab-py sidecar is the sole Schwab authenticator."
2. D17 section updated: "streaming no longer deferred; scoped to account/position legs only; 500-symbol cap noted."
3. D22 section added: Python schwab-py sidecar as the third Railway service.
4. Two cross-references in `deployment.md` and `jobs.md` updated so they no longer call D16/D17 the current state.
5. `docs/TOPIC-MAP.md` is NOT updated (no new doc is created — see recommendation below).

**Primary recommendation:** Do not create a new sidecar architecture doc in this phase. A
decision-log entry (D22) plus a forward-reference sentence ("see `deployment.md` for
Railway topology") is the lighter option. `stack-decisions.md` is already 309 lines — adding
a full sidecar section keeps it within the 250-line soft limit by superseding D16 and D17
rather than stacking on top. A dedicated sidecar architecture doc belongs in Phase 11 when
the actual scaffold exists to describe.

---

## Architectural Responsibility Map

Not applicable. This phase makes no code changes and introduces no new architectural tiers.
The map for the sidecar itself is produced in Phase 11 research.

---

## Target Document: Exact Current State

### Decision Table (lines 8–31 of `stack-decisions.md`)

Current D16 row (line 25):
```
| D16 | Schwab auth | Own TS OAuth client (vendored, port of trade-advisor `auth.ts`); tokens in Postgres | Low | Schwab changes OAuth contract |
```

Current D17 row (line 26):
```
| D17 | Market data streaming | Deferred — poll-based jobs cover the journal use-case | New driven port + adapter | Need for sub-minute live data → TS streamer adapter OR schwab-py Python sidecar |
```

Highest existing decision number: **D21** (BSM kernel leaf, Phase 9). The new sidecar decision is **D22**.

### D16 Section (lines 149–169)

Full current text:
```
## D16 — Schwab auth: own TS OAuth client, tokens in Postgres

**Why**: The flow is plain OAuth2 (authorization_code + refresh grant, Basic auth header,
two apps: trader + market). Proven implementation exists — trade-advisor `auth.ts` with
`setup`/`refresh`/`status`/`doctor` subcommands. Port it into the `brokerage` context +
a thin CLI. No library dependency needed for auth; schwab-py NOT required here.

**Hard constraint — weekly re-auth**: Schwab refresh tokens expire **7 days after
issuance, hard, no sliding window**. Refreshing access tokens does not extend it.
Consequences (designed in, see `deployment.md`):
- Jobs degrade gracefully on auth failure: pause Schwab pulls, alert via status + UI
  banner + MCP `get_status`. One app failing must not block the other.
- Re-auth is one command run locally (browser OAuth dance), which writes the new token
  row to Postgres. Server picks it up on next call — no deploy, no SSH.
- `doctor` diagnostics carried over: env completeness, callback-URL exact-match check
  (`https://127.0.0.1` default; portal field must match character-for-character),
  live refresh-grant test, `invalid_grant` → re-auth instruction.

**Token storage**: single source of truth in Postgres (`broker_tokens`), encrypted
app-side. Any future consumer (including a Python sidecar — schwab-py supports custom
token read/write functions) reads the same row. No file/volume coordination.
```

### D17 Section (lines 171–184)

Full current text:
```
## D17 — Streaming: deferred

**Why deferred**: journal cadence is 30-min snapshots; scheduled pulls cover it.
Streaming adds a long-lived websocket process for no current consumer.

**When the trigger fires** (sub-minute live data need), two adapter options behind a
`ForStreamingQuotes` driven port — hexagon unchanged either way:
1. **TS-native streamer adapter** — Schwab streamer is documented websocket + JSON
   (login with access token, SUBS commands). Keeps the stack single-language.
2. **Python sidecar with schwab-py** — separate Railway service running schwab-py's
   `StreamClient`, writing observations to Postgres. Reads tokens from `broker_tokens`
   via custom access functions → one token source, no refresh races.

Decide at trigger time; default lean is (1) to avoid a second language in the repo.
```

---

## What Each Change Must Say

### D16 — Superseded Entry

The section header stays `## D16 — Schwab auth: own TS OAuth client, tokens in Postgres`.
Add a superseded notice at the top of the section body. Keep the original rationale and
token-storage text (current state principle: don't erase decisions, mark them). Insert
a prominent "**Superseded by D22**" line with the reason.

**Superseded reason (cite these facts — all from `.planning/research/SUMMARY.md`):**
[VERIFIED: .planning/research/SUMMARY.md]
- The dual-refresher rotating-token race: Schwab invalidates the old refresh token on
  each refresh. Two processes (TS `refresh-tokens` job + sidecar) racing causes
  `invalid_grant` within one 30-min cycle. One owner must hold the token lifecycle.
- Streamer session ownership: the sidecar owns the one allowed Schwab websocket session.
  The TS client cannot hold it and also be the token refresher — one process must own
  both the token and the session. schwab-py handles this by design.

**Decision table row replacement for D16:**
```
| D16 | Schwab auth | ~~Own TS OAuth client~~ **Superseded by D22** — schwab-py sidecar is sole Schwab authenticator | — | — |
```

Or use a clean superseded marker without strikethrough since Markdown rendering varies:
```
| D16 | Schwab auth | **Superseded by D22.** TS OAuth client retired; schwab-py sidecar owns all auth. | — | — |
```

### D17 — Lifted Entry

The section becomes "D17 — Streaming: lifted (v1.1)". Replace the "deferred" framing with
the lifted decision scoped to account/position legs only.

**Facts to cite in D17 (from `.planning/research/STACK.md`):**
[VERIFIED: .planning/research/STACK.md]
- Streaming is scoped to LEVELONE_OPTION for open position legs (typically 2–30 symbols)
  and ACCT_ACTIVITY for fill events.
- Full SPX chain streaming is impossible: ~500-symbol cap vs ~2,000–5,000 SPX contracts.
  Stream only open position legs; chain snapshots stay REST jobs.
- One streamer session per account (Schwab code 12 CLOSE_CONNECTION kills the second).
- The schwab-py sidecar (D22) owns the single session; GEX/journal stay REST-snapshot jobs.

**Decision table row replacement for D17:**
```
| D17 | Market data streaming | **Lifted (v1.1)** — schwab-py sidecar streams position legs + fills (not full chain); see D22 | Low (sidecar owns session) | Full-chain streaming needed (impossible at 500-symbol cap) |
```

### D22 — New Decision (sidecar)

Add after the D21 section. Decision table row:
```
| D22 | Python schwab-py sidecar | `apps/sidecar/` — FastAPI + schwab-py; sole Schwab auth + REST proxy + streamer; internal Railway network only | Medium (Python service + Railway topology) | TS stack fully covers Schwab streaming natively |
```

**D22 section content must cover:**

1. **What**: A third Railway service (`apps/sidecar/`). Python 3.10+. FastAPI + uvicorn + sse-starlette. schwab-py v1.5.1. [VERIFIED: .planning/research/STACK.md]

2. **Why Python, not TS**: schwab-py's `StreamClient` is an asyncio-native WebSocket client
   that handles Schwab's streamer protocol (login, SUBS commands, reconnect). Hand-rolling
   this in TS is the exact pain the sidecar avoids. FastAPI's native asyncio bridges the
   `StreamClient` event loop to an SSE endpoint without thread hacks. [VERIFIED: .planning/research/STACK.md]

3. **Token pattern** — `client_from_access_functions` with custom `token_read` / `token_write`
   callbacks that read/write the existing `broker_tokens` Postgres row (pgcrypto-encrypted,
   same as the TS side). No schema change. The sidecar is the sole writer; the TS
   `refresh-tokens` job is retired (D16 superseded). [VERIFIED: .planning/research/SUMMARY.md]

4. **Streaming scope**: LEVELONE_OPTION (position legs only) + ACCT_ACTIVITY. ~500-symbol cap
   makes full-chain streaming impossible. GEX and journal snapshots stay REST jobs.
   [VERIFIED: .planning/research/STACK.md]

5. **Isolation**: Railway private network — the sidecar has no public ingress. Only
   `apps/server` reaches it. The sidecar pushes SSE; the TS server fans out to browser
   clients with Supabase JWT verification at the server edge (D20). [ASSUMED: Railway
   private-networking specifics confirmed at Phase 11 infra setup]

6. **Why no message broker**: sidecar → one TS server is a one-writer, one-reader path.
   Direct SSE is sufficient. No Redis/Kafka/RabbitMQ needed.

7. **Swap cost**: Medium. Requires retiring the Python service and writing a TS streamer
   adapter (the original D17 option 1). The hexagon ports are unchanged either way.

8. **Revisit trigger**: TS streaming libraries mature enough to cover Schwab's WebSocket
   protocol without the maintenance burden of hand-rolling reconnect + auth token injection.

---

## Cross-File Consistency Fixes Required

The docs rule states: "Code that contradicts the decision log is a bug — reconcile before
proceeding." [VERIFIED: .claude/rules/workflow.md]

Two files contain stale forward references to D16/D17 that Phase 10 must patch:

### `docs/architecture/deployment.md` — line 53–54

Current text (stale after D16 superseded):
```
A future Python sidecar (schwab-py, D17) reads the same row via custom token access functions.
```

This calls the sidecar "future" and cites D17 (streaming) rather than D22. After Phase 10:
- Remove "A future" (the sidecar is now the active decision).
- Update the citation: change D17 to D22.

Suggested replacement:
```
The schwab-py sidecar (D22) reads the same row via `client_from_access_functions` callbacks.
```

### `docs/architecture/deployment.md` — line 57

Current text (stale after D16 superseded):
```
- **Weekly re-auth is mandatory and designed in** (see `stack-decisions.md` D16):
```

After D16 is superseded by D22, the cross-reference should point to D22:
```
- **Weekly re-auth is mandatory and designed in** (see `stack-decisions.md` D22):
```

### `docs/architecture/jobs.md` — line 38

Current text (stale after D16 superseded):
```
weekly interactive re-auth is mandatory (`deployment.md` + `stack-decisions.md` D16).
```

After D16 is superseded:
```
weekly interactive re-auth is mandatory (`deployment.md` + `stack-decisions.md` D22).
```

**Summary of cross-file fixes:**

| File | Line | Find | Replace |
|------|------|------|---------|
| `docs/architecture/deployment.md` | 53–54 | `A future Python sidecar (schwab-py, D17) reads` | `The schwab-py sidecar (D22) reads` |
| `docs/architecture/deployment.md` | 57 | `D16):` | `D22):` |
| `docs/architecture/jobs.md` | 38 | `D16).` | `D22).` |

---

## TOPIC-MAP Decision

**Recommendation: no new doc, no TOPIC-MAP change.**

`stack-decisions.md` is the right home for D22. It currently documents 21 decisions across
309 lines. Adding D22 at ~30 lines and trimming D16's body slightly keeps it within scope.
A standalone `sidecar.md` architecture doc belongs in Phase 11 when there is a real
`apps/sidecar/` directory and implementation to describe. An architecture doc for a
not-yet-built service violates the "document current state, not intent" principle.
[VERIFIED: docs/docs-on-docs/content-principles.md]

If a reviewer disagrees and a sidecar doc IS created in Phase 10, the TOPIC-MAP entry
would be:
```
| [sidecar.md](architecture/sidecar.md) | Python schwab-py sidecar: FastAPI + schwab-py, token callbacks, Railway private network |
```
Placed in the Architecture table, after `deployment.md`.

---

## Style Constraints from CLAUDE.md + Rules

[VERIFIED: .claude/rules/docs.md] [VERIFIED: docs/docs-on-docs/hemingway-style.md]

| Constraint | Requirement |
|------------|-------------|
| Hemingway prose | Short sentences (<25 words). Active voice. No hedging. Concrete details. |
| Single source of truth | Don't duplicate facts already in `deployment.md` or `jobs.md` — reference instead. |
| Current-state principle | Don't narrate history ("used to be X, now is Y"). Mark D16 superseded; replace D17 body with current reality. |
| No line-number references | Link to files by path, not line numbers. |
| Micro-modular | `stack-decisions.md` is an ADR-lite; cohesive design rationale stays together. No artificial split. |
| Docs before code | Phase 10 MUST complete before any Phase 11 sidecar scaffold work begins. |
| Four-tier system | D22 body goes in `docs/` (stack-decisions.md). Rules stay in `.claude/rules/`. No duplication. |

---

## Don't Hand-Roll

Not applicable — this phase writes prose, not code.

---

## Common Pitfalls

### Pitfall 1: Erasing D16 instead of superseding it

**What goes wrong:** The D16 section is deleted. Future readers lose the original rationale
and the reason for the reversal.

**Why it happens:** "Document current state" is read as "delete old state."

**How to avoid:** Keep the D16 section. Add a "**Superseded by D22**" notice at the top.
Keep the original rationale and token-storage design (it is still accurate — `broker_tokens`
is unchanged). The decision log records reversals, not just current state.

### Pitfall 2: Citing the wrong decision number in cross-references

**What goes wrong:** `deployment.md` and `jobs.md` are updated to reference D22 but one is
missed, leaving a stale D16 reference. The docs-rule grep in the verification step catches it.

**How to avoid:** Fix all three cross-reference sites atomically in one plan/task.

### Pitfall 3: Creating `apps/sidecar/` stub files

**What goes wrong:** The executor creates placeholder Python files because "sidecar" is
mentioned extensively. Phase 10 is docs-only. Any code file in `apps/sidecar/` violates
the docs-before-code sequencing.

**How to avoid:** The plan must explicitly state no code files are created.

### Pitfall 4: Leaving D17 wording as "deferred"

**What goes wrong:** D17 table row still says "Deferred" after edits, contradicting the
section body that now says "lifted."

**How to avoid:** Update both the table row AND the section body in the same edit.

### Pitfall 5: Writing D22 body in future tense

**What goes wrong:** D22 says "will use FastAPI" — future tense for a decision that is
now locked.

**How to avoid:** Hemingway active voice, present tense for decisions: "uses FastAPI",
"reads broker_tokens", "isolates behind Railway private network."

---

## Validation Architecture

> This is a doc-only phase. No test framework applies. Validation = doc-consistency checks.

### Doc Consistency Checks (run before marking complete)

| Check | Command | Pass Condition |
|-------|---------|----------------|
| No stale "D16" cross-references | `rg "D16" docs/architecture/ --include="*.md"` | Only the D16 section header and superseded notice; no active cross-references in other files |
| No stale "D17" cross-references | `rg "D17" docs/architecture/ --include="*.md"` | Only the D17 section header and lifted notice; table row updated |
| No "deferred" in D17 body | `rg -i "deferred" docs/architecture/stack-decisions.md` | Only the historical D17 section note (if kept); body says "lifted" |
| D22 section exists | `rg "## D22" docs/architecture/stack-decisions.md` | Returns one match |
| Decision table has D22 row | `rg "D22" docs/architecture/stack-decisions.md` | ≥3 matches (table row + section header + body) |
| Cross-file stale refs gone | `rg "D16\|D17" docs/architecture/deployment.md docs/architecture/jobs.md` | Zero matches (or only the D22 reference text that explains the supersession) |
| TOPIC-MAP unchanged | `rg "sidecar" docs/TOPIC-MAP.md` | Zero matches (no new doc created in this phase) |
| No code files created | `ls apps/sidecar/ 2>/dev/null` | Directory does not exist |

### Commit Gate

Commit message: `docs(10): supersede D16, lift D17, add D22 (schwab-py sidecar)`

Single commit. All doc edits in one atomic change. No code changes mixed in.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | D22 is the correct next decision number (D21 is highest) | Target Document | If a decision was added between D21 and now, numbering collides; fix by checking the table before writing |
| A2 | Railway private networking secures sidecar isolation (no public ingress) | D22 content | Railway private network behavior confirmed at Phase 11 infra setup; if wrong, isolation strategy changes — but D22 wording says "internal Railway network only" which is accurate regardless of exact mechanism |

---

## Open Questions

**None.** The doc content is fully specified from verified project artifacts. No external
research is required. The sidecar facts all come from `.planning/research/SUMMARY.md` and
`.planning/research/STACK.md`, which were built from schwab-py docs and the codebase.

---

## Sources

### Primary (HIGH confidence)

- `docs/architecture/stack-decisions.md` — read in full; exact D16/D17 text quoted verbatim [VERIFIED: codebase]
- `docs/architecture/deployment.md` — cross-reference sites identified at lines 53, 57 [VERIFIED: codebase]
- `docs/architecture/jobs.md` — cross-reference site identified at line 38 [VERIFIED: codebase]
- `.planning/research/SUMMARY.md` — sidecar rationale (dual-refresher race, streamer ownership) [VERIFIED: project research]
- `.planning/research/STACK.md` — schwab-py v1.5.1, client_from_access_functions, 500-symbol cap, FastAPI+sse-starlette, one-session-per-account [VERIFIED: project research]
- `.claude/rules/docs.md` — style and structure constraints [VERIFIED: codebase]
- `docs/docs-on-docs/hemingway-style.md` — prose rules [VERIFIED: codebase]
- `docs/docs-on-docs/content-principles.md` — single-source-of-truth, current-state principle [VERIFIED: codebase]
- `.planning/REQUIREMENTS.md` — DOC-01 definition and success criteria [VERIFIED: codebase]
- `.planning/ROADMAP.md` — Phase 10 success criteria [VERIFIED: codebase]

---

## Metadata

**Confidence breakdown:**
- Target document structure: HIGH — read directly from codebase
- Cross-file consistency fixes: HIGH — rg scan found all three stale sites
- D22 facts (schwab-py version, token pattern, streaming scope): HIGH — from verified research docs
- Railway private network isolation: MEDIUM — mechanism confirmed at Phase 11; wording is intentionally implementation-agnostic

**Research date:** 2026-06-25
**Valid until:** Indefinite (doc edits; no external dependencies)
