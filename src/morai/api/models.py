"""Request and response models (D-09, D-12).

Every model in this API derives from `ApiModel`. `strict=True` closes the coercion
gap `response_model` alone leaves open (a client-sent `"5"` silently becoming `5`);
`extra="forbid"` closes the silently-dropped-extra-field gap; `frozen=True` keeps a
validated model immutable once built.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)


class DependentNumbersModel(ApiModel):
    """Base for any response carrying a number derived from the fill and
    event stream (`D9-14`). `RECON-04` requires the API to mark dependent
    numbers untrustworthy rather than serving them plain -- a signal
    carried only in a separate endpoint is one a client can forget to
    fetch, and then renders a bad number confidently. Carrying
    `trustworthy` inside the payload itself makes ignoring it a
    deliberate act rather than an oversight.

    `trustworthy` is computed by `reconciliation_trustworthy`
    (`api/routes_reconciliation.py`) from the caller's own latest
    persisted verdict across every window, never recomputed. Phase 11's
    review surface inherits this base rather than re-deciding the rule.
    """

    trustworthy: bool
