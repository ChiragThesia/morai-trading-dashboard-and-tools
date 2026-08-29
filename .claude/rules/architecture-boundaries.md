---
paths:
  - "packages/**/*.ts"
  - "apps/**/*.ts"
  - "src/**/*.ts"
  - "!**/*.test.ts"
---

# Architecture Boundaries — undecided, deliberately

**This rule does not currently mandate an architecture.** v1's was hexagonal with a strict inward
dependency law. That system has been deleted, and the postmortem's verdict on the architecture was
**half-paid** — not vindicated, not refuted. Re-imposing it by default would encode a conclusion the
evidence does not support.

If you are reading this because you are writing the first code of the rebuild: the decision is
yours to make, and this rule exists to make sure it is made on evidence rather than inherited.

## What the evidence says

Read `docs/learnings/app-postmortem.md` before deciding. Its findings, in short:

**Paid for itself.**

- **Function-type ports.** Ports typed as plain functions, not interfaces, made every test double a
  one-line function. No mocking framework was ever needed. This is the single most reusable idea
  from v1.
- **Pure domain, thin I/O wrapper.** This is what let the backtest harness replay the live code
  path instead of a forked copy of it.
- **The in-memory twin.** One in-memory adapter per driven port, maintained alongside the real one.

**Did not.**

- **Swap flexibility.** The whole point of the port abstraction is cheap technology substitution. In
  the system's entire life there was **one** swap, and it was a connection-string change. The
  abstraction was paid for continuously and cashed in once.
- **The law's absolutism.** A whole workspace package existed so that 177 lines could be shared
  across a boundary the rule forbade crossing — despite a narrow carve-out precedent already
  existing for exactly that case.

**Insufficient evidence to judge:** the design-system consolidation, and the volume of planning
artifacts produced per phase.

## Requirements for the rebuild

Whatever structure is chosen:

1. **Decide explicitly and write it down before the second file.** An architecture that accretes is
   an architecture nobody can defend or change.
2. **Keep the numerical core dependency-free.** This is not an architectural preference, it is what
   made `packages/quant` portable enough to survive the deletion intact. Pricing and greeks import
   nothing.
3. **Parse at the boundary, do not cast.** See `typescript.md`.
4. **If you introduce a boundary, enforce it mechanically.** An unenforced boundary is a comment.
   v1 used `eslint-plugin-boundaries`; that file is deleted, and any replacement is a fresh choice.
5. **Do not add an abstraction for a swap you cannot name a date for.** This is the postmortem's
   sharpest lesson. One swap in a system's lifetime does not repay a continuous tax.

## Where to Look

- `docs/learnings/app-postmortem.md` — the full judgment, with evidence
- `docs/learnings/LAWS.md` — the architecture and boundary laws, cited by number
- `salvage/platform-patterns.md` — the six patterns worth carrying, concretely described
- `REBUILD-BRIEF.md` §4 — architecture guidance argued from the postmortem, not from doctrine
