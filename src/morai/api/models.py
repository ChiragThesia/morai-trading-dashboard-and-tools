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
