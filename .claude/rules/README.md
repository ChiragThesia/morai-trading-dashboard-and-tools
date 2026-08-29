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

There is no application code in this repo (deleted at `fd4f8d3`). Three of these five rules are
therefore **dormant** — their `paths:` patterns match nothing today, so they never load. They wake
with the first source file of the rebuild, which is why they must be correct now rather than later.

| Rule | Paths | Concern | State |
|---|---|---|---|
| [workflow.md](workflow.md) | everything | How we work here; evidence and verification discipline | **active** |
| [docs.md](docs.md) | all markdown | Documentation structure | **active** |
| [architecture-boundaries.md](architecture-boundaries.md) | TS source | Deliberately mandates nothing — records why v1's hexagonal law was judged *half-paid*, and leaves the choice to the rebuild | dormant |
| [tdd.md](tdd.md) | TS source + tests | Red→green TDD | dormant |
| [typescript.md](typescript.md) | all TS/TSX | Type safety | dormant |

`architecture-boundaries.md` is the one to read before writing any code. It does not tell you what
architecture to use. It tells you what v1's cost and what it bought, so the decision is made on
evidence rather than inherited by default.

## Maintenance

- New file pattern needs guidance → new rule file + row in this table + TOPIC-MAP entry.
- Adding a doc → update "Where to Look" in every relevant rule.
- Templates land with scaffolding (`.claude/templates/`) — rules reference them then.

See [docs/docs-on-docs/](../../docs/docs-on-docs/) for the full documentation system.
