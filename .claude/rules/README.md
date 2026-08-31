# How Rules Work

Rules are contextual requirements that load based on file paths.

## Format

```markdown
---
paths:
  - "pattern/to/match/**/*.ts"
  - "!excluded/**"
---

# Rule Title

## Requirements

MUST/SHOULD requirements with clear criteria. No code examples.

## Where to Look

- [Link to detailed doc] - what it covers
- [Link to template] - canonical structure
- [Link to real code] - working example
```

## Key Principles

- Rules contain **requirements and references** — never code examples or detailed
  explanations. Those live in `docs/` and `.claude/templates/`.
- Keep each rule concise: 1-2 pages max.
- Reference config files (`tsconfig.base.json`, `eslint.config.js`) as source of truth
  for mechanical rules — never restate their contents.
- One rule per concern. Path patterns should not overlap without reason.

## Current Rules

Application code exists again as of Phase 1 (2026-08-31): a Python package under `src/morai/`, with
tests and CI. Two of these five rules are active.

**The other three are still dormant, and for a reason worth naming.** They were written for v1,
whose backend was TypeScript. The rebuild's backend is **Python**, so `tdd.md` and
`typescript.md` match no file that exists and never will — `typescript.md` wakes only when the
future UI lands, and `tdd.md` currently governs nothing at all despite test-first being one of this
project's hardest constraints.

That gap is deliberate for now, not an oversight. Phase 1 considered adding a Python TDD rule and
declined: nothing asked for one, and a single phase is not enough evidence to codify conventions.
TDD is enforced meanwhile through the plans themselves — every task carrying `type: tdd` requires a
test written first, observed failing, with the red-then-green output captured as part of the
deliverable. Write the Python rule when the convention has been proven across several phases, not
before.

| Rule | Paths | Concern | State |
|---|---|---|---|
| [workflow.md](workflow.md) | everything | How we work here; evidence and verification discipline | **active** |
| [docs.md](docs.md) | all markdown | Documentation structure | **active** |
| [architecture-boundaries.md](architecture-boundaries.md) | TS source | Deliberately mandates nothing — records why v1's hexagonal law was judged *half-paid*, and leaves the choice to the rebuild | dormant (TS paths; backend is Python) |
| [tdd.md](tdd.md) | TS source + tests | Red→green TDD | dormant (TS paths — enforced via plan tasks instead, see above) |
| [typescript.md](typescript.md) | all TS/TSX | Type safety | dormant until the UI lands |

`architecture-boundaries.md` is the one to read before writing any code. It does not tell you what
architecture to use. It tells you what v1's cost and what it bought, so the decision is made on
evidence rather than inherited by default.

## Maintenance

- New file pattern needs guidance → new rule file + row in this table + TOPIC-MAP entry.
- Adding a doc → update "Where to Look" in every relevant rule.
- Templates land with scaffolding (`.claude/templates/`) — rules reference them then.

See [docs/docs-on-docs/](../../docs/docs-on-docs/) for the full documentation system.
