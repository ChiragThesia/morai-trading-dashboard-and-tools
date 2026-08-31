"""The Schwab vendor boundary (D4-01..D4-05).

**Deliberate deviation from 04-RESEARCH.md's proposed `src/morai/schwab/`
path.** A first-party package named `schwab` sitting beside a
`typings/schwab/` stub package and the vendor package also named `schwab`
makes "which `schwab` is this" a question every reader and every boundary
grep has to answer. Named `vendor` instead -- one rename removes the whole
class of confusion, and the name still says exactly what the package is: a
seam around a third-party dependency, not a first-party subsystem.

`schwab_adapter.py` is the only module in this package (or anywhere in the
codebase) that imports the vendor package itself -- enforced by
`tests/gate/test_vendor_boundary.py` (D4-02).
"""

from __future__ import annotations
