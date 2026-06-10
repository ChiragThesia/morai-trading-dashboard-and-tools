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

| Rule | Paths | Concern |
|---|---|---|
| [architecture-boundaries.md](architecture-boundaries.md) | `packages/**`, `apps/**` TS | Hexagonal dependency law |
| [tdd.md](tdd.md) | TS source + tests | Red→green TDD |
| [typescript.md](typescript.md) | All TS/TSX | Type safety |
| [workflow.md](workflow.md) | Everything | How we work in this repo |
| [docs.md](docs.md) | All markdown | Documentation structure |

## Maintenance

- New file pattern needs guidance → new rule file + row in this table + TOPIC-MAP entry.
- Adding a doc → update "Where to Look" in every relevant rule.
- Templates land with scaffolding (`.claude/templates/`) — rules reference them then.

See [docs/docs-on-docs/](../../docs/docs-on-docs/) for the full documentation system.
