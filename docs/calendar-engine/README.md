# Calendar Engine

Design set for the deterministic SPX calendar-spread ranking engine that replaces
`packages/core/src/picker`.

Read in order.

| Doc | Contents |
|---|---|
| [spec.mdx](spec.mdx) | The specification. Locked decisions, the five doctrine laws the engine encodes, what our own chain measures, the five-stage pipeline, the four-term score, the eight gates, landmine guards, module layout, test plan, and the removal plan for the incumbent |
| [measurements.md](measurements.md) | Every production figure the spec rests on, with the query that produced it. Read this before disputing a number in the spec |
| [current-state.md](current-state.md) | Audit of what exists today: three engines, 23 duplicated quantities, 9 time-to-expiry conventions, the knob inventory, what survives the rebuild |
| [doctrine.md](doctrine.md) | Extracted doctrine from all 103 Predicting Alpha articles — metric catalogue, formulas, thresholds, verbatim quotes, per-article attribution |
| [critique.md](critique.md) | The verification pass. Five factual errors it found in the audit, and the open design decisions it named |

## A note on file length

`docs.md` asks for 20–250 lines per file. Three files here exceed that, deliberately:

- **`spec.mdx`** is a complete specification. The rule's own exception covers it — *API
  specifications (complete contract)* and *design rationale (tightly coupled decisions)*
  stay together. Splitting the score away from the measurements that force it is exactly
  how the incumbent's nine terms lost their justification.
- **`doctrine.md`** and **`critique.md`** are extracted source material, not prose docs.
  They exist so a reader can check an attribution without re-reading 103 articles. Treat
  them as an appendix.

`measurements.md` and this index are the parts anyone maintains.
